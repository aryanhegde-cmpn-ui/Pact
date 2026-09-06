import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { QueryProvider } from '@/components/providers/query-provider';
import { ServiceWorkerRegistrar } from '@/components/pwa/service-worker-registrar';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: { default: 'Pact', template: '%s · Pact' },
  description: 'A personal execution dashboard, plus a study planner.',
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  applicationName: 'Pact',
  appleWebApp: {
    // iOS ignores the manifest entirely and reads these instead.
    capable: true,
    title: 'Pact',
    // `black-translucent` puts the page under the status bar, which is what
    // makes safe-area padding necessary rather than optional.
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: {
    // Stops iOS turning estimates like "90" into tappable phone links.
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: '#0b0d10',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  // Required for env(safe-area-inset-*) to report anything but zero. Without
  // it the page stops short of the notch instead of painting behind it.
  viewportFit: 'cover',
  // The app is a tool, not a document; pinch-zooming a fixed layout only
  // strands the user. Text still scales with the system font size.
  maximumScale: 1,
};

/**
 * Holds only `<html>`/`<body>` and providers. The navigation shell lives in the
 * `(shell)` route group, so the landing page at `/` renders without it.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-base text-text min-h-dvh antialiased">
        <QueryProvider>{children}</QueryProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
