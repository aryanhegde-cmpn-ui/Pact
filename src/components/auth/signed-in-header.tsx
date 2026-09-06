import Link from 'next/link';

import { SignOutButton } from '@/components/auth/sign-out-button';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { BackButton } from '@/components/nav/back-button';

/**
 * The app header.
 *
 * Carries the back control because standalone mode has NO browser chrome --
 * no back gesture on Android's installed PWA in many cases, and no swipe-back
 * on iOS outside Safari. Without an in-app back affordance the only way out of
 * a screen is to close the app.
 */
export function SignedInHeader({
  displayName,
  needsReckoning = 0,
}: {
  displayName: string;
  /** Clears only when every miss has been answered. Not dismissible. */
  needsReckoning?: number;
}): React.JSX.Element {
  return (
    <header className="border-edge mb-lg flex items-center justify-between gap-sm border-b pb-md">
      <div className="flex min-w-0 items-center gap-sm">
        <BackButton />
        <p className="text-text/70 min-w-0 truncate text-sm">
          Signed in as <span className="text-text font-medium">{displayName}</span>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-sm">
        {/*
          Not a dismissible badge. It counts unanswered misses and clears only
          when they are answered -- a count you can tap away would be a
          notification, which is the opposite of the point.
        */}
        {needsReckoning > 0 ? (
          <Link
            href="/dashboard"
            className="border-signal bg-signal/10 text-signal flex min-h-11 items-center rounded border px-sm text-xs font-medium"
          >
            {needsReckoning} to reckon
          </Link>
        ) : null}

        <NotificationBell />
        <SignOutButton />
      </div>
    </header>
  );
}
