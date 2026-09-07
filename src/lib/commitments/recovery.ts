import 'server-only';

import { changeDeadline } from '@/lib/commitments/deadline';
import { submitReckoning } from '@/lib/commitments/reckoning';
import {
  abandonCommitment,
  completeCommitment,
  overdueCounts,
  CommitmentError,
} from '@/lib/commitments/service';
import { appendEvent } from '@/lib/db/events';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { RecoverySessionModel } from '@/lib/db/models/recovery-session';
import {
  CATEGORY_FOR_MISS_REASON,
  RECOVERY_THRESHOLDS,
  recoveryIsWarranted,
  resolveSlotSchema,
  type RecoverySlot,
  type ResolveSlotInput,
} from '@/lib/schemas/recovery';

/**
 * Recovery mode: what it shows, and what resolving a slot does.
 *
 * Whether it is on is derived from the overdue counts on every read. This
 * module never stores that. What it does store is the EPISODE -- see
 * `RecoverySessionModel` -- so a spell in recovery is visible in the history
 * afterwards rather than being invisible the moment it ends.
 */

const DUPLICATE_KEY = 11_000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === DUPLICATE_KEY
  );
}

/**
 * How many overdue rows the slot picker looks at.
 *
 * Bounded like everything else that reads this set. Three are chosen from the
 * oldest thirty, which is more than enough variety to pick a small one, a big
 * one and a dead one without reading a backlog of any size.
 */
const POOL = 30;

export interface RecoveryCandidate {
  id: string;
  title: string;
  outcome: string;
  dueAt: string;
  estimateMinutes: number;
  daysOverdue: number;
  status: string;
  /** Never started, and long past due. The strongest abandon signal there is. */
  neverStarted: boolean;
  deadlineChanges: number;
}

export interface RecoveryState {
  active: boolean;
  counts: { needsReckoning: number; overdue: number };
  thresholds: typeof RECOVERY_THRESHOLDS;
  /** Null when recovery is not active. */
  session: { startedAt: string; passes: number } | null;
  /** The three dispositions, each with a default and the pool to swap it for. */
  slots: { slot: RecoverySlot; suggested: RecoveryCandidate | null; why: string }[];
  candidates: RecoveryCandidate[];
}

function toCandidate(row: Record<string, unknown>, now: Date): RecoveryCandidate {
  const dueAt = row.dueAt as Date;

  return {
    id: String(row._id),
    title: row.title as string,
    outcome: row.outcome as string,
    dueAt: dueAt.toISOString(),
    estimateMinutes: row.estimateMinutes as number,
    daysOverdue: Math.floor((now.getTime() - dueAt.getTime()) / 86_400_000),
    status: row.status as string,
    neverStarted: (row.startedAt ?? null) === null,
    deadlineChanges: 0,
  };
}

/**
 * Which commitment goes in which slot, by default.
 *
 * Opinionated, and each one is overridable from the pool -- forcing a specific
 * commitment to be abandoned would be the app making a decision that is not
 * its to make. But an empty slot with a dropdown is a decision deferred, and
 * deferring is what produced the backlog, so every slot arrives with an answer
 * already in it.
 *
 * The three heuristics:
 *
 *   finish     the SMALLEST by the user's own estimate. The slot has to be
 *              plausible today or the pass does not happen at all.
 *   reschedule the LARGEST. If anything here genuinely needs more time rather
 *              than less commitment, it is the biggest thing in the list.
 *   abandon    the oldest never-started one. Never started and weeks past due
 *              is the clearest evidence available that it was not going to be.
 */
function pickSlots(
  candidates: RecoveryCandidate[],
): { slot: RecoverySlot; suggested: RecoveryCandidate | null; why: string }[] {
  const taken = new Set<string>();
  const remaining = () => candidates.filter((entry) => !taken.has(entry.id));

  const take = (entry: RecoveryCandidate | undefined) => {
    if (entry) taken.add(entry.id);
    return entry ?? null;
  };

  const smallest = [...remaining()].sort((a, b) => a.estimateMinutes - b.estimateMinutes)[0];
  const finish = take(smallest);

  const largest = [...remaining()].sort((a, b) => b.estimateMinutes - a.estimateMinutes)[0];
  const reschedule = take(largest);

  const pool = remaining();
  const deadest =
    pool.filter((entry) => entry.neverStarted).sort((a, b) => b.daysOverdue - a.daysOverdue)[0] ??
    pool.sort((a, b) => b.daysOverdue - a.daysOverdue)[0];
  const abandon = take(deadest);

  return [
    { slot: 'finish', suggested: finish, why: 'the smallest thing here, by your own estimate' },
    {
      slot: 'reschedule',
      suggested: reschedule,
      why: 'the largest — the one that may genuinely need more time',
    },
    {
      slot: 'abandon',
      suggested: abandon,
      why: abandon?.neverStarted
        ? `never started, and ${abandon.daysOverdue} days past due`
        : 'the oldest one left',
    },
  ];
}

