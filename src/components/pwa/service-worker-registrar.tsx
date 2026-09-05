'use client';

import { useEffect, useState } from 'react';

/**
 * Service worker registration and the update prompt.
 *
 * Registered in PRODUCTION ONLY. A cached worker in development makes every
 * change look like it did not apply -- you edit a file, reload, see the old
 * output, and spend twenty minutes debugging code that was never served.
 *
 * The update flow is explicit rather than automatic. Calling skipWaiting() as
 * soon as a new worker arrives swaps the code under a page that is already
 * running, which can leave a half-old, half-new app. The user is told and
 * chooses.
 */
export function ServiceWorkerRegistrar(): React.JSX.Element | null {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;

    const register = async (): Promise<void> => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        if (cancelled) return;

        // A worker already waiting when the page loaded -- the usual case when
        // the app was updated while it was closed.
        if (registration.waiting) setWaiting(registration.waiting);

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener('statechange', () => {
            // `controller` is null on the very first install; that is not an
            // update and must not prompt.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setWaiting(installing);
            }
          });
        });
      } catch {
        // A failed registration must never break the page. The app works
        // without a service worker; it simply is not installable or offline.
      }
    };

    void register();

    // The new worker took control, so the page is now running old code against
    // a new worker. Reload once, guarded against a loop.
    let refreshing = false;
    const onControllerChange = (): void => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  if (!waiting) return null;

  return (
    <div
      role="status"
      className="border-edge bg-surface fixed inset-x-md bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-50 flex items-center justify-between gap-md rounded-md border p-md shadow-lg lg:bottom-md lg:left-auto lg:w-96"
    >
      <p className="text-sm">New version available</p>
      <button
        type="button"
        disabled={reloading}
        onClick={() => {
          setReloading(true);
          // The worker takes over, controllerchange fires, the page reloads.
          waiting.postMessage('SKIP_WAITING');
        }}
        className="bg-signal min-h-11 shrink-0 rounded px-md text-sm font-medium text-[color:var(--pact-base)] disabled:opacity-50"
      >
        {reloading ? 'Reloading…' : 'Reload'}
      </button>
    </div>
  );
}
