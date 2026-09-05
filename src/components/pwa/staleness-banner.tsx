'use client';

import { useEffect, useState } from 'react';

/**
 * Staleness banner.
 *
 * The service worker marks any response it served from cache with
 * `x-pact-stale` and the time it was stored. This renders that.
 *
 * The rule this exists to enforce: a cached commitment list is a list of
 * deadlines that may already have passed, and showing it as current tells the
 * user they have time they do not have. Being offline is an inconvenience;
 * being confidently wrong about a deadline is the failure this whole app is
 * built to prevent.
 */
export function StalenessBanner({
  cachedAt,
  onRetry,
}: {
  cachedAt: string | null;
  onRetry?: () => void;
}): React.JSX.Element | null {
  const [, forceTick] = useState(0);

  // Re-renders so "3 minutes ago" does not sit frozen while the user reads it.
  useEffect(() => {
    if (!cachedAt) return;
    const timer = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [cachedAt]);

  if (!cachedAt) return null;

  return (
    <div
      role="status"
      className="border-signal/50 bg-signal/10 flex flex-wrap items-center justify-between gap-sm rounded-md border px-md py-sm"
    >
      <div>
        <p className="text-signal text-sm font-medium">Offline — showing saved data</p>
        <p className="text-text/60 mt-2xs text-xs">
          Last updated {formatAgo(cachedAt)}. Deadlines may have passed since.
        </p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="border-signal/50 min-h-11 shrink-0 rounded border px-md text-sm"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

/** Relative, with the absolute time once it stops being obvious. */
export function formatAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  // Past a day, "2 days ago" is less useful than the actual moment.
  return `on ${then.toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}
