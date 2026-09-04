import type { ReactNode } from 'react';

import { MobileTabBar } from '@/components/nav/mobile-tab-bar';
import { SidebarNav } from '@/components/nav/sidebar-nav';

/**
 * The interactive app shell: sidebar from 1024px up, bottom tab bar below it.
 * `/mirror` deliberately sits outside this group.
 */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <SidebarNav />

      {/* Bottom padding on mobile keeps content clear of the fixed tab bar. */}
      <main className="min-w-0 flex-1 px-md pt-lg pb-24 sm:px-lg lg:px-xl lg:pb-xl xl:px-2xl">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>

      <MobileTabBar />
    </div>
  );
}
