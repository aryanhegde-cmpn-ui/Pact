import 'server-only';

import { decideDelivery } from '@/lib/behavior/scheduling';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { NotificationModel } from '@/lib/db/models/notification';
import type { NotificationType } from '@/lib/schemas/notification';

/**
 * Delivery, run on read.
 *
 * There is no scheduler -- Vercel Hobby allows one daily cron -- so whichever
 * request arrives after a notification comes due is the thing that delivers it.
 * That is also why the staleness cap exists: the gap between "due" and
 * "delivered" is however long the app stayed closed.
 */

/** How many rows one pass will consider. A bound, so a long absence cannot stall a request. */
const BATCH = 200;

export interface DeliveryReport {
  sent: number;
  skippedStale: number;
  skippedResolved: number;
}

export async function deliverDue(now: Date = new Date()): Promise<DeliveryReport> {
  const due = await NotificationModel.find({ status: 'pending', scheduledFor: { $lte: now } })
    .sort({ scheduledFor: 1 })
    .limit(BATCH)
    .lean();

  if (due.length === 0) return { sent: 0, skippedStale: 0, skippedResolved: 0 };

  // One query for the commitments involved, rather than one per notification.
  const commitmentIds = [
    ...new Set(due.map((row) => row.commitmentId).filter(Boolean)),
  ] as string[];
  const commitments = await CommitmentModel.find(
    { _id: { $in: commitmentIds } },
    { status: 1 },
  ).lean();
  const statusById = new Map(commitments.map((c) => [String(c._id), c.status]));

  const report: DeliveryReport = { sent: 0, skippedStale: 0, skippedResolved: 0 };
  const sendIds: unknown[] = [];
  const skipStaleIds: unknown[] = [];
  const skipResolvedIds: unknown[] = [];

  for (const row of due) {
    const status = row.commitmentId ? statusById.get(row.commitmentId) : undefined;

    // A commitment that has vanished is treated as resolved rather than sent
    // about; the alternative is a notification pointing at nothing.
    const commitmentResolved = row.commitmentId
      ? status === undefined || status === 'done' || status === 'abandoned'
      : false;

    const decision = decideDelivery(
      { type: row.type as NotificationType, scheduledFor: row.scheduledFor },
      { commitmentResolved },
      now,
    );

    if (decision.action === 'hold') continue;
    if (decision.action === 'send') {
      sendIds.push(row._id);
      report.sent += 1;
      continue;
    }

    if (decision.reason === 'stale') {
      skipStaleIds.push(row._id);
      report.skippedStale += 1;
    } else {
      skipResolvedIds.push(row._id);
      report.skippedResolved += 1;
    }
  }

  // Three bulk writes rather than one per row: a week's backlog is one round
  // trip each, not two hundred.
  if (sendIds.length > 0) {
    await NotificationModel.updateMany(
      { _id: { $in: sendIds } },
      { $set: { status: 'sent', sentAt: now } },
    );
  }
  if (skipStaleIds.length > 0) {
    await NotificationModel.updateMany(
      { _id: { $in: skipStaleIds } },
      { $set: { status: 'skipped', skipReason: 'stale' } },
    );
  }
  if (skipResolvedIds.length > 0) {
    await NotificationModel.updateMany(
      { _id: { $in: skipResolvedIds } },
      { $set: { status: 'skipped', skipReason: 'resolved' } },
    );
  }

  return report;
}
