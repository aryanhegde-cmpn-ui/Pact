import 'server-only';

import { PactError } from '@/lib/api/errors';

import { isMissed, minutesOverdue } from '@/lib/behavior/miss';
import { needsReckoning, type ReckoningEvent } from '@/lib/behavior/reckoning';
import { EventModel } from '@/lib/db/models/event';
import { materialiseRange } from '@/lib/commitments/materialise';
import { recordObservedMisses } from '@/lib/commitments/miss-detection';
import { appendEvent } from '@/lib/db/events';
import { cancelPendingForCommitment, enqueueForCommitment } from '@/lib/notifications/queue';
import { getSettings } from '@/lib/notifications/settings';
import { getEnv } from '@/lib/env';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { connectToDatabase } from '@/lib/db/mongoose';
import {
  OPEN_STATUSES,
  createCommitmentSchema,
  updateCommitmentSchema,
  type CommitmentStatus,
  type CreateCommitmentInput,
  type UpdateCommitmentInput,
} from '@/lib/schemas/commitment';
import { addDays, toDateKey, type DateKey } from '@/lib/time';

export class CommitmentError extends PactError {
  constructor(message: string, status = 400) {
    super(message, status);
  }
}

/** What a surface renders. Derived fields are computed here, never stored. */
export interface CommitmentView {
  id: string;
  title: string;
  outcome: string;
  dueAt: string;
  originalDueAt: string;
  estimateMinutes: number;
  status: CommitmentStatus;
  priority: string;
  seriesId: string | null;
  occurrenceDate: string | null;
  notes: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Derived. Not a column -- see the comment in the model. */
  missed: boolean;
  minutesOverdue: number;
  /** Derived: has this deadline moved since it was made? */
  postponed: boolean;
  /**
   * Derived: missed and not yet answered.
   *
   * Sorts above everything else and blocks rescheduling. Never stored.
   */
  needsReckoning: boolean;
  /** Recovery-action state, so a surface can show what was decided. */
  nextAction: string | null;
  blockedOn: string | null;
  followUpDate: string | null;
  displacedBy: string | null;
  deadlineChanges: number;
  /** Set when the study plan generated this. See the commitment model. */
  blockId: string | null;
  curriculumTopicKey: string | null;
  /** True once the user chose the topic themselves. The plan never overrides it. */
  topicOverridden: boolean;
}

function toView(
  row: {
    nextAction?: string | null;
    blockedOn?: string | null;
    followUpDate?: Date | null;
    displacedBy?: string | null;
    _id: unknown;
    title: string;
    outcome: string;
    dueAt: Date;
    originalDueAt: Date;
    estimateMinutes: number;
    status: string;
    priority: string;
    seriesId?: string | null;
    occurrenceDate?: string | null;
    notes?: string;
    createdAt: Date;
    startedAt?: Date | null;
    completedAt?: Date | null;
  },
  now: Date,
  /** The commitment's events, when the caller has them. Enables derived state. */
  events: readonly { ts: Date; type: string; payload?: Record<string, unknown> }[] = [],
): CommitmentView {
  const status = row.status as CommitmentStatus;
  const missInput = { dueAt: row.dueAt, status };

  return {
    id: String(row._id),
    title: row.title,
    outcome: row.outcome,
    dueAt: row.dueAt.toISOString(),
    originalDueAt: row.originalDueAt.toISOString(),
    estimateMinutes: row.estimateMinutes,
    status,
    priority: row.priority,
    seriesId: row.seriesId ?? null,
    occurrenceDate: row.occurrenceDate ?? null,
    notes: row.notes ?? '',
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    missed: isMissed(missInput, now),
    minutesOverdue: minutesOverdue(missInput, now),
    postponed: row.dueAt.getTime() !== row.originalDueAt.getTime(),
    needsReckoning: needsReckoning(missInput, events as ReckoningEvent[], now),
    nextAction: row.nextAction ?? null,
    blockedOn: row.blockedOn ?? null,
    followUpDate: row.followUpDate?.toISOString() ?? null,
    displacedBy: row.displacedBy ?? null,
    deadlineChanges: events.filter((event) => event.type === 'DEADLINE_CHANGED').length,
    blockId: (row as { blockId?: string | null }).blockId ?? null,
    curriculumTopicKey: (row as { curriculumTopicKey?: string | null }).curriculumTopicKey ?? null,
    topicOverridden: (row as { topicOverridden?: boolean }).topicOverridden ?? false,
  };
}

