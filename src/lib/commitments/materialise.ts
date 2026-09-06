import 'server-only';

import { occurrenceDatesInRange } from '@/lib/behavior/recurrence';
import { appendEvent } from '@/lib/db/events';
import { enqueueForCommitment } from '@/lib/notifications/queue';
import { getSettings } from '@/lib/notifications/settings';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { SeriesModel } from '@/lib/db/models/series';
import type { RecurrenceRule } from '@/lib/schemas/series';
import { LOOKAHEAD_DAYS } from '@/lib/schemas/series';
import { addDays, zonedTimeToUtc, type DateKey } from '@/lib/time';

const DUPLICATE_KEY = 11_000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === DUPLICATE_KEY
  );
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
 * Concurrency is handled by the unique index on (seriesId, occurrenceDate)
 * rather than by checking-then-writing, which races between the two steps. A
 * duplicate-key error means another request created it first, which is success.
 */
export async function materialiseRange(
  rangeStart: DateKey,
  rangeEnd: DateKey,
  timeZone: string,
  now: Date = new Date(),
): Promise<MaterialiseResult> {
  const horizon = addDays(rangeEnd, LOOKAHEAD_DAYS);
  // Read once for the whole pass rather than per occurrence.
  const settings = await getSettings();

  const active = await SeriesModel.find({
    status: 'active',
    startDate: { $lte: horizon },
    $or: [{ endDate: null }, { endDate: { $gte: rangeStart } }],
  }).lean();

  let created = 0;
  let raced = 0;

  for (const series of active) {
    const rule = series.rule as unknown as RecurrenceRule;
    const dates = occurrenceDatesInRange(
      rule,
      series.startDate,
      series.endDate ?? null,
      rangeStart,
      horizon,
    );

    if (dates.length === 0) continue;

    const seriesId = String(series._id);

    // One query for what already exists, rather than one per candidate date.
    const existing = await CommitmentModel.find(
      { seriesId, occurrenceDate: { $in: dates } },
      { occurrenceDate: 1 },
    ).lean();
    const have = new Set(existing.map((row) => row.occurrenceDate));

    for (const occurrenceDate of dates) {
      if (have.has(occurrenceDate)) continue;

      // The rule's wall clock, resolved to a UTC instant on that local date.
      const dueAt = zonedTimeToUtc(occurrenceDate, rule.timeOfDay, timeZone);

      try {
        const doc = await CommitmentModel.create({
          title: series.title,
          outcome: series.outcome,
          dueAt,
          // Equal at creation. An occurrence that is later postponed keeps this
          // as the deadline it was originally born with.
          originalDueAt: dueAt,
          estimateMinutes: rule.estimateMinutes,
          status: 'pending',
          priority: series.priority,
          seriesId,
          occurrenceDate,
          createdAt: now,
          startedAt: null,
          completedAt: null,
          notes: '',
        });

        await appendEvent({
          type: 'COMMITMENT_CREATED',
          entityType: 'commitment',
          entityId: String(doc._id),
          ts: now,
          // Not a user action: the rule produced this, not a person.
          source: 'system',
          payload: { seriesId, occurrenceDate, dueAt: dueAt.toISOString() },
        });

        await appendEvent({
          type: 'DEADLINE_SET',
          entityType: 'commitment',
          entityId: String(doc._id),
          ts: now,
          source: 'system',
          payload: { dueAt: dueAt.toISOString(), seriesId },
        });

        // An occurrence is a commitment like any other, so it gets the same
        // notifications. Enqueued here, as it is materialised, because there
        // is no later pass that would pick it up.
        await enqueueForCommitment(
          {
            id: String(doc._id),
            title: series.title,
            outcome: series.outcome,
            dueAt,
            estimateMinutes: rule.estimateMinutes,
            priority: series.priority,
            leadMinutes: null,
          },
          settings,
          timeZone,
          now,
        );

        created += 1;
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          raced += 1;
          continue;
        }
        throw error;
      }
    }
  }

  return { created, raced };
}
