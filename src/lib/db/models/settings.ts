import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

import { DEFAULT_SETTINGS } from '@/lib/schemas/notification';

/**
 * Settings. Exactly one document -- this app has one user.
 *
 * `key` is a fixed discriminator with a unique index rather than an implicit
 * "first document you find", so a concurrent upsert cannot create a second one
 * and leave the app reading whichever it happened to get.
 */
const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'singleton' },
    quietHoursStart: { type: String, required: true, default: DEFAULT_SETTINGS.quietHoursStart },
    quietHoursEnd: { type: String, required: true, default: DEFAULT_SETTINGS.quietHoursEnd },
    dailyReviewAt: { type: String, required: true, default: DEFAULT_SETTINGS.dailyReviewAt },
    defaultLeadMinutes: {
      type: Number,
      required: true,
      default: DEFAULT_SETTINGS.defaultLeadMinutes,
    },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'settings', versionKey: false },
);

export type SettingsDocument = InferSchemaType<typeof settingsSchema>;

export const SettingsModel: Model<SettingsDocument> =
  (mongoose.models.Settings as Model<SettingsDocument> | undefined) ??
  mongoose.model<SettingsDocument>('Settings', settingsSchema);
