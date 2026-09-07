import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { Announcer } from '@/components/a11y/announcer';
import { SkipLink } from '@/components/a11y/skip-link';
import { SignedInHeader } from '@/components/auth/signed-in-header';
import { ShortcutProvider } from '@/components/shortcuts/shortcut-provider';
import { MobileTabBar } from '@/components/nav/mobile-tab-bar';
import { SidebarNav } from '@/components/nav/sidebar-nav';
import { auth } from '@/lib/auth';
import { countNeedsReckoning } from '@/lib/commitments/service';
import { recoveryForRequest } from '@/lib/commitments/recovery-gate';
import { sessionForRequest } from '@/lib/focus/request';

/**
 * The interactive app shell: sidebar from 1024px up, bottom tab bar below it.
 *
 * The landing page sits outside this group so a signed-out visitor never
 * renders navigation. `src/proxy.ts` already redirects unauthenticated
 * requests; this check is the second line, covering anything the matcher does
 * not reach and giving the layout a user to render.
 */
export default async function ShellLayout({
  children,
}: {
  children: ReactNode;
}): Promise<React.JSX.Element> {
  const session = await auth();

  if (!session?.user) {
    redirect('/');
  }

  const displayName = session.user.name ?? session.user.email ?? 'Signed in';

  const ownerId = session.user.ownerId ?? session.user.id;

  // Derived on read like every other behavioural number here.
  const outstanding = await countNeedsReckoning(ownerId);

  /**
   * The nav hides what recovery mode has taken away.
   *
   * Shared with the page through `cache`, so the layout and the page it wraps
   * pay for one aggregation between them rather than one each. The pages
   * redirect anyway -- this is so the tabs do not offer a door that is locked.
   */
  const { active: inRecovery } = await recoveryForRequest(ownerId);

  /**
   * The keyboard layer goes quiet while a session runs, and the server is what
   * says so.
   *
   * Reading it here rather than in the client keeps it consistent with the
   * capability lock: a second tab opened before the session started would
   * otherwise believe nothing was running and offer every action, all of which
   * the server would then refuse with a 409.
   */
  const runningSession = await sessionForRequest(ownerId);

  return (
    <Announcer>
      <div className="flex min-h-dvh pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        {/* First in the DOM on purpose: it is only useful if it is the first
            thing Tab reaches. */}
        <SkipLink />

        <SidebarNav inRecovery={inRecovery} />

        {/* Bottom padding on mobile keeps content clear of the fixed tab bar. */}
        <main
          id="content"
          // Focusable so the skip link actually MOVES focus. Without it the
          // browser scrolls to the anchor and leaves focus in the nav, so the
          // next Tab returns to where it started.
          tabIndex={-1}
          className="min-w-0 flex-1 px-md pt-lg pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-lg lg:px-xl lg:pb-xl xl:px-2xl"
        >
          <div className="mx-auto w-full max-w-5xl">
            <SignedInHeader displayName={displayName} needsReckoning={outstanding} />
            {children}
          </div>
        </main>

        <MobileTabBar inRecovery={inRecovery} />
        <ShortcutProvider sessionRunning={runningSession !== null} />
      </div>
    </Announcer>
  );
}
