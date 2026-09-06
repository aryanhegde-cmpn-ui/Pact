import { NotificationSettings } from '@/components/settings/notification-settings';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getSettings } from '@/lib/notifications/settings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage(): Promise<React.JSX.Element> {
  await connectToDatabase();
  const settings = await getSettings();

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-text/50 mt-2xs text-sm">Notifications and devices.</p>
      </header>

      <NotificationSettings
        initial={{
          quietHoursStart: settings.quietHoursStart,
          quietHoursEnd: settings.quietHoursEnd,
          dailyReviewAt: settings.dailyReviewAt,
          defaultLeadMinutes: settings.defaultLeadMinutes,
          disabledTypes: settings.disabledTypes,
        }}
      />
    </div>
  );
}
