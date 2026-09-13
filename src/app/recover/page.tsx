import Link from 'next/link';
import { redirect } from 'next/navigation';

import { RecoverForm } from '@/components/recovery-codes/recover-form';
import { currentActor } from '@/lib/api/guard';

/**
 * Account recovery, outside the shell.
 *
 * Same treatment as the landing page it is reached from: one narrow column, no
 * navigation, nothing a signed-out visitor cannot use. Somebody arrives here
 * because they cannot get in, which is the worst possible moment to render a
 * nav bar full of routes that will bounce them.
 */
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Recover your account' };

export default async function RecoverPage(): Promise<React.JSX.Element> {
  // `currentActor()` rather than `auth()`: somebody whose session was killed by
  // a reset holds a valid-looking JWT and is exactly the person who needs this
  // page, so bouncing them to Settings would be the worst possible answer.
  const actor = await currentActor();
  if (actor) redirect('/settings');

  return (
    <main className="flex min-h-dvh items-center justify-center px-md py-2xl">
      <div className="w-full max-w-[24rem]">
        <header>
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">Recover access</h1>
          <p className="text-text/40 mt-2xs text-sm">Use one of your recovery codes</p>
        </header>

        <div className="mt-2xl">
          <RecoverForm />
        </div>

        <p className="text-text/40 mt-2xl text-sm">
          <Link href="/" className="hover:text-text inline-flex min-h-11 items-center underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
