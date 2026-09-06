import { z } from 'zod';

/**
 * A browser PushSubscription, as the client serialises it.
 *
 * The shape is dictated by the Push API, not by us: `endpoint` identifies the
 * push service's delivery URL for this device, and `keys` carries the material
 * the payload is encrypted with.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z.url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const registerSubscriptionSchema = pushSubscriptionSchema.extend({
  /** Purely for the device list in settings; never used for routing. */
  userAgent: z.string().max(500).optional(),
});
export type RegisterSubscriptionInput = z.infer<typeof registerSubscriptionSchema>;

/**
 * Consecutive failures before a subscription is deleted.
 *
 * 404 and 410 delete immediately -- those are definitive. This covers the
 * ambiguous errors (timeouts, 500s from the push service) where one failure
 * proves nothing but five in a row means nobody is listening. A dead
 * subscription retried forever eventually becomes the only thing in the logs.
 */
export const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * How stale the last successful dispatch may be before the UI warns.
 *
 * The external tick fires every minute, so 15 minutes is roughly fifteen
 * consecutive misses -- far past coincidence. Cloudflare cron does not retry
 * and raises no alert, so without this, push can stop for a week unnoticed.
 */
export const DISPATCH_STALE_MINUTES = 15;

/**
 * The push payload.
 *
 * Push services cap payloads near 4KB, and the encryption overhead eats into
 * that, so this carries an identifier and short text rather than a commitment
 * document. The worker has enough to render a notification; anything more is
 * fetched when the app opens.
 */
export const pushPayloadSchema = z.object({
  notificationId: z.string(),
  commitmentId: z.string().nullable(),
  type: z.string(),
  title: z.string().max(120),
  body: z.string().max(400),
  /** Groups replacements: a re-send for the same commitment replaces rather than stacks. */
  tag: z.string().max(80),
  url: z.string().max(200),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;
