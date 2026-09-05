import 'server-only';

import { SettingsModel } from '@/lib/db/models/settings';
import { DEFAULT_SETTINGS, type UpdateSettingsInput } from '@/lib/schemas/notification';

export interface ResolvedSettings {
  quietHoursStart: string;
  quietHoursEnd: string;
  dailyReviewAt: string;
  defaultLeadMinutes: number;
}

/**
 * The settings document, created on first read if absent.
 *
 * Upserted rather than inserted-if-missing, so two concurrent first requests
 * cannot each create one.
 */
export async function getSettings(): Promise<ResolvedSettings> {
  const doc = await SettingsModel.findOneAndUpdate(
    { key: 'singleton' },
    { $setOnInsert: { ...DEFAULT_SETTINGS, updatedAt: new Date() } },
    { upsert: true, new: true },
  ).lean();

  return {
    quietHoursStart: doc?.quietHoursStart ?? DEFAULT_SETTINGS.quietHoursStart,
    quietHoursEnd: doc?.quietHoursEnd ?? DEFAULT_SETTINGS.quietHoursEnd,
    dailyReviewAt: doc?.dailyReviewAt ?? DEFAULT_SETTINGS.dailyReviewAt,
    defaultLeadMinutes: doc?.defaultLeadMinutes ?? DEFAULT_SETTINGS.defaultLeadMinutes,
  };
}

export async function updateSettings(input: UpdateSettingsInput): Promise<ResolvedSettings> {
  await SettingsModel.updateOne(
    { key: 'singleton' },
    { $set: { ...input, updatedAt: new Date() } },
    { upsert: true },
  );

  return getSettings();
}
