import { RedeemInviteForm } from '@/components/settings/redeem-invite-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Accept an invite' };

/**
 * The only way a second account comes into existence.
 *
 * Deliberately outside the nav shell: whoever lands here has no account yet,
 * so there is nothing to navigate.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : '';

  return (
    <main className="flex min-h-dvh items-center justify-center px-md py-xl">
      <div className="w-full max-w-[24rem]">
        <header className="mb-xl">
          <h1 className="text-2xl font-semibold tracking-tight">Accept an invite</h1>
          <p className="text-text/60 mt-2xs text-sm">
            You have been asked to hold someone accountable. You will see what they committed to and
            whether they did it.
          </p>
        </header>

        <RedeemInviteForm initialToken={token} />
      </div>
    </main>
  );
}
