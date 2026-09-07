'use client';

import { useRef } from 'react';

import { useFocusTrap } from '@/components/a11y/use-focus-trap';
import { SHORTCUTS, type Shortcut } from '@/lib/shortcuts/bindings';

/**
 * The `?` sheet: every binding, rendered from the binding list itself.
 *
 * This is the discoverability mechanism, so it is generated rather than
 * written. A hand-maintained list would be wrong within a month, and a
 * shortcut that fires but is not listed is indistinguishable from a bug.
 */
const GROUPS: Shortcut['group'][] = ['Go to', 'On this screen', 'Help'];

export function ShortcutSheet({ onClose }: { onClose: () => void }): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, true, onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ground/80 p-md sm:items-center"
      // A click outside closes it, like every other sheet. The dialog itself
      // stops propagation below.
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-sheet-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="border-edge bg-surface max-h-[80dvh] w-full max-w-[32rem] overflow-y-auto rounded-lg border p-lg"
      >
        <div className="flex items-baseline justify-between gap-md">
          <h2 id="shortcut-sheet-title" className="text-base font-medium">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="border-edge text-text/70 hover:text-text inline-flex min-h-11 items-center rounded border px-sm text-sm"
          >
            Close
          </button>
        </div>

        {GROUPS.map((group) => {
          const rows = SHORTCUTS.filter((shortcut) => shortcut.group === group);
          if (rows.length === 0) return null;

          return (
            <section key={group} className="mt-lg">
              <h3 className="text-text/40 mb-sm text-sm">{group.toLowerCase()}</h3>
              <ul className="border-edge border-t">
                {rows.map((shortcut) => (
                  <li
                    key={shortcut.keys.join('-')}
                    className="border-edge flex items-baseline justify-between gap-md border-b py-sm"
                  >
                    <span className="text-sm">{shortcut.label}</span>
                    <span className="flex shrink-0 gap-2xs">
                      {shortcut.keys.map((key) => (
                        <kbd
                          key={key}
                          className="border-edge figures text-text/70 rounded border px-2xs text-xs"
                        >
                          {key === ' ' ? 'Space' : key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <p className="text-text/40 mt-lg text-xs">
          Two keys shown together are a sequence: press them one after the other. Nothing here
          abandons, discharges or deletes anything — those need a deliberate click.
        </p>
      </div>
    </div>
  );
}
