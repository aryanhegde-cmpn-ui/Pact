import 'server-only';

import { SettingsModel } from '@/lib/db/models/settings';
import { DEFAULT_SETTINGS, type UpdateSettingsInput } from '@/lib/schemas/notification';

export interface ResolvedSettings {
  quietHoursStart: string;
  quietHoursEnd: string;
  dailyReviewAt: string;
  defaultLeadMinutes: number;
  disabledTypes: string[];
  /** Whether the overseer may read free-text notes. Default false. */
  shareNotesWithOverseer: boolean;
  /** Null until the first dispatch has run. */
  lastDispatchAt: Date | null;
}

/**
 * The settings document, created on first read if absent.
 *
 * Upserted rather than inserted-if-missing, so two concurrent first requests
 * cannot each create one.
 */
export async function getSettings(ownerId: string): Promise<ResolvedSettings> {
  const doc = await SettingsModel.findOneAndUpdate(
    { ownerId },
    { $setOnInsert: { ...DEFAULT_SETTINGS, ownerId, updatedAt: new Date() } },
    // The post-insert document, so a first read returns the defaults that were
    // just written rather than null.
    { upsert: true, returnDocument: 'after' },
  ).lean();

  return {
    quietHoursStart: doc?.quietHoursStart ?? DEFAULT_SETTINGS.quietHoursStart,
    quietHoursEnd: doc?.quietHoursEnd ?? DEFAULT_SETTINGS.quietHoursEnd,
    dailyReviewAt: doc?.dailyReviewAt ?? DEFAULT_SETTINGS.dailyReviewAt,
    defaultLeadMinutes: doc?.defaultLeadMinutes ?? DEFAULT_SETTINGS.defaultLeadMinutes,
    disabledTypes: doc?.disabledTypes ?? [],
    shareNotesWithOverseer: doc?.shareNotesWithOverseer ?? false,
    lastDispatchAt: doc?.lastDispatchAt ?? null,
  };
}

export async function updateSettings(
  input: UpdateSettingsInput,
  ownerId: string,
): Promise<ResolvedSettings> {
  await SettingsModel.updateOne(
    { ownerId },
    { $set: { ...input, ownerId, updatedAt: new Date() } },
    { upsert: true },
  );

  return getSettings(ownerId);
}
