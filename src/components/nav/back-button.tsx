'use client';

import { usePathname, useRouter } from 'next/navigation';

/**
 * In-app back navigation.
 *
 * Exists because an installed PWA has no browser chrome: there is no back
 * button, and depending on the platform no back gesture either. A screen with
 * no way out of it is a dead end that can only be escaped by killing the app.
 *
 * Hidden on the top-level surfaces, where there is nothing to go back to.
 */
const TOP_LEVEL = ['/dashboard', '/study'];

export function BackButton(): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();

  if (TOP_LEVEL.includes(pathname)) return null;

  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Go back"
      className="border-edge flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded border transition-colors hover:border-signal"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
