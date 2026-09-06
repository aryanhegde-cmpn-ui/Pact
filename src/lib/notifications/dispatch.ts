import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import { decideDelivery } from '@/lib/behavior/scheduling';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { NotificationModel } from '@/lib/db/models/notification';
import { SettingsModel } from '@/lib/db/models/settings';
import { sendToUser } from '@/lib/notifications/push';
import type { NotificationType } from '@/lib/schemas/notification';
import type { PushPayload } from '@/lib/schemas/push';

/**
 * Dispatch: the push half of delivery, driven by an external per-minute tick.
 *
 * This is a QUEUE SCAN, not a moment-in-time trigger. Every invocation asks
 * "what is due now and still pending?" and acts on all of it. That is what
 * makes a missed tick self-healing: the next one picks up whatever the last
 * one did not. Nothing here may ever depend on the tick actually arriving --
 * Cloudflare cron does not retry and raises no alert, and the Vercel daily
 * backstop hits this same endpoint precisely because it is safe to run late.
 *
 * Delivery RULES are not reimplemented here: quiet hours were applied at
 * enqueue, and the staleness cap comes from `decideDelivery`, shared with the
 * in-app channel. Two copies of those rules would drift.
 */

/** Bound per invocation. A minute's tick must finish inside a function timeout. */
const BATCH = 50;

/**
 * Compares a presented secret against the expected one in constant time.
 *
 * A plain `===` returns as soon as it finds a differing byte, so response time
 * leaks how many leading characters were right, and the secret can be
 * recovered byte by byte. The length is compared first and separately because
 * `timingSafeEqual` throws on differing lengths -- length is not the secret.
 */
export function secretMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;

  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/** Extracts the bearer token, tolerating the header being absent entirely. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());

  return match?.[1] ?? null;
}

export interface DispatchReport {
  scanned: number;
  sent: number;
  skippedStale: number;
  skippedResolved: number;
  /** Rows another invocation claimed first. Expected, not an error. */
  raced: number;
  /** Sends attempted across all subscriptions, and their outcomes. */
  pushAttempted: number;
  pushSent: number;
  subscriptionsDeleted: number;
  pushFailed: number;
  durationMs: number;
}

/**
 * Scans the queue and sends everything due on the web-push channel.
 *
 * Fully idempotent: a row is claimed with a conditional update before any send,
 * so two overlapping invocations cannot both send it. The loser sees
 * `modifiedCount: 0` and moves on.
 */