/**
 * Loads the events needed to derive reckoning state for a set of commitments.
 *
 * One query for the whole page rather than one per row: a dashboard with
 * twenty commitments would otherwise make twenty round trips to an M0 cluster
 * to answer a question about three of them.
 */
async function eventsByEntity(
  ids: string[],
  ownerId: string,
): Promise<Map<string, { ts: Date; type: string; payload?: Record<string, unknown> }[]>> {
  const grouped = new Map<
    string,
    { ts: Date; type: string; payload?: Record<string, unknown> }[]
  >();
  if (ids.length === 0) return grouped;

  const rows = await EventModel.find(
    // Only the types derived state actually reads.
    {
      entityId: { $in: ids },
      ownerId,
      type: { $in: ['RECKONING_SUBMITTED', 'DEADLINE_CHANGED', 'RECOVERY_ACTION_SELECTED'] },
    },
    { entityId: 1, ts: 1, type: 1, payload: 1 },
  )
    .sort({ ts: 1 })
    .lean();

  for (const row of rows) {
    const list = grouped.get(row.entityId) ?? [];
    list.push({ ts: row.ts, type: row.type, payload: row.payload as Record<string, unknown> });
    grouped.set(row.entityId, list);
  }

  return grouped;
}

/**
 * Needs-reckoning first, then overdue, then by deadline.
 *
 * An unanswered miss outranks everything wherever work is listed. Burying it
 * under today's tidy list is how it stays buried.
 */
function byUrgency(a: CommitmentView, b: CommitmentView): number {
  if (a.needsReckoning !== b.needsReckoning) return a.needsReckoning ? -1 : 1;
  if (a.missed !== b.missed) return a.missed ? -1 : 1;

  return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
}

export async function createCommitment(
  input: CreateCommitmentInput,
  ownerId: string,
  now: Date = new Date(),
): Promise<CommitmentView> {
  const data = createCommitmentSchema.parse(input);
  await connectToDatabase();

  const doc = await CommitmentModel.create({
    title: data.title,
    outcome: data.outcome,
    dueAt: data.dueAt,
    // Identical at creation, and the only time originalDueAt is ever written.
    originalDueAt: data.dueAt,
    estimateMinutes: data.estimateMinutes,
    status: 'pending',
    priority: data.priority,
    seriesId: null,
    occurrenceDate: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    notes: data.notes ?? '',
    leadMinutes: data.leadMinutes ?? null,
    ownerId,
  });

  const entityId = String(doc._id);

  await appendEvent({
    type: 'COMMITMENT_CREATED',
    entityType: 'commitment',
    entityId,
    ownerId,
    ts: now,
    source: 'user',
    payload: {
      title: data.title,
      outcome: data.outcome,
      priority: data.priority,
      estimateMinutes: data.estimateMinutes,
    },
  });

  // Separate from CREATED so the deadline history is readable on its own,
  // without special-casing the first entry.
  await appendEvent({
    type: 'DEADLINE_SET',
    entityType: 'commitment',
    entityId,
    ownerId,
    ts: now,
    source: 'user',
    payload: { dueAt: data.dueAt.toISOString() },
  });

  // A commitment with no notifications is just a list item.
  await enqueueForCommitment(
    {
      id: entityId,
      title: data.title,
      outcome: data.outcome,
      dueAt: data.dueAt,
      estimateMinutes: data.estimateMinutes,
      priority: data.priority,
      leadMinutes: data.leadMinutes ?? null,
    },
    await getSettings(ownerId),
    getEnv().APP_TIMEZONE,
    ownerId,
    now,
  );

  return toView(doc.toObject(), now);
}

/**
 * Lists a local date range.
 *
 * Materialises series occurrences for the window first, then records any misses
 * the read observes. Both are lazy because there is no scheduler to do them.
 */
