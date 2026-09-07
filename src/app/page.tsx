import { redirect } from 'next/navigation';

import { SignInForm } from '@/components/auth/sign-in-form';
import { auth } from '@/lib/auth';
import { DEFAULT_SIGNED_IN_PATH, safeReturnTo } from '@/lib/auth/return-to';

/**
 * Landing page and sign-in entry point.
 *
 * Deliberately outside the `(shell)` route group: a signed-out visitor must not
 * render navigation to routes they cannot reach.
 *
 * The only page anyone sees before deciding whether this app works, and the
 * only one not behind the sign-in wall -- which is how it managed to ship with
 * a 600px form on a 390px screen while the suite stayed green. It now has its
 * own spec, `e2e/landing.spec.ts`, which runs without a session.
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
    <main className="flex min-h-dvh items-center justify-center px-md py-2xl">
      {/*
        `max-w-sm` and nothing else. There was a `min-w-150` here, which in
        Tailwind v4's numeric spacing scale is 150 x 0.25rem = 600px -- a
        minimum wider than the maximum beside it, and wider than the phone this
        is opened on. The form rendered from x = -105px.
      */}
      <div className="w-full max-w-sm">
        <header>
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">Pact</h1>
          <p className="text-text/40 mt-2xs text-sm">Execution, not organisation</p>
        </header>

        {/*
          A left rule, not a filled panel. Same annotation the unanswered-miss
          block uses on Today: a note in the margin of a ledger rather than an
          alert box. Deliberately NOT in `signal` -- being asked to sign in is
          not something that needs you, it is just an explanation of why the
          page changed under you.
        */}
        {cameFromProtectedRoute ? (
          <p className="border-edge text-text/60 mt-lg border-l-2 pl-md text-sm">
            Sign in to continue.
          </p>
        ) : null}

        <div className="mt-2xl">
          <SignInForm returnTo={destination} />
        </div>
      </div>
    </main>
  );
}
