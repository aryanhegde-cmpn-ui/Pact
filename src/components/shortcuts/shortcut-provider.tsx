'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  isTypingContext,
  SEQUENCE_PREFIXES,
  SEQUENCE_TIMEOUT_MS,
  SHORTCUTS,
  type Shortcut,
} from '@/lib/shortcuts/bindings';

import { ShortcutSheet } from './shortcut-sheet';

/**
 * The keyboard layer.
 *
 * ---------------------------------------------------------------------------
 * THREE RULES, ALL OF THEM ABOUT NOT FIRING.
 * ---------------------------------------------------------------------------
 * 1. INERT WHILE TYPING. Any input, textarea, select or contenteditable takes
 *    the key, and so does any modifier combination. Without this, typing "no"
 *    into an outcome field opens a new commitment and then navigates.
 *
 * 2. INERT DURING A FOCUS SESSION, except Escape. The server already refuses
 *    `commitment:write` while a session runs -- a keyboard that offered the
 *    same actions would just be a faster way to collect a 409, and a shortcut
 *    that navigates out of a running session is a shortcut out of the work.
 *
 * 3. NOTHING DESTRUCTIVE. Enforced in the binding list and by a test, not
 *    here, so it holds for bindings added later.
 *
 * Actions reach the page through `data-shortcut` attributes rather than
 * through props. It keeps this component stateless and unaware of the day's
 * data, and it means a key does nothing when its target is not on screen --
 * pressing `2` on the settings page should not start a block, and it cannot,
 * because there is nothing there to activate.
 * ---------------------------------------------------------------------------
 */
export function ShortcutProvider({
  sessionRunning = false,
}: {
  /** A server-known fact, so a second tab cannot lie about it. */
  sessionRunning?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);

  /** The prefix of a sequence in progress, e.g. `g`. */
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPending = useCallback(() => {
    pending.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const run = useCallback(
    (shortcut: Shortcut): boolean => {
      const { action } = shortcut;

      if (action.kind === 'help') {
        setHelpOpen(true);

        return true;
      }

      if (action.kind === 'navigate') {
        router.push(action.to);

        return true;
      }

      const element = document.querySelector<HTMLElement>(`[data-shortcut="${action.target}"]`);
      // Not on this screen: the key does nothing, which is the correct
      // behaviour and the reason no shortcut needs to know where it is.
      if (!element) return false;

      if (action.kind === 'focus') {
        element.focus();

        return true;
      }

      element.click();

      return true;
    },
    [router],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape belongs to whatever is open, including during a session.
      if (event.key === 'Escape') {
        clearPending();
        setHelpOpen(false);

        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingContext(event.target)) return;
      if (sessionRunning) return;
      // The sheet is a dialog: its own trap owns the keyboard while it is up.
      if (helpOpen) return;

      const key = event.key;

      if (pending.current) {
        const prefix = pending.current;
        clearPending();

        const match = SHORTCUTS.find(
          (shortcut) =>
            shortcut.keys.length === 2 && shortcut.keys[0] === prefix && shortcut.keys[1] === key,
        );
        if (match) {
          event.preventDefault();
          run(match);
        }

        return;
      }

      if (SEQUENCE_PREFIXES.has(key)) {
        pending.current = key;
        timer.current = setTimeout(clearPending, SEQUENCE_TIMEOUT_MS);

        return;
      }

      const match = SHORTCUTS.find(
        (shortcut) => shortcut.keys.length === 1 && shortcut.keys[0] === key,
      );
      if (!match) return;

      // `preventDefault` only once something was actually done, so an unbound
      // key -- and `/` when no filter is on screen -- still reaches the browser.
      if (run(match)) event.preventDefault();
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [clearPending, helpOpen, run, sessionRunning]);

  return helpOpen ? <ShortcutSheet onClose={() => setHelpOpen(false)} /> : <></>;
}
