'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { navItems } from './nav-items';

export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="border-edge bg-surface fixed inset-x-0 bottom-0 z-10 border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex flex-col items-center gap-2xs py-sm text-xs transition-colors',
                  active ? 'text-signal' : 'text-text/60',
                ].join(' ')}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="size-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
