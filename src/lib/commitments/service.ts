import 'server-only';

import { isMissed, minutesOverdue } from '@/lib/behavior/miss';
import { materialiseRange } from '@/lib/commitments/materialise';
import { recordObservedMisses } from '@/lib/commitments/miss-detection';
import { appendEvent } from '@/lib/db/events';
import { cancelPendingForCommitment, enqueueForCommitment } from '@/lib/notifications/queue';
import { getSettings } from '@/lib/notifications/settings';
import { getEnv } from '@/lib/env';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { connectToDatabase } from '@/lib/db/mongoose';
import {
  createCommitmentSchema,
  updateCommitmentSchema,
  type CommitmentStatus,
  type CreateCommitmentInput,
  type UpdateCommitmentInput,
} from '@/lib/schemas/commitment';
import { addDays, toDateKey, type DateKey } from '@/lib/time';

export class CommitmentError extends Error {
  override readonly name = 'CommitmentError';
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
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
}

function toView(
  row: {
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
  };
}

export async function createCommitment(
  input: CreateCommitmentInput,
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
  });

  const entityId = String(doc._id);

  await appendEvent({
    type: 'COMMITMENT_CREATED',
    entityType: 'commitment',
    entityId,
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
    await getSettings(),
    getEnv().APP_TIMEZONE,
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
  now: Date = new Date(),
): Promise<CommitmentView[]> {
  await connectToDatabase();
  await materialiseRange(from, to, timeZone, now);

  // The window is local dates; the stored field is a UTC instant, so the
  // boundaries have to be converted rather than compared as strings.
  const startInstant = new Date(`${from}T00:00:00.000Z`);
  const endInstant = new Date(`${addDays(to, 1)}T00:00:00.000Z`);
  // Widen by a day either side to cover offsets, then filter precisely below.
  const rows = await CommitmentModel.find({
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

  await recordObservedMisses(inWindow, now);

  return inWindow.map((row) => toView(row, now));
}

/** Open commitments whose deadline has already passed, regardless of window. */
export async function listOverdue(now: Date = new Date()): Promise<CommitmentView[]> {
  await connectToDatabase();

  const rows = await CommitmentModel.find({
    status: { $in: ['pending', 'in-progress'] },
    dueAt: { $lt: now },
  })
    .sort({ dueAt: 1 })
    .lean();

  await recordObservedMisses(rows, now);

  return rows.map((row) => toView(row, now));
}

export async function getCommitment(id: string, now: Date = new Date()): Promise<CommitmentView> {
  await connectToDatabase();
  const row = await CommitmentModel.findById(id).lean();
  if (!row) throw new CommitmentError('No such commitment.', 404);

  await recordObservedMisses([row], now);
  return toView(row, now);
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
  now: Date = new Date(),
): Promise<CommitmentView> {
  const data = updateCommitmentSchema.parse(input);
  await connectToDatabase();

  const existing = await CommitmentModel.findById(id).lean();
  if (!existing) throw new CommitmentError('No such commitment.', 404);

  await CommitmentModel.updateOne({ _id: id }, { $set: data });

  await appendEvent({
    type: 'COMMITMENT_EDITED',
    entityType: 'commitment',
    entityId: id,
    ts: now,
    source: 'user',
    payload: { changed: Object.keys(data), values: data },
  });

  const updated = await CommitmentModel.findById(id).lean();
  return toView(updated!, now);
}

export async function startCommitment(id: string, now: Date = new Date()): Promise<CommitmentView> {
  await connectToDatabase();
  const existing = await CommitmentModel.findById(id).lean();
  if (!existing) throw new CommitmentError('No such commitment.', 404);
  if (existing.status !== 'pending') {
    throw new CommitmentError('Only a pending commitment can be started.');
  }

  await CommitmentModel.updateOne({ _id: id }, { $set: { status: 'in-progress', startedAt: now } });
  await appendEvent({
    type: 'COMMITMENT_STARTED',
    entityType: 'commitment',
    entityId: id,
    ts: now,
    source: 'user',
    payload: {},
  });

  const updated = await CommitmentModel.findById(id).lean();
  return toView(updated!, now);
}

export async function completeCommitment(
  id: string,
  now: Date = new Date(),
): Promise<CommitmentView> {
  await connectToDatabase();
  const existing = await CommitmentModel.findById(id).lean();
  if (!existing) throw new CommitmentError('No such commitment.', 404);
  if (existing.status === 'done') return toView(existing, now);
  if (existing.status === 'abandoned') {
    throw new CommitmentError('This commitment was abandoned; it cannot be completed.');
  }

  // Recorded BEFORE the status change closes the window on it, so a commitment
  // completed after its deadline still carries the miss in its history rather
  // than looking like it was always on time.
  await recordObservedMisses([existing], now);

  await CommitmentModel.updateOne({ _id: id }, { $set: { status: 'done', completedAt: now } });

  await appendEvent({
    type: 'COMMITMENT_COMPLETED',
    entityType: 'commitment',
    entityId: id,
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
  await cancelPendingForCommitment(id);

  const updated = await CommitmentModel.findById(id).lean();
  return toView(updated!, now);
}

export async function abandonCommitment(
  id: string,
  reason: string,
  now: Date = new Date(),
): Promise<CommitmentView> {
  await connectToDatabase();
  const existing = await CommitmentModel.findById(id).lean();
  if (!existing) throw new CommitmentError('No such commitment.', 404);
  if (existing.status === 'done') {
    throw new CommitmentError('This commitment is already complete.');
  }

  await recordObservedMisses([existing], now);
  await CommitmentModel.updateOne({ _id: id }, { $set: { status: 'abandoned' } });

  await appendEvent({
    type: 'COMMITMENT_ABANDONED',
    entityType: 'commitment',
    entityId: id,
    ts: now,
    source: 'user',
    // Abandoning is a legitimate decision and is recorded as one. It is not a
    // deletion: the commitment stays in the history, because "I decided not to"
    // is exactly the kind of fact this app exists to keep.
    payload: { reason, dueAt: existing.dueAt.toISOString() },
  });

  // Abandoning is a decision, and the decision has been made. Continuing to
  // ask about it would be nagging, not accountability.
  await cancelPendingForCommitment(id);

  const updated = await CommitmentModel.findById(id).lean();
  return toView(updated!, now);
}