export async function listByDateRange(
  from: DateKey,
  to: DateKey,
  timeZone: string,
  ownerId: string,
  now: Date = new Date(),
): Promise<CommitmentView[]> {
  await connectToDatabase();
  await materialiseRange(from, to, timeZone, ownerId, now);

  // The window is local dates; the stored field is a UTC instant, so the
  // boundaries have to be converted rather than compared as strings.
  const startInstant = new Date(`${from}T00:00:00.000Z`);
  const endInstant = new Date(`${addDays(to, 1)}T00:00:00.000Z`);
  // Widen by a day either side to cover offsets, then filter precisely below.
  const rows = await CommitmentModel.find({
    ownerId,
    dueAt: {
      $gte: new Date(startInstant.getTime() - 86_400_000),
      $lt: new Date(endInstant.getTime() + 86_400_000),
    },
  })
    .sort({ dueAt: 1 })
    .lean();

  const inWindow = rows.filter((row) => {
    const key = toDateKey(row.dueAt, timeZone);
    return key >= from && key <= to;
  });

  await recordObservedMisses(inWindow, ownerId, now);

  const events = await eventsByEntity(
    inWindow.map((row) => String(row._id)),
    ownerId,
  );

  return inWindow.map((row) => toView(row, now, events.get(String(row._id)) ?? [])).sort(byUrgency);
}

/**
 * How many overdue rows one page holds.
 *
 * Overdue is an ACCUMULATING set: nothing removes a row from it except
 * finishing, abandoning or reckoning it, and the whole premise of this app is
 * that those do not always happen. It was unbounded, and at 44 rows already
 * cost a second and 26KB. A year of ordinary use is hundreds.
 *
 * Fifteen because a page is meant to be actionable. A list nobody can get to
 * the bottom of is a list nobody reads, which is the same outcome as not
 * showing it -- and past a certain size the answer is not a longer page, it is
 * recovery mode.
 */
export const OVERDUE_PAGE = 15;

export interface OverduePage {
  commitments: CommitmentView[];
  /** Every overdue row, not just this page. */
  total: number;
  /** Of those, how many are missed and unanswered. */
  needsReckoning: number;
}

/**
 * Overdue counts, in one aggregation.
 *
 * Needs-reckoning is derived from the deadline and the event log, so counting
 * it in the application would mean reading every overdue row and its events --
 * which is the unbounded read this page exists to avoid. The lookup keys on
 * (entityId, ts) because a reckoning answers a DEADLINE, not a commitment: one
 * missed on Monday, reckoned, rescheduled and missed again needs a second
 * answer, and matching on entityId alone would call it settled.
 */
