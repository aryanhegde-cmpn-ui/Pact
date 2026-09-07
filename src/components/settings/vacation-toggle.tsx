'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { VacationState } from '@/lib/stakes/vacation';

/**
 * Vacation mode.
 *
 * ---------------------------------------------------------------------------
 * THE PRIMARY'S, AND ONLY THEIRS.
 * ---------------------------------------------------------------------------
 * `vacation:write` is absent from the overseer's capabilities. A vacation an
 * overseer can veto is one you route around by not opening the app, and an
 * accountability tool nobody opens reports nothing at all.
 *
 * The copy states exactly what it does and does not do, because the two things
 * people assume about a pause -- that it hides the record, and that it clears
 * what is already running -- are both false, and finding that out afterwards
 * is how the feature loses their trust.
 * ---------------------------------------------------------------------------
 */
export function VacationToggle({ initial }: { initial: VacationState }): React.JSX.Element {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/vacation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on }),
        cache: 'no-store',
      });
      if (!response.ok) {
        setError(((await response.json()) as { error?: string }).error ?? 'That did not save.');
        return;
      }

      setState((await response.json()) as VacationState);
      router.refresh();
    } catch {
      setError('That did not save. You are probably offline.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-edge bg-surface rounded-lg border p-md">
      <h2 className="text-base font-medium">Vacation mode</h2>

      <p className="text-text/60 mt-xs text-sm">
        {state.on
          ? `On since ${state.since?.slice(0, 10)}. Nothing is being evaluated.`
          : 'Pauses expectations. Blocks still appear and can still be completed.'}
      </p>

      <ul className="text-text/40 mt-sm flex flex-col gap-2xs text-xs">
        <li>No consequence activates and no adherence threshold is tested.</li>
        <li>These days leave the adherence count. They are not counted as misses.</li>
        <li>It does not erase anything, and it cannot discharge a consequence already active.</li>
      </ul>

      {error ? <p className="text-signal mt-sm text-sm">{error}</p> : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => void set(!state.on)}
        className="border-edge hover:border-signal mt-md min-h-11 rounded border px-md text-sm transition-colors"
      >
        {state.on ? 'End vacation' : 'Start vacation'}
      </button>
    </section>
  );
}
