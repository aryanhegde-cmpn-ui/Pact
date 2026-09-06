'use client';

import { DISPATCH_STALE_MINUTES } from '@/lib/schemas/push';

/**
 * Warns when the external tick has stopped.
 *
 * Cloudflare cron does not retry a failed tick and raises no alert, so a
 * stopped scheduler produces exactly one symptom: notifications quietly not
 * arriving -- which is indistinguishable from having nothing due. Without this
 * banner push can stop for a week before anyone notices.
 *
 * Deliberately not shown when `lastDispatchAt` is null: that is a system that
 * has never dispatched, which is a setup step rather than a fault.
 */
export function DispatchHealthBanner({
  lastDispatchAt,
  now,
}: {
  lastDispatchAt: string | null;
  now: string;
}): React.JSX.Element | null {
  if (!lastDispatchAt) return null;

  const minutes = Math.floor(
    (new Date(now).getTime() - new Date(lastDispatchAt).getTime()) / 60_000,
  );
  if (minutes <= DISPATCH_STALE_MINUTES) return null;

  return (
    <div role="status" className="border-signal/50 bg-signal/10 rounded-md border px-md py-sm">
      <p className="text-signal text-sm font-medium">Push delivery may have stopped</p>
      <p className="text-text/60 mt-2xs text-xs">
        The last dispatch was {formatGap(minutes)} ago; it should run every minute. In-app
        notifications still work. Check the Cloudflare Worker in <code>infra/tick</code>.
      </p>
    </div>
  );
}

function formatGap(minutes: number): string {
  if (minutes < 90) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hours`;

  return `${Math.floor(hours / 24)} days`;
}
