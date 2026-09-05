'use client';

import { useState } from 'react';

import { usePlatform } from './use-platform';

/**
 * Install affordance.
 *
 * Two entirely different paths, because the platforms are different:
 *
 *   Android/desktop Chrome  fires `beforeinstallprompt`, which is captured and
 *                           replayed from a real button.
 *   iOS Safari              fires no such event and has no programmatic
 *                           install. The only honest option is to say where
 *                           the Share menu item is.
 *
 * Showing a button on iOS that silently does nothing is worse than showing
 * instructions, so the two cases are handled separately rather than papered
 * over with one button.
 */
export function InstallPrompt(): React.JSX.Element | null {
  const { standalone, isIOS, installPromptAvailable, promptInstall } = usePlatform();
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Already installed: nothing to offer.
  if (standalone || dismissed) return null;

  if (isIOS) {
    return (
      <div className="border-edge bg-surface rounded-md border p-md">
        <div className="flex items-start justify-between gap-md">
          <div>
            <p className="text-sm font-medium">Add Pact to your home screen</p>
            <p className="text-text/60 mt-2xs text-xs">
              Opens without browser chrome, and is the only way iOS will allow notifications.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowIOSHelp((open) => !open)}
            className="border-edge min-h-11 shrink-0 rounded border px-sm text-sm"
          >
            {showIOSHelp ? 'Hide' : 'How'}
          </button>
        </div>

        {showIOSHelp ? (
          <ol className="text-text/70 mt-md flex list-decimal flex-col gap-2xs pl-lg text-sm">
            <li>Tap the Share button in Safari&apos;s toolbar.</li>
            <li>Scroll down and choose &ldquo;Add to Home Screen&rdquo;.</li>
            <li>Tap Add, then open Pact from the new icon.</li>
          </ol>
        ) : null}
      </div>
    );
  }

  // Chrome has not offered it: either already installed, or not eligible yet.
  // A dead button would be worse than nothing.
  if (!installPromptAvailable) return null;

  return (
    <div className="border-edge bg-surface flex items-center justify-between gap-md rounded-md border p-md">
      <div>
        <p className="text-sm font-medium">Install Pact</p>
        <p className="text-text/60 mt-2xs text-xs">
          Opens from your home screen, without a browser bar.
        </p>
      </div>
      <div className="flex shrink-0 gap-sm">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-text/60 min-h-11 px-sm text-sm hover:text-text"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={() => void promptInstall()}
          className="bg-signal min-h-11 rounded px-md text-sm font-medium text-[color:var(--pact-base)]"
        >
          Install
        </button>
      </div>
    </div>
  );
}
