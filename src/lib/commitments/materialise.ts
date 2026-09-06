import 'server-only';

import mongoose from 'mongoose';

import { occurrenceDatesInRange } from '@/lib/behavior/recurrence';
import { loadPlanContext, planForBlock } from '@/lib/curriculum/plan';
import { appendEvents } from '@/lib/db/events';
import { enqueueForCommitments, type CommitmentForQueue } from '@/lib/notifications/queue';
import { getSettings } from '@/lib/notifications/settings';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { SeriesModel } from '@/lib/db/models/series';
import type { BlockId } from '@/lib/schemas/curriculum';
import type { RecurrenceRule } from '@/lib/schemas/series';
import { LOOKAHEAD_DAYS } from '@/lib/schemas/series';
import { addDays, zonedTimeToUtc, type DateKey } from '@/lib/time';

const DUPLICATE_KEY = 11_000;

/**
 * Indexes an `insertMany` rejected, or null if any rejection was not a
 * duplicate key.
 *
 * Null means throw. Concurrent invocations racing on the unique index is the
 * expected case and is success; anything else is a real failure that must not
 * be counted as "another request got there first".
 */
function duplicateIndexes(error: unknown): number[] | null {
  const errors = (error as { writeErrors?: unknown }).writeErrors;
  if (!Array.isArray(errors) || errors.length === 0) return null;

  const indexes: number[] = [];
  for (const entry of errors) {
    const row = entry as { index?: number; code?: number; err?: { index?: number; code?: number } };
    const code = row.code ?? row.err?.code ?? 0;
    if (code !== DUPLICATE_KEY) return null;

    indexes.push(row.index ?? row.err?.index ?? -1);
  }

  return indexes;
}

export interface MaterialiseResult {
  created: number;
  /** Occurrences another request created first. Not a failure. */
  raced: number;
}

/**
 * Creates any missing occurrences for the queried window, plus a lookahead.
 *
 * Lazy on purpose. Vercel Hobby gives one daily cron invocation, so there is no
 * job to generate these ahead of time, and generating the infinite tail of an
 * open-ended series eagerly is not an option either. Whichever read needs a
 * window materialises it.
 *
 * The lookahead exists so a user who opens "today" still sees the next
 * fortnight appear -- without it, occurrences would only ever exist for windows
 * someone had already looked at.
 *
 * ---------------------------------------------------------------------------
 * THE COST IS PER RANGE, NOT PER OCCURRENCE.
 * ---------------------------------------------------------------------------
 * This used to write one occurrence at a time: a commitment, two events and six
 * notification rows, nine round trips each. A fortnight of three daily study
 * blocks is around 45 occurrences, and against Atlas M0 that measured 34
 * seconds -- past a Vercel Hobby function's entire budget, and getting worse as
 * the study plan extends towards January.
 *
 * It is now a fixed number of queries whatever the range: one read of what
 * exists, then one bulk insert each for commitments, events and notifications.
 * There is a test asserting that count does not scale with the number of
 * occurrences, because this is the kind of thing that regresses invisibly --
 * the code keeps working, it just gets slower until something times out.
 *
 * Concurrency is unchanged. Ids are generated here so the events and
 * notifications for a batch can be built before the insert returns, and the
 * unique index on (seriesId, occurrenceDate) still decides who wins. A row
 * another invocation created first comes back as a duplicate-key write error,
 * and its events and notifications are dropped with it rather than written
 * against an occurrence this request does not own.
 * ---------------------------------------------------------------------------
 */
