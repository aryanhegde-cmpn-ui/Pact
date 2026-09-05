import { SignOutButton } from '@/components/auth/sign-out-button';

/**
 * Shown inside the app shell. Server component: the session is already resolved
 * by the layout, so no client-side session fetch is needed.
 */
export function SignedInHeader({ displayName }: { displayName: string }): React.JSX.Element {
  return (
    <header className="border-edge mb-lg flex items-center justify-between gap-md border-b pb-md">
      <p className="text-text/70 min-w-0 truncate text-sm">
        Signed in as <span className="text-text font-medium">{displayName}</span>
      </p>
      <SignOutButton />
    </header>
  );
}
