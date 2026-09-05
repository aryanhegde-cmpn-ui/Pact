import { z } from 'zod';

/**
 * Notification types.
 *
 * Accountability framing, not reminders. The distinction is the product: a
 * reminder tells you a thing exists, an accountability prompt asks whether you
 * did what you said you would.
 */
export const notificationTypeSchema = z.enum([
  /** Ahead of the deadline. States the commitment, its estimate and time left. */
  'DEADLINE_APPROACHING',
  /** The deadline itself. */
  'DEADLINE_NOW',
  /** After a missed deadline. Asks whether it was done, and takes either answer. */
  'ACCOUNTABILITY_CHECK',
  /** One per day, at a configured local time. */
  'DAILY_REVIEW',
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/**
 * Delivery channels.
 *
 * `in-app` is the only one delivered in this change. `web-push` exists in the
 * enum now so the queue, the wiring and the delivery rules are already
 * channel-agnostic -- adding push is then a delivery adapter plus a
 * subscription store, not a reshaping of everything that enqueues.
 */
export const notificationChannelSchema = z.enum(['in-app', 'web-push']);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const notificationStatusSchema = z.enum(['pending', 'sent', 'skipped', 'cancelled']);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

/** Why a notification was skipped, so the log explains itself later. */
export const skipReasonSchema = z.enum([
  /** Older than the staleness cap when delivery ran. */
  'stale',
  /** Its commitment was resolved before delivery. */
  'resolved',
]);
export type SkipReason = z.infer<typeof skipReasonSchema>;

export const notificationSchema = z.object({
  commitmentId: z.string().nullable(),
  type: notificationTypeSchema,
  scheduledFor: z.date(),
  channel: notificationChannelSchema,
  status: notificationStatusSchema,
  sentAt: z.date().nullable(),
  readAt: z.date().nullable(),
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.date(),
});
export type PactNotification = z.infer<typeof notificationSchema>;

/** How long before the deadline DEADLINE_APPROACHING fires, unless overridden. */
export const DEFAULT_LEAD_MINUTES = 30;

/** How long after a missed deadline ACCOUNTABILITY_CHECK fires. */
export const ACCOUNTABILITY_DELAY_MINUTES = 15;

/**
 * Anything scheduled more than this far in the past is skipped, not sent.
 *
 * Without it, opening the app after a quiet week delivers every notification
 * that came due while it was closed -- forty at once, which teaches exactly one
 * lesson: ignore them. A notification about a deadline that passed on Tuesday
 * has no action attached to it by Friday.
 */
export const STALENESS_CAP_MINUTES = 120;

/** Per-user settings. One document; this app has one user. */
export const settingsSchema = z.object({
  /** Local wall clock, `HH:MM`, in APP_TIMEZONE. */
  quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  /** When DAILY_REVIEW fires, local wall clock. */
  dailyReviewAt: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  defaultLeadMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
  updatedAt: z.date(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS = {
  quietHoursStart: '00:00',
  quietHoursEnd: '07:00',
  dailyReviewAt: '07:30',
  defaultLeadMinutes: DEFAULT_LEAD_MINUTES,
} as const;

export const updateSettingsSchema = settingsSchema
  .omit({ updatedAt: true })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'No settings to update' });
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
