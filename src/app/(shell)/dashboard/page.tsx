import { redirect } from 'next/navigation';

import { RecoveryMode } from '@/components/recovery/recovery-mode';
import { Today } from '@/components/today/today';
import { currentActor } from '@/lib/api/guard';
import { recoveryForRequest } from '@/lib/commitments/recovery-gate';
import { getEnv } from '@/lib/env';
import { getSettings } from '@/lib/notifications/settings';
import { buildDay } from '@/lib/today/service';
import { toDateKey } from '@/lib/time';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Today' };

/**
 * Today.
 *
 * Rendered on the server so the first paint already has the day: this is
 * opened on a phone, often on a slow connection, and a spinner followed by a
 * greeting is a worse answer to "what have I committed to today?" than the
 * greeting.
 *
 * Reading is also what materialises the day's occurrences and records observed
 * misses -- there is no scheduler that will have run first.
 */
export default async function TodayPage(): Promise<React.JSX.Element> {
  const actor = await currentActor();
  if (!actor) redirect('/');

  const ownerId = actor.ownerId;

  /**
   * Recovery mode REPLACES this page. It is not a banner on top of it.
   *
   * Checked first and returned early, so none of the rest is even queried: a
   * long overdue list invites rescheduling all of it, and the result is a
   * bigger plan than the one already not being kept.
   */
  const recovery = await recoveryForRequest(ownerId);
  if (recovery.active) return <RecoveryMode initial={recovery} />;

  const timeZone = getEnv().APP_TIMEZONE;
  const now = new Date();

  const [day, settings] = await Promise.all([
    buildDay(ownerId, toDateKey(now, timeZone), now),
    getSettings(ownerId),
  ]);

  return (
    <Today
      initial={day}
      timeZone={timeZone}
      // Public by design -- the browser needs it to subscribe. The private
      // half never leaves the server.
      vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY}
      lastDispatchAt={settings.lastDispatchAt?.toISOString() ?? null}
      nowIso={now.toISOString()}
    />
  );
}
