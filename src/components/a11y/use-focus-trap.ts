'use client';

import { useEffect, useRef } from 'react';

/**
 * Keeps focus inside a dialog while it is open, and puts it back afterwards.
 *
 * ---------------------------------------------------------------------------
 * A DIALOG YOU CAN TAB OUT OF IS NOT A DIALOG.
 * ---------------------------------------------------------------------------
 * Focus that escapes into the page behind lands on controls the user cannot
 * see, which for a screen-reader or keyboard-only user means the dialog is
 * simply gone with no way back. Restoring focus on close matters just as much:
 * without it focus falls to `document.body` and the next Tab starts from the
 * top of the page, losing the reader's place entirely.
 *
 * DELIBERATELY NOT APPLIED to the inline disclosures -- the create form, the
 * reckoning flow, the block override. Those are not dialogs: they expand in
 * place, the rest of the page stays meaningful, and trapping focus inside one
 * would be a bug rather than a courtesy. They get focus MOVED to them on open
 * and RESTORED on close, which is the correct treatment for a disclosure.
 * ---------------------------------------------------------------------------
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

export function useFocusTrap(
  container: React.RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
): void {
  /**
   * Captured in a ref rather than state: restoring focus must not depend on a
   * render happening, and the element has to be remembered from BEFORE the
   * dialog took focus.
   */
  const previous = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    previous.current = document.activeElement as HTMLElement | null;

    const node = container.current;
    if (node) {
      const first = focusableWithin(node)[0];
      // The container itself when it holds nothing focusable, so the reader is
      // moved into the dialog either way.
      (first ?? node).focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();

        return;
      }

      if (event.key !== 'Tab') return;

      const current = container.current;
      if (!current) return;

      const focusable = focusableWithin(current);
      if (focusable.length === 0) {
        event.preventDefault();

        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const activeElement = document.activeElement;

      // Wrap at both ends. Without the backward case, Shift+Tab from the first
      // control leaves the dialog just as surely as Tab from the last.
      if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!current.contains(activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // `isConnected`: the trigger is often re-rendered while the dialog is
      // open, and focusing a detached node silently does nothing.
      if (previous.current?.isConnected) previous.current.focus();
    };
  }, [active, container, onClose]);
}