export async function getRecoveryState(
  ownerId: string,
  now: Date = new Date(),
): Promise<RecoveryState> {
  const counts = await overdueCounts(ownerId, now);
  const active = recoveryIsWarranted(counts);

  const open = await RecoverySessionModel.findOne({ ownerId, endedAt: null }).lean();

  if (!active) {
    /**
     * Leaving is derived too: the counts dropped below the thresholds, so the
     * episode is over. Recorded once, on the read that observes it.
     */
    if (open) {
      const closed = await RecoverySessionModel.updateOne(
        { ownerId, _id: open._id, endedAt: null },
        { $set: { endedAt: now } },
      );

      // The conditional update is what makes this idempotent under concurrent
      // reads: exactly one invocation flips it, and only that one logs.
      if ((closed.modifiedCount ?? 0) > 0) {
        await appendEvent({
          type: 'RECOVERY_MODE_EXITED',
          entityType: 'recovery',
          entityId: String(open._id),
          ownerId,
          ts: now,
          source: 'system',
          payload: {
            passes: open.passes,
            startedAt: open.startedAt.toISOString(),
            endedWith: counts,
          },
        });
      }
    }

    return {
      active: false,
      counts: { needsReckoning: counts.needsReckoning, overdue: counts.total },
      thresholds: RECOVERY_THRESHOLDS,
      session: null,
      slots: [],
      candidates: [],
    };
  }

  let session: { startedAt: Date; passes: number } | null = open;
  if (!session) {
    try {
      const created = await RecoverySessionModel.create({
        ownerId,
        startedAt: now,
        endedAt: null,
        startedWith: { needsReckoning: counts.needsReckoning, overdue: counts.total },
        passes: 0,
        resolved: [],
      });

      await appendEvent({
        type: 'RECOVERY_MODE_ENTERED',
        entityType: 'recovery',
        entityId: String(created._id),
        ownerId,
        ts: now,
        source: 'system',
        payload: { needsReckoning: counts.needsReckoning, overdue: counts.total },
      });

      // Built from what was just written rather than read back: the values are
      // already here, and a second round trip to learn them is a round trip.
      session = { startedAt: now, passes: 0 };
    } catch (error) {
      // Another invocation observed the same thresholds at the same instant and
      // won the unique index. That is success, not a failure.
      if (!isDuplicateKeyError(error)) throw error;
      session = await RecoverySessionModel.findOne({ ownerId, endedAt: null }).lean();
    }
  }

  const rows = await CommitmentModel.find({
    ownerId,
    status: { $in: ['pending', 'in-progress', 'blocked'] },
    dueAt: { $lt: now },
  })
    .sort({ dueAt: 1 })
    .limit(POOL)
    .lean();

  const candidates = rows.map((row) => toCandidate(row as Record<string, unknown>, now));

  return {
    active: true,
    counts: { needsReckoning: counts.needsReckoning, overdue: counts.total },
    thresholds: RECOVERY_THRESHOLDS,
    session: session
      ? { startedAt: session.startedAt.toISOString(), passes: session.passes }
      : null,
    slots: pickSlots(candidates),
    candidates,
  };
}

export interface ResolveResult {
  slot: RecoverySlot;
  effect: string;
  state: RecoveryState;
}

/**
 * Dispatches one commitment one way.
 *
 * Every branch goes through the ordinary service, not around it. Recovery mode
 * is a different SURFACE for the same rules -- a backlog is exactly when it
 * would be tempting to let a reschedule skip its reckoning, and exactly when
 * doing so would destroy the record that explains how the backlog happened.
 */
export async function resolveSlot(
  input: ResolveSlotInput,
  ownerId: string,
  now: Date = new Date(),
): Promise<ResolveResult> {
  const parsed = resolveSlotSchema.parse(input);

  const before = await overdueCounts(ownerId, now);
  if (!recoveryIsWarranted(before)) {
    throw new CommitmentError('Recovery mode is not active.', 409);
  }

  let effect: string;

  switch (parsed.slot) {
    case 'finish': {
      await completeCommitment(parsed.commitmentId, ownerId, now);

      /**
       * The note is a separate write because completion does not take one.
       * Kept anyway: "what changed" is the only thing that distinguishes a
       * commitment finished from one ticked off, and recovery mode is exactly
       * where the difference matters.
       */
      if (parsed.note) {
        await CommitmentModel.updateOne(
          { _id: parsed.commitmentId, ownerId },
          { $set: { notes: parsed.note } },
        );
      }

      effect = 'Completed. Late, and recorded as late.';
      break;
    }

    case 'reschedule': {
      /**
       * An unanswered miss cannot be rescheduled -- `changeDeadline` refuses
       * it, and that refusal is the reckoning feature. So this answers the
       * miss first, with the concrete next action as its recovery, and only
       * then moves the deadline.
       *
       * A reckoning already recorded for this deadline comes back as a no-op
       * rather than an error, so a retried request does not fail here.
       */
      await submitReckoning(
        parsed.commitmentId,
        {
          completed: false,
          reason: parsed.reason,
          recovery: { action: 'define-next-action', nextAction: parsed.nextAction },
        },
        ownerId,
        now,
      );

      await changeDeadline(
        parsed.commitmentId,
        {
          newDueAt: parsed.newDueAt,
          reason: parsed.nextAction,
          // Derived from the miss reason, and shown before submitting. See
          // CATEGORY_FOR_MISS_REASON.
          category: CATEGORY_FOR_MISS_REASON[parsed.reason],
        },
        ownerId,
        now,
      );

      effect = `Answered and moved. Recorded as ${CATEGORY_FOR_MISS_REASON[parsed.reason]}.`;
      break;
    }

    case 'abandon': {
      await abandonCommitment(parsed.commitmentId, parsed.reason, ownerId, now);
      effect = 'Abandoned, with the reason on the record.';
      break;
    }
  }

  /**
   * A pass is three slots dispatched. Counting resolved ids rather than
   * incrementing blindly means a double-tap on one slot does not advance it.
   */
  const session = await RecoverySessionModel.findOne({ ownerId, endedAt: null }).lean();
  if (session) {
    const resolved = new Set([...session.resolved, parsed.commitmentId]);
    await RecoverySessionModel.updateOne(
      { ownerId, _id: session._id, endedAt: null },
      { $set: { resolved: [...resolved], passes: Math.floor(resolved.size / 3) } },
    );
  }

  return { slot: parsed.slot, effect, state: await getRecoveryState(ownerId, now) };
}
