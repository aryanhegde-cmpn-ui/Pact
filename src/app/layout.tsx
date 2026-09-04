import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { QueryProvider } from '@/components/providers/query-provider';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: { default: 'Pact', template: '%s · Pact' },
  description: 'A behavioural intelligence layer over Google Tasks, plus a study planner.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0b0d10',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Holds only `<html>`/`<body>` and providers. The navigation shell lives in the
 * `(shell)` route group so `/mirror` can render bare -- see src/app/mirror.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-base text-text min-h-dvh antialiased">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