export async function overdueCounts(
  ownerId: string,
  now: Date = new Date(),
): Promise<{ total: number; needsReckoning: number }> {
  await connectToDatabase();

  const [summary] = await CommitmentModel.aggregate<{ total: number; needsReckoning: number }>([
    { $match: { ownerId, status: { $in: [...OPEN_STATUSES] }, dueAt: { $lt: now } } },
    {
      $lookup: {
        from: 'events',
        let: { entityId: { $toString: '$_id' }, deadline: '$dueAt' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$ownerId', ownerId] },
                  { $eq: ['$entityId', '$$entityId'] },
                  { $eq: ['$type', 'RECKONING_SUBMITTED'] },
                  { $eq: ['$ts', '$$deadline'] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: 'answered',
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        needsReckoning: {
          $sum: { $cond: [{ $eq: [{ $size: '$answered' }, 0] }, 1, 0] },
        },
      },
    },
  ]);

  return { total: summary?.total ?? 0, needsReckoning: summary?.needsReckoning ?? 0 };
}

/**
 * One page of open commitments whose deadline has already passed.
 *
 * Bounded, oldest first, with unanswered misses sorted above answered ones
 * within the page. The page is the OLDEST rows rather than "every unanswered
 * miss", because selecting on needs-reckoning would need the event log for
 * every overdue row before it could pick fifteen -- and the oldest are the
 * ones that have been ignored longest, which is the right thing to put in
 * front of someone either way.
 *
 * The count that matters for the whole set comes back alongside, so a surface
 * can say "15 of 44" rather than implying 15 is all of it.
 */
export async function listOverdue(
  ownerId: string,
  now: Date = new Date(),
  limit: number = OVERDUE_PAGE,
): Promise<OverduePage> {
  await connectToDatabase();

  const rows = await CommitmentModel.find({
    ownerId,
    status: { $in: ['pending', 'in-progress'] },
    dueAt: { $lt: now },
  })
    .sort({ dueAt: 1 })
    .limit(limit)
    .lean();

  await recordObservedMisses(rows, ownerId, now);

  const events = await eventsByEntity(
    rows.map((row) => String(row._id)),
    ownerId,
  );

  const counts = await overdueCounts(ownerId, now);

  return {
    commitments: rows
      .map((row) => toView(row, now, events.get(String(row._id)) ?? []))
      .sort(byUrgency),
    ...counts,
  };
}

export async function getCommitment(
  id: string,
  ownerId: string,
  now: Date = new Date(),
): Promise<CommitmentView> {
  await connectToDatabase();
  const row = await CommitmentModel.findOne({ _id: id, ownerId }).lean();
  if (!row) throw new CommitmentError('No such commitment.', 404);

  await recordObservedMisses([row], ownerId, now);
  const events = await eventsByEntity([String(row._id)], ownerId);

  return toView(row, now, events.get(String(row._id)) ?? []);
}

/**
 * The generic edit path.
 *
 * Cannot write `dueAt`: the schema is `.strict()` and the field is not in it,
 * so a body carrying one is a validation error rather than a silently ignored
 * key. Deadlines move only through `changeDeadline`.
 */
export async function updateCommitment(
  id: string,
  input: UpdateCommitmentInput,
  ownerId: string,
  now: Date = new Date(),
): Promise<CommitmentView> {
  const data = updateCommitmentSchema.parse(input);
  await connectToDatabase();

  const existing = await CommitmentModel.findOne({ _id: id, ownerId }).lean();
  if (!existing) throw new CommitmentError('No such commitment.', 404);

  await CommitmentModel.updateOne({ _id: id, ownerId }, { $set: data });

  await appendEvent({
    type: 'COMMITMENT_EDITED',
    entityType: 'commitment',
    entityId: id,
    ownerId,
    ts: now,
    source: 'user',
    payload: { changed: Object.keys(data), values: data },
  });

  const updated = await CommitmentModel.findOne({ _id: id, ownerId }).lean();
  return toView(updated!, now);
}

export async function startCommitment(
  id: string,
  ownerId: string,
  now: Date = new Date(),
): Promise<CommitmentView> {
  await connectToDatabase();
  const existing = await CommitmentModel.findOne({ _id: id, ownerId }).lean();
  if (!existing) throw new CommitmentError('No such commitment.', 404);
  if (existing.status !== 'pending') {
    throw new CommitmentError('Only a pending commitment can be started.');
  }

  await CommitmentModel.updateOne(
    { _id: id, ownerId },
    { $set: { status: 'in-progress', startedAt: now } },
  );
  await appendEvent({
    type: 'COMMITMENT_STARTED',
    entityType: 'commitment',
    entityId: id,
    ownerId,
    ts: now,
    source: 'user',
    payload: {},
  });

  const updated = await CommitmentModel.findOne({ _id: id, ownerId }).lean();
  return toView(updated!, now);
}

export async function completeCommitment(
  id: string,
  ownerId: string,
  now: Date = new Date(),
): Promise<CommitmentView> {
  await connectToDatabase();
  const existing = await CommitmentModel.findOne({ _id: id, ownerId }).lean();
  if (!existing) throw new CommitmentError('No such commitment.', 404);
  if (existing.status === 'done') return toView(existing, now);
  if (existing.status === 'abandoned') {
    throw new CommitmentError('This commitment was abandoned; it cannot be completed.');
  }

  // Recorded BEFORE the status change closes the window on it, so a commitment
  // completed after its deadline still carries the miss in its history rather
  // than looking like it was always on time.
  await recordObservedMisses([existing], ownerId, now);

  await CommitmentModel.updateOne(
    { _id: id, ownerId },
    { $set: { status: 'done', completedAt: now } },
  );

  await appendEvent({
    type: 'COMMITMENT_COMPLETED',
    entityType: 'commitment',
    entityId: id,
    ownerId,
    ts: now,
    source: 'user',
    payload: {
      dueAt: existing.dueAt.toISOString(),
      originalDueAt: existing.originalDueAt.toISOString(),
      // The honest facts, recorded once: late against the deadline that was
      // actually in force, and late against the one first committed to.
      lateAgainstDueAt: now.getTime() > existing.dueAt.getTime(),
      lateAgainstOriginal: now.getTime() > existing.originalDueAt.getTime(),
      // Duration is derivable from startedAt, so it is not stored on the row.
      workedMinutes: existing.startedAt
        ? Math.round((now.getTime() - existing.startedAt.getTime()) / 60_000)
        : null,
    },
  });

  // Nothing further to ask about something that is finished. Leaving these
  // queued produces an ACCOUNTABILITY_CHECK for work already done, which is
  // exactly the kind of wrong that teaches someone to ignore the app.
  await cancelPendingForCommitment(id, ownerId);

  const updated = await CommitmentModel.findOne({ _id: id, ownerId }).lean();
  return toView(updated!, now);
}

export async function abandonCommitment(
  id: string,
  reason: string,
  ownerId: string,
  now: Date = new Date(),
): Promise<CommitmentView> {
  await connectToDatabase();
  const existing = await CommitmentModel.findOne({ _id: id, ownerId }).lean();
  if (!existing) throw new CommitmentError('No such commitment.', 404);
  if (existing.status === 'done') {
    throw new CommitmentError('This commitment is already complete.');
  }

  await recordObservedMisses([existing], ownerId, now);
  await CommitmentModel.updateOne({ _id: id, ownerId }, { $set: { status: 'abandoned' } });

  await appendEvent({
    type: 'COMMITMENT_ABANDONED',
    entityType: 'commitment',
    entityId: id,
    ownerId,
    ts: now,
    source: 'user',
    // Abandoning is a legitimate decision and is recorded as one. It is not a
    // deletion: the commitment stays in the history, because "I decided not to"
    // is exactly the kind of fact this app exists to keep.
    payload: { reason, dueAt: existing.dueAt.toISOString() },
  });

  // Abandoning is a decision, and the decision has been made. Continuing to
  // ask about it would be nagging, not accountability.
  await cancelPendingForCommitment(id, ownerId);

  const updated = await CommitmentModel.findOne({ _id: id, ownerId }).lean();
  return toView(updated!, now);
}

/**
 * How many commitments are waiting to be reckoned with.
 *
 * Shown in the header, and it clears only when every one is answered. A count
 * that can be dismissed without answering would be a notification badge, which
 * is the opposite of the point.
 */
export async function countNeedsReckoning(
  ownerId: string,
  now: Date = new Date(),
): Promise<number> {
  await connectToDatabase();

  const open = await CommitmentModel.find(
    { ownerId, status: { $in: OPEN_STATUSES }, dueAt: { $lt: now } },
    { dueAt: 1, status: 1 },
  ).lean();

  if (open.length === 0) return 0;

  const events = await eventsByEntity(
    open.map((row) => String(row._id)),
    ownerId,
  );

  return open.filter((row) =>
    needsReckoning(
      { dueAt: row.dueAt, status: row.status as CommitmentStatus },
      (events.get(String(row._id)) ?? []) as ReckoningEvent[],
      now,
    ),
  ).length;
}

/** Every commitment awaiting a reckoning, most overdue first. */
export async function listNeedsReckoning(
  ownerId: string,
  now: Date = new Date(),
): Promise<CommitmentView[]> {
  await connectToDatabase();

  const open = await CommitmentModel.find({
    ownerId,
    status: { $in: OPEN_STATUSES },
    dueAt: { $lt: now },
  })
    .sort({ dueAt: 1 })
    .lean();

  const events = await eventsByEntity(
    open.map((row) => String(row._id)),
    ownerId,
  );

  return open
    .map((row) => toView(row, now, events.get(String(row._id)) ?? []))
    .filter((view) => view.needsReckoning);
}
