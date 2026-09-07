import { CommitmentList } from '@/components/commitments/commitment-list';
import { RecoveryMode } from '@/components/recovery/recovery-mode';
import { getRecoveryState } from '@/lib/commitments/recovery';
import { listByDateRange, listOverdue } from '@/lib/commitments/service';
import { redirect } from 'next/navigation';

import { currentActor } from '@/lib/api/guard';
import { getEnv } from '@/lib/env';
import { getSettings } from '@/lib/notifications/settings';
import { toDateKey } from '@/lib/time';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Dashboard' };

/**
 * The interactive surface.
 *
 * Rendered on the server so the first paint already has the data: this is
 * opened on a phone, often on a slow connection, and a spinner followed by a
 * list is a worse answer to "what have I committed to today?" than the list.
 */
export default async function DashboardPage(): Promise<React.JSX.Element> {
  const timeZone = getEnv().APP_TIMEZONE;
  const now = new Date();
  const today = toDateKey(now, timeZone);

  // Reading is what materialises series occurrences and records observed
  // misses -- there is no scheduler doing it beforehand.
  const actor = await currentActor();
  if (!actor) redirect('/');
  const ownerId = actor.ownerId;

  /**
   * Recovery mode REPLACES this page. It is not a banner on top of it.
   *
   * A backlog past the thresholds makes the normal dashboard actively harmful:
   * a long overdue list invites rescheduling all of it, and the result is a
   * bigger plan than the one already not being kept. So the list, the
   * curriculum, the drift and the metrics all go, and three commitments with
   * three different dispositions take their place.
   *
   * Checked first and returned early, so none of the rest is even queried.
   */
  const recovery = await getRecoveryState(ownerId, now);
  if (recovery.active) return <RecoveryMode initial={recovery} />;

  const [commitments, overdue, settings] = await Promise.all([
    listByDateRange(today, today, timeZone, ownerId, now),
    listOverdue(ownerId, now),
    getSettings(ownerId),
  ]);

  const inRange = new Set(commitments.map((c) => c.id));

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Today</h1>
        <p className="text-text/50 mt-2xs text-sm">
          {new Intl.DateTimeFormat('en-GB', {
            timeZone,
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }).format(now)}
        </p>
      </header>

      <CommitmentList
        initial={{
          commitments,
          overdue: overdue.commitments.filter((c) => !inRange.has(c.id)),
          // The page is bounded, so the surface has to say what it is a page
          // OF. "15" with no denominator reads as "15 overdue".
          overdueTotal: overdue.total,
          needsReckoningTotal: overdue.needsReckoning,
        }}
        timeZone={timeZone}
        today={today}
        // Public by design -- the browser needs it to subscribe. The private
        // half never leaves the server.
        vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY}
        lastDispatchAt={settings.lastDispatchAt?.toISOString() ?? null}
        nowIso={now.toISOString()}
      />
    </div>
  );
}
