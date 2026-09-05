import { CommitmentList } from '@/components/commitments/commitment-list';
import { listByDateRange, listOverdue } from '@/lib/commitments/service';
import { getEnv } from '@/lib/env';
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
  const [commitments, overdue] = await Promise.all([
    listByDateRange(today, today, timeZone, now),
    listOverdue(now),
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
        initial={{ commitments, overdue: overdue.filter((c) => !inRange.has(c.id)) }}
        timeZone={timeZone}
        today={today}
      />
    </div>
  );
}
