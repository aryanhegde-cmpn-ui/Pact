'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { navItems } from './nav-items';

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="border-edge bg-surface hidden w-64 shrink-0 border-r lg:flex lg:flex-col">
      <div className="border-edge border-b px-lg py-lg">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Pact
        </Link>
        <p className="text-text/50 mt-2xs text-xs">Execution, not organisation</p>
      </div>

      <nav aria-label="Primary" className="flex flex-col gap-2xs p-sm">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={[
                'flex items-center gap-sm rounded-md px-sm py-xs text-sm transition-colors',
                active ? 'bg-edge text-text' : 'text-text/60 hover:bg-edge/50 hover:text-text',
              ].join(' ')}
            >
              <NavIcon path={item.icon} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

function NavIcon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}
