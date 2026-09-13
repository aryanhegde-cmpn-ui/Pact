import { NotificationSettings } from '@/components/settings/notification-settings';
import { RecoveryCodesSection } from '@/components/settings/recovery-codes-section';
import { VacationToggle } from '@/components/settings/vacation-toggle';
import { redirect } from 'next/navigation';

import { currentActor } from '@/lib/api/guard';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getSettings } from '@/lib/notifications/settings';
import { remainingRecoveryCodes } from '@/lib/auth/account-recovery';
import { getVacationState } from '@/lib/stakes/vacation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage(): Promise<React.JSX.Element> {
  await connectToDatabase();
  const actor = await currentActor();
  if (!actor) redirect('/');

  const [settings, vacation, recoveryCodesLeft] = await Promise.all([
    getSettings(actor.ownerId),
    getVacationState(actor.ownerId),
    // The caller's OWN login, so `userId` rather than `ownerId`: an overseer's
    // codes are theirs, not the primary's.
    remainingRecoveryCodes(actor.userId),
  ]);

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-text/50 mt-2xs text-sm">Notifications and devices.</p>
      </header>

      <VacationToggle initial={vacation} />

      <RecoveryCodesSection remaining={recoveryCodesLeft} />

      <NotificationSettings
        initial={{
          quietHoursStart: settings.quietHoursStart,
          quietHoursEnd: settings.quietHoursEnd,
          dailyReviewAt: settings.dailyReviewAt,
          defaultLeadMinutes: settings.defaultLeadMinutes,
          disabledTypes: settings.disabledTypes,
          shareNotesWithOverseer: settings.shareNotesWithOverseer,
        }}
      />
    </div>
  );
}
