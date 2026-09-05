import { redirect } from 'next/navigation';

import { SignInForm } from '@/components/auth/sign-in-form';
import { auth } from '@/lib/auth';

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

  const rawReturnTo = params.returnTo;
  const returnTo = typeof rawReturnTo === 'string' ? rawReturnTo : undefined;
  // Only ever a path. An absolute URL here would make this an open redirect.
  const safeReturnTo =
    returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : undefined;

  if (session?.user) {
    redirect(safeReturnTo ?? '/dashboard');
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-md py-xl">
      <div className="w-full max-w-sm">
        <header className="mb-xl">
          <h1 className="text-2xl font-semibold tracking-tight">Pact</h1>
          <p className="text-text/60 mt-2xs text-sm">Execution, not organisation</p>
        </header>

        {safeReturnTo ? (
          <p className="border-edge bg-surface mb-md rounded border px-md py-sm text-sm text-text/70">
            Sign in to continue.
          </p>
        ) : null}

        <SignInForm returnTo={safeReturnTo} />
      </div>
    </main>
  );
}
