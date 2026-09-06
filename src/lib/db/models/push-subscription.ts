import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

/**
 * A registered push endpoint.
 *
 * One user holds SEVERAL of these over time -- one per browser, and a new one
 * whenever a browser rotates its subscription. Sends go to all of them: the
 * user is at whichever device they are at, and guessing wrong means the
 * notification does not arrive.
 */
const pushSubscriptionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    /**
     * The push service's delivery URL. Unique because a browser re-registering
     * the same endpoint must update the existing row rather than accumulate
     * duplicates that each get their own copy of every notification.
     */
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    /** Only so the device list in settings is recognisable. Never used for routing. */
    userAgent: { type: String, default: '' },
    createdAt: { type: Date, required: true, default: () => new Date() },
    lastSuccessAt: { type: Date, default: null },
    /**
     * Consecutive failures. Reset to zero on any success, so a device that is
     * merely offline for a day is not deleted -- only one that has failed
     * repeatedly with nothing in between.
     */
    failureCount: { type: Number, required: true, default: 0 },
    lastFailureAt: { type: Date, default: null },
    lastFailureReason: { type: String, default: null },
  },
  { collection: 'push_subscriptions', versionKey: false },
);

export type PushSubscriptionDocument = InferSchemaType<typeof pushSubscriptionSchema>;

export const PushSubscriptionModel: Model<PushSubscriptionDocument> =
  (mongoose.models.PushSubscription as Model<PushSubscriptionDocument> | undefined) ??
  mongoose.model<PushSubscriptionDocument>('PushSubscription', pushSubscriptionSchema);
