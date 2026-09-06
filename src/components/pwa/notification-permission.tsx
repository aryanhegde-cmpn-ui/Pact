'use client';

import { useState, useSyncExternalStore } from 'react';

import { usePlatform } from './use-platform';

/**
 * Browser notification permission.
 *
 * Three rules, each learned the hard way:
 *
 * 1. NEVER request on page load. Browsers penalise origins that do -- Chrome
 *    auto-blocks them under its abusive-permission heuristics, and the block
 *    is not something the user can easily undo or even see.
 *
 * 2. Only ask after there is something to notify about. A permission prompt
 *    before the user has created a single commitment is a request to be
 *    interrupted about nothing, and "deny" is the correct answer to it.
 *
 * 3. `denied` is PERMANENT and cannot be re-prompted. `Notification.requestPermission()`
 *    resolves instantly with `denied` and shows nothing. A button in that
 *    state is a button that does nothing, so this renders instructions
 *    instead.
 */
export type PermissionState =
  'unsupported' | 'default' | 'granted' | 'denied' | 'ios-needs-install';

export function NotificationPermission({
  commitmentCount,
}: {
  commitmentCount: number;
}): React.JSX.Element | null {
  const { standalone, isIOS } = usePlatform();
  /**
   * The browser's own permission value, read through useSyncExternalStore.
   *
   * It lives outside React and can change without us (the user can flip it in
   * site settings while the app is open), so writing it into state from an
   * effect would both lag reality and trigger a cascading render.
   */
  const permission = useSyncExternalStore<PermissionState>(
    subscribeToPermission,
    readPermission,
    () => 'default',
  );
  const [asking, setAsking] = useState(false);
  const [justAnswered, setJustAnswered] = useState<PermissionState | null>(null);

  const state: PermissionState =
    !isIOS || standalone
      ? (justAnswered ?? permission)
      : // iOS exposes the Notification API only inside an installed PWA.
        'ios-needs-install';

  // Rule 2: nothing to be notified about yet.
  if (commitmentCount === 0) return null;
  if (state === 'unsupported' || state === 'granted') return null;

  if (state === 'ios-needs-install') {
    return (
      <Panel>
        <p className="text-sm font-medium">Notifications need the installed app on iOS</p>
        <p className="text-text/60 mt-2xs text-xs">
          Safari does not allow a website to request them. Add Pact to your home screen from the
          Share menu, open it from there, and the option will appear.
        </p>
      </Panel>
    );
  }

  if (state === 'denied') {
    // Rule 3: no button. It would do nothing, and the user would reasonably
    // conclude the app is broken rather than that they blocked it.
    return (
      <Panel>
        <p className="text-sm font-medium">Notifications are blocked</p>
        <p className="text-text/60 mt-2xs text-xs">
          This cannot be re-requested from the page — the browser only lets you undo it in its own
          settings. Open the padlock or ⋮ menu beside the address bar, find Notifications, and set
          it back to Ask or Allow. In-app notifications keep working either way.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="flex items-center justify-between gap-md">
        <div>
          <p className="text-sm font-medium">Get notified about deadlines</p>
          <p className="text-text/60 mt-2xs text-xs">
            Only for commitments you have made. You can turn it off in browser settings.
          </p>
        </div>
        <button
          type="button"
          disabled={asking}
          // Rule 1: requested from a real click, never on load.
          onClick={() => {
            setAsking(true);
            void Notification.requestPermission()
              .then((result) => setJustAnswered(result as PermissionState))
              .finally(() => setAsking(false));
          }}
          className="bg-signal min-h-11 shrink-0 rounded px-md text-sm font-medium text-[color:var(--pact-base)] disabled:opacity-50"
        >
          {asking ? 'Asking…' : 'Enable'}
        </button>
      </div>
    </Panel>
  );
}

function Panel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="border-edge bg-surface rounded-md border p-md">{children}</div>;
}

/** The current browser permission, or a stand-in where the API is absent. */
function readPermission(): PermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';

  return Notification.permission as PermissionState;
}

/**
 * Nothing to subscribe to: browsers fire no event when permission changes.
 *
 * A permission changed in site settings is therefore picked up on the next
 * render rather than instantly, which is fine -- the only path that matters is
 * the user answering our own prompt, and that is handled directly.
 */
function subscribeToPermission(): () => void {
  return () => {};
}
