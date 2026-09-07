import { NotificationSettings } from '@/components/settings/notification-settings';
import { VacationToggle } from '@/components/settings/vacation-toggle';
import { redirect } from 'next/navigation';

import { currentActor } from '@/lib/api/guard';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getSettings } from '@/lib/notifications/settings';
import { getVacationState } from '@/lib/stakes/vacation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage(): Promise<React.JSX.Element> {
  await connectToDatabase();
  const actor = await currentActor();
  if (!actor) redirect('/');

  const [settings, vacation] = await Promise.all([
    getSettings(actor.ownerId),
    getVacationState(actor.ownerId),
  ]);

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-text/50 mt-2xs text-sm">Notifications and devices.</p>
      </header>

      <VacationToggle initial={vacation} />

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
