import { redirect } from 'next/navigation';

import { SignInForm } from '@/components/auth/sign-in-form';
import { auth } from '@/lib/auth';
import { DEFAULT_SIGNED_IN_PATH, safeReturnTo } from '@/lib/auth/return-to';

/**
 * Landing page and sign-in entry point.
 *
 * Deliberately outside the `(shell)` route group: a signed-out visitor must not
 * render navigation to routes they cannot reach.
 */
export const dynamic = 'force-dynamic';

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const session = await auth();
  const params = await searchParams;

  // An absent or hostile value both collapse to the default, silently.
  const destination = safeReturnTo(params.returnTo);
  const cameFromProtectedRoute = destination !== DEFAULT_SIGNED_IN_PATH;

  if (session?.user) {
    redirect(destination);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-md py-xl">
      <div className="w-full max-w-sm">
        <header className="mb-xl">
          <h1 className="text-2xl font-semibold tracking-tight">Pact</h1>
          <p className="text-text/60 mt-2xs text-sm">Execution, not organisation</p>
        </header>

        {cameFromProtectedRoute ? (
          <p className="border-edge bg-surface mb-md rounded border px-md py-sm text-sm text-text/70">
            Sign in to continue.
          </p>
        ) : null}

        <SignInForm returnTo={destination} />
      </div>
    </main>
  );
}