export async function materialiseRange(
  rangeStart: DateKey,
  rangeEnd: DateKey,
  timeZone: string,
  ownerId: string,
  now: Date = new Date(),
): Promise<MaterialiseResult> {
  const horizon = addDays(rangeEnd, LOOKAHEAD_DAYS);
  // Read once for the whole pass rather than per occurrence.
  const settings = await getSettings(ownerId);

  const active = await SeriesModel.find({
    ownerId,
    status: 'active',
    startDate: { $lte: horizon },
    $or: [{ endDate: null }, { endDate: { $gte: rangeStart } }],
  }).lean();

  if (active.length === 0) return { created: 0, raced: 0 };

  /**
   * The curriculum, if there is one, read once for the whole pass.
   *
   * Only loaded when a study block is actually in range, so an installation
   * with no curriculum -- and every one starts that way -- pays nothing, and
   * a study block with no imported workbook is simply an ordinary daily
   * series rather than a broken one.
   */
  const plan = active.some((series) => series.blockId) ? await loadPlanContext(ownerId) : null;

  // Candidate dates per series, computed without touching the database.
  const wanted = active.map((series) => ({
    series,
    seriesId: String(series._id),
    dates: occurrenceDatesInRange(
      series.rule as unknown as RecurrenceRule,
      series.startDate,
      series.endDate ?? null,
      rangeStart,
      horizon,
    ),
  }));

  const seriesIds = wanted.filter((entry) => entry.dates.length > 0).map((entry) => entry.seriesId);
  if (seriesIds.length === 0) return { created: 0, raced: 0 };

  /**
   * One read for every series at once, not one per series.
   *
   * The date bound is the whole window rather than each series' own list, so
   * the query is the same shape however many series exist.
   */
  const existing = await CommitmentModel.find(
    {
      ownerId,
      seriesId: { $in: seriesIds },
      occurrenceDate: { $gte: rangeStart, $lte: horizon },
    },
    { seriesId: 1, occurrenceDate: 1 },
  ).lean();

  const have = new Set(existing.map((row) => `${row.seriesId}\u0000${row.occurrenceDate}`));

  interface Pending {
    doc: Record<string, unknown>;
    queue: CommitmentForQueue;
    events: Parameters<typeof appendEvents>[0];
  }

  const pending: Pending[] = [];

  for (const { series, seriesId, dates } of wanted) {
    const rule = series.rule as unknown as RecurrenceRule;

    for (const occurrenceDate of dates) {
      if (have.has(`${seriesId}\u0000${occurrenceDate}`)) continue;

      // The rule's wall clock, resolved to a UTC instant on that local date.
      const dueAt = zonedTimeToUtc(occurrenceDate, rule.timeOfDay, timeZone);

      /**
       * A study block names its topic; every other series does not.
       *
       * Resolved per occurrence because the answer depends on the DATE -- the
       * weekly rhythm makes Monday machine coding and Thursday testing -- and
       * a fortnight of lookahead materialised with today's answer would name
       * the same topic fourteen times. This is pure and costs no round trip.
       */
      const blockId = series.blockId as BlockId | null;
      const blockPlan = blockId && plan ? planForBlock(plan, blockId, occurrenceDate) : null;

      // Generated here so the events and queue rows for this occurrence can be
      // built before the insert returns.
      const id = new mongoose.Types.ObjectId();
      const entityId = String(id);

      const title = blockPlan?.title ?? series.title;
      const outcome = blockPlan?.outcome ?? series.outcome;
      const estimateMinutes = blockPlan?.estimateMinutes ?? rule.estimateMinutes;
      const priority = blockPlan?.priority ?? series.priority;

      pending.push({
        doc: {
          _id: id,
          title,
          outcome,
          dueAt,
          // Equal at creation. An occurrence that is later postponed keeps this
          // as the deadline it was originally born with.
          originalDueAt: dueAt,
          estimateMinutes,
          status: 'pending',
          priority,
          seriesId,
          occurrenceDate,
          blockId,
          curriculumTopicKey: blockPlan?.curriculumTopicKey ?? null,
          topicOverridden: false,
          createdAt: now,
          startedAt: null,
          completedAt: null,
          notes: '',
          ownerId,
        },
        queue: {
          id: entityId,
          title,
          outcome,
          dueAt,
          estimateMinutes,
          priority,
          leadMinutes: null,
        },
        events: [
          {
            type: 'COMMITMENT_CREATED',
            entityType: 'commitment',
            entityId,
            ownerId,
            ts: now,
            // Not a user action: the rule produced this, not a person.
            source: 'system',
            payload: {
              seriesId,
              occurrenceDate,
              dueAt: dueAt.toISOString(),
              ...(blockPlan
                ? {
                    blockId,
                    curriculumTopicKey: blockPlan.curriculumTopicKey,
                    // Why this topic, kept in the log so a suggestion the user
                    // disagrees with can be argued with rather than guessed at.
                    suggestionReasons: blockPlan.reasons,
                  }
                : {}),
            },
          },
          {
            type: 'DEADLINE_SET',
            entityType: 'commitment',
            entityId,
            ownerId,
            ts: now,
            source: 'system',
            payload: { dueAt: dueAt.toISOString(), seriesId },
          },
        ],
      });
    }
  }

  if (pending.length === 0) return { created: 0, raced: 0 };

  let raced = 0;
  let landed = pending;

  try {
    await CommitmentModel.insertMany(
      pending.map((entry) => entry.doc),
      { ordered: false },
    );
  } catch (error) {
    const rejected = duplicateIndexes(error);
    if (rejected === null) throw error;

    /**
     * Another invocation won the index for these. Their events and queue rows
     * are dropped rather than written -- an event against an occurrence this
     * request did not create would attribute someone else's row to it, and a
     * notification would be a duplicate of one already queued.
     */
    const lost = new Set(rejected);
    raced = lost.size;
    landed = pending.filter((_, index) => !lost.has(index));
  }

  if (landed.length === 0) return { created: 0, raced };

  await appendEvents(landed.flatMap((entry) => entry.events));

  // An occurrence is a commitment like any other, so it gets the same
  // notifications. Enqueued here, as it is materialised, because there is no
  // later pass that would pick it up.
  await enqueueForCommitments(
    landed.map((entry) => entry.queue),
    settings,
    timeZone,
    ownerId,
    now,
  );

  return { created: landed.length, raced };
}