export async function dispatchDue(userId: string, now: Date = new Date()): Promise<DispatchReport> {
  const startedAt = Date.now();
  const report: DispatchReport = {
    scanned: 0,
    sent: 0,
    skippedStale: 0,
    skippedResolved: 0,
    raced: 0,
    pushAttempted: 0,
    pushSent: 0,
    subscriptionsDeleted: 0,
    pushFailed: 0,
    durationMs: 0,
  };

  const due = await NotificationModel.find({
    channel: 'web-push',
    status: 'pending',
    scheduledFor: { $lte: now },
  })
    .sort({ scheduledFor: 1 })
    .limit(BATCH)
    .lean();

  report.scanned = due.length;
  if (due.length === 0) {
    await recordDispatch(now);
    report.durationMs = Date.now() - startedAt;
    return report;
  }

  const commitmentIds = [
    ...new Set(due.map((row) => row.commitmentId).filter(Boolean)),
  ] as string[];
  const commitments = await CommitmentModel.find(
    { _id: { $in: commitmentIds } },
    { status: 1, title: 1 },
  ).lean();
  const byId = new Map(commitments.map((c) => [String(c._id), c]));

  for (const row of due) {
    const commitment = row.commitmentId ? byId.get(row.commitmentId) : undefined;
    const resolved = row.commitmentId
      ? commitment === undefined ||
        commitment.status === 'done' ||
        commitment.status === 'abandoned'
      : false;

    const decision = decideDelivery(
      { type: row.type as NotificationType, scheduledFor: row.scheduledFor },
      { commitmentResolved: resolved },
      now,
    );

    if (decision.action === 'hold') continue;

    if (decision.action === 'skip') {
      // Claimed the same way, so a concurrent invocation cannot also skip it
      // and double-count.
      const claimed = await NotificationModel.updateOne(
        { _id: row._id, status: 'pending' },
        { $set: { status: 'skipped', skipReason: decision.reason } },
      );
      if ((claimed.modifiedCount ?? 0) === 0) {
        report.raced += 1;
        continue;
      }

      if (decision.reason === 'stale') report.skippedStale += 1;
      else report.skippedResolved += 1;
      continue;
    }

    /**
     * CLAIM BEFORE SENDING.
     *
     * The conditional `status: 'pending'` is the whole mechanism: exactly one
     * invocation's update matches, and the loser gets modifiedCount 0. Sending
     * first and marking after would double-send whenever two ticks overlap,
     * which is exactly what happens when one runs slow.
     *
     * The cost is that a crash between claim and send loses that one
     * notification rather than repeating it. For a deadline reminder that is
     * the right way round: a missed reminder is a gap, a duplicated one is
     * noise, and noise is what teaches someone to ignore the app.
     */
    const claimed = await NotificationModel.updateOne(
      { _id: row._id, status: 'pending' },
      { $set: { status: 'sent', sentAt: now } },
    );

    if ((claimed.modifiedCount ?? 0) === 0) {
      report.raced += 1;
      continue;
    }

    report.sent += 1;

    const payload = toPayload(row, commitment?.title);
    const send = await sendToUser(userId, payload, now);

    report.pushAttempted += send.attempted;
    report.pushSent += send.sent;
    report.subscriptionsDeleted += send.deleted;
    report.pushFailed += send.failed;

    await NotificationModel.updateOne(
      { _id: row._id },
      // Recorded per notification so a debugging session can tell "nothing was
      // sent" from "sent, but every subscription was dead".
      { $set: { deliveryOutcomes: send.outcomes } },
    );
  }

  await recordDispatch(now);
  report.durationMs = Date.now() - startedAt;

  return report;
}

/**
 * Stamps the last successful dispatch.
 *
 * Read by /api/health/detail and surfaced in the UI. Cloudflare cron does not
 * retry and sends no alert on failure, so without a timestamp the tick can
 * stop for a week and the only symptom is notifications quietly not arriving
 * -- which is indistinguishable from having nothing due.
 */
export async function recordDispatch(now: Date): Promise<void> {
  await SettingsModel.updateOne(
    { key: 'singleton' },
    { $set: { lastDispatchAt: now } },
    { upsert: true },
  );
}

/**
 * Builds the push payload.
 *
 * Push services cap payloads near 4KB and encryption overhead eats into that,
 * so this carries an identifier and short text. Everything else is fetched
 * when the app opens.
 */
function toPayload(
  row: {
    _id: unknown;
    type: string;
    commitmentId?: string | null;
    payload?: unknown;
  },
  liveTitle?: string,
): PushPayload {
  const stored = (row.payload ?? {}) as Record<string, unknown>;
  const type = row.type as NotificationType;
  // Prefer the live title: the commitment may have been renamed since it was
  // queued, and a notification naming the old title is confusing.
  const title = liveTitle ?? String(stored.title ?? 'Pact');
  const outcome = String(stored.outcome ?? '');
  const estimate = Number(stored.estimateMinutes ?? 0);

  const body =
    type === 'ACCOUNTABILITY_CHECK'
      ? `The deadline has passed. Did you do it?${outcome ? ` Done means: ${outcome}` : ''}`
      : type === 'DEADLINE_NOW'
        ? `Due now.${outcome ? ` Done means: ${outcome}` : ''}`
        : type === 'DAILY_REVIEW'
          ? 'What did you commit to today, and what is still open?'
          : `Due soon. You estimated ${estimate} min.${outcome ? ` Done means: ${outcome}` : ''}`;

  return {
    notificationId: String(row._id),
    commitmentId: row.commitmentId ?? null,
    type,
    title: title.slice(0, 120),
    body: body.slice(0, 400),
    /**
     * One tag per commitment and type, so a re-sent notification REPLACES the
     * previous one on the lock screen instead of stacking. Five copies of the
     * same reminder is how a notification channel gets muted.
     */
    tag: `${row.commitmentId ?? 'general'}:${type}`,
    url: row.commitmentId ? `/dashboard?commitment=${row.commitmentId}` : '/dashboard',
  };
}
