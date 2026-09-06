'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Platform detection for install and notification affordances.
 *
 * All of it is client-only and runs after mount: user-agent sniffing on the
 * server would be wrong for a shared render, and `display-mode` is not
 * knowable there at all.
 */

export interface PlatformState {
  /** Running from the home screen rather than a browser tab. */
  standalone: boolean;
  isIOS: boolean;
  /** Android/desktop Chrome fired beforeinstallprompt and we captured it. */
  installPromptAvailable: boolean;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari predates the display-mode media query and uses this instead.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function detectIOS(): boolean {
  if (typeof window === 'undefined') return false;

  const ua = window.navigator.userAgent;
  // iPadOS 13+ reports as Macintosh, so touch support is the distinguisher.
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document)
  );
}

/**
 * Subscribes to the standalone display mode.
 *
 * `useSyncExternalStore` rather than an effect that calls setState: the value
 * lives outside React, it can change while the app is open (a PWA launched
 * from the home screen mid-session), and React 19 rightly rejects reading it
 * by writing state from an effect.
 */
function subscribeToDisplayMode(onChange: () => void): () => void {
  const media = window.matchMedia('(display-mode: standalone)');
  media.addEventListener('change', onChange);
  window.addEventListener('appinstalled', onChange);

  return () => {
    media.removeEventListener('change', onChange);
    window.removeEventListener('appinstalled', onChange);
  };
}

/** Never standalone on the server; the first client render corrects it. */
const serverFalse = (): boolean => false;

export function usePlatform(): PlatformState & { promptInstall: () => Promise<boolean> } {
  const standalone = useSyncExternalStore(subscribeToDisplayMode, detectStandalone, serverFalse);
  const isIOS = useSyncExternalStore(subscribeNever, detectIOS, serverFalse);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstall = (event: Event): void => {
      // Chrome shows its own mini-infobar unless this is prevented; the app
      // shows its own button instead, at a moment that makes sense.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = (): void => setDeferred(null);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return {
    standalone,
    isIOS,
    installPromptAvailable: deferred !== null,
    promptInstall: async () => {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      // The event is single-use; Chrome fires a fresh one if still eligible.
      setDeferred(null);
      return outcome === 'accepted';
    },
  };
}

/** The user agent does not change mid-session, so there is nothing to watch. */
function subscribeNever(): () => void {
  return () => {};
}
