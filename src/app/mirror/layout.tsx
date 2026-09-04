import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Mirror' };

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The mirror is a fixed display; pinch-zoom would only ever be an accident.
  maximumScale: 1,
  userScalable: false,
};

/**
 * Bare layout for the smart-mirror display. No navigation, no controls, nothing
 * interactive -- this surface is read from across a room and never touched.
 */
export default function MirrorLayout({ children }: { children: ReactNode }) {
  return <div className="bg-base min-h-dvh">{children}</div>;
}
