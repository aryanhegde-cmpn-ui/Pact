import 'server-only';

import webpush from 'web-push';

import { PushSubscriptionModel } from '@/lib/db/models/push-subscription';
import { getEnv } from '@/lib/env';
import { MAX_CONSECUTIVE_FAILURES, type PushPayload } from '@/lib/schemas/push';

/**
 * Web push delivery.
 *
 * A second channel over the existing queue, not a second queue. Everything
 * about scheduling -- enqueueing, cancellation, quiet hours, the staleness cap
 * -- already happened by the time anything reaches here. This module's only
 * job is to encrypt a payload, hand it to a push service, and act on what
 * comes back.
 */

let configured = false;

/**
 * Configures VAPID lazily.
 *
 * Not at module load: `next build` imports every route module, and the keys
 * are optional, so doing this on import would either crash a build that has
 * not set them up or silently configure with undefined.
 */
function configure(): boolean {
  if (configured) return true;

  const env = getEnv();
  if (!env.VAPID_PRIVATE_KEY || !env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return false;

  webpush.setVapidDetails(
    env.VAPID_SUBJECT ?? 'mailto:pact@localhost',
    env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
  configured = true;

  return true;
}

export function isPushConfigured(): boolean {
  return configure();
}

/** Test-only: forces reconfiguration after env changes. */
export function __resetPushConfigForTests(): void {
  configured = false;
}

export type SubscriptionOutcome =
  | { endpoint: string; result: 'sent' }
  | { endpoint: string; result: 'deleted'; reason: 'gone' | 'too-many-failures'; status?: number }
  | { endpoint: string; result: 'failed'; status?: number; failureCount: number };

export interface SendReport {
  attempted: number;
  sent: number;
  deleted: number;
  failed: number;
  outcomes: SubscriptionOutcome[];
}

/**
 * Sends one payload to every subscription a user holds.
 *
 * Errors are handled per subscription rather than per send: one dead endpoint
 * must not stop the others from receiving anything.
 */
export async function sendToUser(
  userId: string,
  payload: PushPayload,
  now: Date = new Date(),
): Promise<SendReport> {
  const report: SendReport = { attempted: 0, sent: 0, deleted: 0, failed: 0, outcomes: [] };

  if (!configure()) return report;

  const subscriptions = await PushSubscriptionModel.find({ userId }).lean();
  report.attempted = subscriptions.length;

  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (subscription) => {
      // Mongoose types a nested subdocument as optional. A row without keys
      // cannot be encrypted for, so drop it rather than send garbage.
      if (!subscription.keys?.p256dh || !subscription.keys?.auth) {
        await PushSubscriptionModel.deleteOne({ endpoint: subscription.endpoint });
        report.deleted += 1;
        report.outcomes.push({
          endpoint: subscription.endpoint,
          result: 'deleted',
          reason: 'gone',
        });
        return;
      }

      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
          },
          body,
          // The push service holds the message this long if the device is
          // offline. Beyond a few hours the staleness cap would have skipped
          // it anyway, so there is no point asking for longer.
          { TTL: 2 * 60 * 60 },
        );

        await PushSubscriptionModel.updateOne(
          { endpoint: subscription.endpoint },
          // Reset on success: a device offline for a day then back must not
          // inherit yesterday's failures and get deleted.
          { $set: { lastSuccessAt: now, failureCount: 0, lastFailureReason: null } },
        );

        report.sent += 1;
        report.outcomes.push({ endpoint: subscription.endpoint, result: 'sent' });
      } catch (error) {
        const outcome = await handleSendFailure(subscription.endpoint, error, now);
        report.outcomes.push(outcome);
        if (outcome.result === 'deleted') report.deleted += 1;
        else report.failed += 1;
      }
    }),
  );

  return report;
}

/**
 * Decides what a failed send means for the subscription.
 *
 * 404 and 410 are definitive: the push service is telling us this endpoint no
 * longer exists, and it will never exist again. Deleting immediately is
 * correct -- retrying is guaranteed to fail and the row would otherwise live
 * forever, generating an error on every tick until it is the only thing in the
 * logs.
 *
 * Everything else is ambiguous -- a timeout, a 500, a network blip -- where one
 * failure proves nothing. Those accumulate, and five consecutive ones mean
 * nobody is listening.
 */
async function handleSendFailure(
  endpoint: string,
  error: unknown,
  now: Date,
): Promise<SubscriptionOutcome> {
  const status = statusOf(error);

  if (status === 404 || status === 410) {
    await PushSubscriptionModel.deleteOne({ endpoint });
    return { endpoint, result: 'deleted', reason: 'gone', status };
  }

  const updated = await PushSubscriptionModel.findOneAndUpdate(
    { endpoint },
    {
      $inc: { failureCount: 1 },
      $set: { lastFailureAt: now, lastFailureReason: messageOf(error).slice(0, 200) },
    },
    { new: true },
  ).lean();

  const failureCount = updated?.failureCount ?? 0;

  if (failureCount >= MAX_CONSECUTIVE_FAILURES) {
    await PushSubscriptionModel.deleteOne({ endpoint });
    return { endpoint, result: 'deleted', reason: 'too-many-failures', status };
  }

  return { endpoint, result: 'failed', status, failureCount };
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const status = (error as { statusCode: unknown }).statusCode;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
