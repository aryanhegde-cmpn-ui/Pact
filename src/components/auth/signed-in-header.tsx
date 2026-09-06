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
export function SignedInHeader({ displayName }: { displayName: string }): React.JSX.Element {
  return (
    <header className="border-edge mb-lg flex items-center justify-between gap-sm border-b pb-md">
      <div className="flex min-w-0 items-center gap-sm">
        <BackButton />
        <p className="text-text/70 min-w-0 truncate text-sm">
          Signed in as <span className="text-text font-medium">{displayName}</span>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-sm">
        <NotificationBell />
        <SignOutButton />
      </div>
    </header>
  );
}
