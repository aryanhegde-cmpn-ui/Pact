import 'server-only';

import { deferPastQuietHours } from '@/lib/behavior/scheduling';
import { NotificationModel } from '@/lib/db/models/notification';
import type { ResolvedSettings } from '@/lib/notifications/settings';
import {
  ACCOUNTABILITY_DELAY_MINUTES,
  type NotificationChannel,
  type NotificationType,
} from '@/lib/schemas/notification';

const DUPLICATE_KEY = 11_000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === DUPLICATE_KEY
  );
}

/**
 * Channels a notification is enqueued for.
 *
 * Only `in-app` is delivered in this change. When web push lands it is added
 * here and every enqueue site starts producing both rows -- the wiring, the
 * cancellation and the delivery rules already work per-channel, so nothing
 * else has to change.
 */
export const ACTIVE_CHANNELS: readonly NotificationChannel[] = ['in-app'];

export interface CommitmentForQueue {
  id: string;
  title: string;
  outcome: string;
  dueAt: Date;
  estimateMinutes: number;
  priority: string;
  /** Per-commitment override of the lead time, in minutes. */
  leadMinutes?: number | null;
}

interface PlannedNotification {
  type: NotificationType;
  scheduledFor: Date;
  payload: Record<string, unknown>;
}

/**
 * What a commitment's deadline implies, before quiet hours are applied.
 *
 * Pure and exported so the plan can be asserted directly, without a database.
 */
export function planForCommitment(
  commitment: CommitmentForQueue,
  settings: ResolvedSettings,
): PlannedNotification[] {
  const lead = commitment.leadMinutes ?? settings.defaultLeadMinutes;
  const due = commitment.dueAt.getTime();

  const common = {
    title: commitment.title,
    outcome: commitment.outcome,
    estimateMinutes: commitment.estimateMinutes,
    priority: commitment.priority,
    dueAt: commitment.dueAt.toISOString(),
  };

  return [
    {
      type: 'DEADLINE_APPROACHING',
      scheduledFor: new Date(due - lead * 60_000),
      payload: { ...common, leadMinutes: lead },
    },
    {
      type: 'DEADLINE_NOW',
      scheduledFor: commitment.dueAt,
      payload: common,
    },
    {
      type: 'ACCOUNTABILITY_CHECK',
      scheduledFor: new Date(due + ACCOUNTABILITY_DELAY_MINUTES * 60_000),
      payload: { ...common, delayMinutes: ACCOUNTABILITY_DELAY_MINUTES },
    },
  ];
}

export interface EnqueueResult {
  created: number;
  /**
   * Rows that already existed and were brought back to pending.
   *
   * This is not a rare path. Cancelling sets `status: 'cancelled'` but leaves
   * the row in place, and the unique key does not include status -- so
   * re-enqueueing anything at a previously-used instant collides with a
   * cancelled row. Treating that collision as "already queued" would leave the
   * commitment with NO pending notifications at all, which is the same silent
   * failure as never enqueueing.
   *
   * Moving a deadline forward and then back again is the obvious way to hit
   * it, and it produces a commitment that never notifies you.
   */
  revived: number;
  /** Rows another request had already queued and which are already live. */
  duplicates: number;
}

/**
 * Queues a commitment's notifications.
 *
 * Idempotent through the unique index on
 * (commitmentId, type, scheduledFor, channel) rather than by checking first,
 * which races between the check and the write.
 *
 * Quiet hours are applied here, at enqueue time, so the stored `scheduledFor`
 * is the time the notification will actually be delivered. Storing the raw
 * time and deferring at delivery would make the queue's own contents
 * misleading about when anything is going to happen.
 */
export async function enqueueForCommitment(
  commitment: CommitmentForQueue,
  settings: ResolvedSettings,
  timeZone: string,
  now: Date = new Date(),
): Promise<EnqueueResult> {
  const quiet = { start: settings.quietHoursStart, end: settings.quietHoursEnd };
  let created = 0;
  let revived = 0;
  let duplicates = 0;

  for (const planned of planForCommitment(commitment, settings)) {
    const scheduledFor = deferPastQuietHours(planned.scheduledFor, quiet, timeZone);

    for (const channel of ACTIVE_CHANNELS) {
      const payload = {
        ...planned.payload,
        // Kept so the delivered copy can say it was moved, rather than
        // silently arriving at a time the user did not choose.
        deferredFromQuietHours:
          scheduledFor.getTime() !== planned.scheduledFor.getTime()
            ? planned.scheduledFor.toISOString()
            : undefined,
      };

      const key = { commitmentId: commitment.id, type: planned.type, scheduledFor, channel };

      try {
        await NotificationModel.create({
          ...key,
          status: 'pending',
          sentAt: null,
          readAt: null,
          payload,
          createdAt: now,
        });
        created += 1;
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;

        // A row already occupies this key. Bring it back to pending unless it
        // has already been sent -- re-sending something the user has already
        // seen would be worse than not sending it at all.
        const result = await NotificationModel.updateOne(
          { ...key, status: { $ne: 'sent' } },
          { $set: { status: 'pending', sentAt: null, skipReason: null, payload } },
        );

        if ((result.modifiedCount ?? 0) > 0) revived += 1;
        else duplicates += 1;
      }
    }
  }

  return { created, revived, duplicates };
}

/**
 * Cancels every still-pending notification for a commitment.
 *
 * Only `pending` rows: something already sent is a record of what the user was
 * told, and rewriting it would make the queue lie about its own history.
 */
export async function cancelPendingForCommitment(commitmentId: string): Promise<number> {
  const result = await NotificationModel.updateMany(
    { commitmentId, status: 'pending' },
    { $set: { status: 'cancelled' } },
  );

  return result.modifiedCount ?? 0;
}

/**
 * Re-points a commitment's notifications at a new deadline.
 *
 * Cancel-then-enqueue rather than update-in-place: the schedule is derived
 * from the deadline, and recomputing it is the only way to be sure a stale row
 * cannot survive a change. This is the single most likely place for a bug in
 * this feature -- a deadline that moves while its old DEADLINE_APPROACHING
 * stays queued fires a notification about a deadline that no longer exists.
 */
export async function reenqueueForCommitment(
  commitment: CommitmentForQueue,
  settings: ResolvedSettings,
  timeZone: string,
  now: Date = new Date(),
): Promise<{ cancelled: number } & EnqueueResult> {
  const cancelled = await cancelPendingForCommitment(commitment.id);
  const enqueued = await enqueueForCommitment(commitment, settings, timeZone, now);

  return { cancelled, ...enqueued };
}
