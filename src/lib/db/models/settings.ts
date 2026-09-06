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
    /**
     * One settings document per primary.
     *
     * Was a fixed 'singleton' discriminator when there was one user. Now keyed
     * on the owner, still unique, so a concurrent upsert cannot create a second
     * row and leave the app reading whichever it happened to get.
     */
    ownerId: { type: String, required: true, unique: true, index: true },
    quietHoursStart: { type: String, required: true, default: DEFAULT_SETTINGS.quietHoursStart },
    quietHoursEnd: { type: String, required: true, default: DEFAULT_SETTINGS.quietHoursEnd },
    dailyReviewAt: { type: String, required: true, default: DEFAULT_SETTINGS.dailyReviewAt },
    defaultLeadMinutes: {
      type: Number,
      required: true,
      default: DEFAULT_SETTINGS.defaultLeadMinutes,
    },
    /**
     * Whether the overseer may read free-text notes.
     *
     * Default false, deliberately. Structured categories are always visible --
     * that is where the accountability value is. The free text is where the
     * primary is honest with themselves, and they will be less honest if they
     * know it is read.
     */
    shareNotesWithOverseer: { type: Boolean, required: true, default: false },

    /**
     * Per-type push toggles. Absent means enabled -- a type added later should
     * work without a settings migration.
     */
    disabledTypes: { type: [String], default: [] },

    /**
     * When the dispatch endpoint last completed.
     *
     * Surfaced in the UI because the external tick fails silently: Cloudflare
     * cron does not retry and raises no alert, so a stopped tick is
     * indistinguishable from having nothing due.
     */
    lastDispatchAt: { type: Date, default: null },

    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'settings', versionKey: false },
);

export type SettingsDocument = InferSchemaType<typeof settingsSchema>;

export const SettingsModel: Model<SettingsDocument> =
  (mongoose.models.Settings as Model<SettingsDocument> | undefined) ??
  mongoose.model<SettingsDocument>('Settings', settingsSchema);
