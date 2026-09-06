import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

import {
  notificationChannelSchema,
  notificationStatusSchema,
  notificationTypeSchema,
} from '@/lib/schemas/notification';

/**
 * The notification queue.
 *
 * Rows are enqueued when a commitment is created or its deadline moves, and
 * delivered on read -- there is no scheduler. Vercel Hobby allows one daily
 * cron, so anything that must happen at a particular minute happens when a
 * request next arrives.
 *
 * `channel` is on the row rather than implied, so adding web push is a second
 * delivery adapter reading the same queue rather than a parallel queue that
 * can drift out of step with this one.
 *
 * Unlike the event log, this collection IS mutable: a queued notification is
 * not a historical fact, it is an intention that can be cancelled or
 * superseded. Facts about what the user did go in the event log.
 */
const notificationSchema = new mongoose.Schema(
  {
    /** Null for notifications not about one commitment, such as DAILY_REVIEW. */
    commitmentId: { type: String, default: null, index: true },
    type: { type: String, required: true, enum: notificationTypeSchema.options },
    scheduledFor: { type: Date, required: true },
    channel: { type: String, required: true, enum: notificationChannelSchema.options },
    status: {
      type: String,
      required: true,
      enum: notificationStatusSchema.options,
      default: 'pending',
    },
    sentAt: { type: Date, default: null },
    /** Set when the user has seen it. In-app only; a pushed notification has no read state. */
    readAt: { type: Date, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, required: true, default: () => new Date() },
    /** Why it was skipped, so the queue explains itself rather than just going quiet. */
    skipReason: { type: String, default: null },
  },
  { collection: 'notifications', versionKey: false },
);

/**
 * One notification per commitment, type and instant.
 *
 * Re-enqueueing after a deadline change recomputes the same rows for anything
 * that did not move, and concurrent requests can enqueue at the same moment.
 * The index makes both harmless: a duplicate key means someone already queued
 * it, which is success.
 *
 * `channel` is in the key because the same commitment legitimately gets the
 * same notification on two channels once web push exists.
 */
notificationSchema.index(
  { commitmentId: 1, type: 1, scheduledFor: 1, channel: 1 },
  { unique: true },
);

// Delivery reads pending rows that are now due, oldest first.
notificationSchema.index({ status: 1, scheduledFor: 1 });
// The unread indicator counts sent-and-unread in-app rows.
notificationSchema.index({ channel: 1, status: 1, readAt: 1 });

export type NotificationDocument = InferSchemaType<typeof notificationSchema>;

export const NotificationModel: Model<NotificationDocument> =
  (mongoose.models.Notification as Model<NotificationDocument> | undefined) ??
  mongoose.model<NotificationDocument>('Notification', notificationSchema);
