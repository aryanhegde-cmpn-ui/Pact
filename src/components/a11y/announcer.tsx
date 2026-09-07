'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Says out loud what changed without a navigation.
 *
 * ---------------------------------------------------------------------------
 * A SCREEN READER DOES NOT NOTICE A ROW LEAVING A LIST.
 * ---------------------------------------------------------------------------
 * Completing a commitment on Today rewrites the page in place: the row goes,
 * the ring fills, the next action changes. To a sighted user that is obvious
 * and needs no words -- the motion exists precisely to explain it. To a screen
 * reader nothing happened at all, because focus did not move and no navigation
 * occurred.
 *
 * So the same events that earn an animation get a sentence here. `polite`, so
 * it waits for a pause rather than interrupting; `atomic`, so the whole
 * sentence is read rather than the diff.
 *
 * The wording is the accountability wording, not a celebration. "Block 1
 * complete. 2 of 3 blocks kept today." is a fact; "Well done!" would be the
 * reward layer arriving through the speech synthesiser.
 * ---------------------------------------------------------------------------
 */
const AnnouncerContext = createContext<(message: string) => void>(() => {});

export function useAnnounce(): (message: string) => void {
  return useContext(AnnouncerContext);
}

export function Announcer({ children }: { children: ReactNode }): React.JSX.Element {
  const [message, setMessage] = useState('');

  /**
   * The counter forces a change even when the same sentence is announced
   * twice. Assistive technology reads a live region when its CONTENT changes,
   * so completing two blocks in a row would otherwise be announced once.
   */
  const [, setNonce] = useState(0);

  const announce = useCallback((next: string) => {
    setNonce((value) => value + 1);
    setMessage(next);
  }, []);

  const value = useMemo(() => announce, [announce]);

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {message}
      </p>
    </AnnouncerContext.Provider>
  );
}
