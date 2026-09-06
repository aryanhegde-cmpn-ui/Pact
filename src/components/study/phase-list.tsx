'use client';

import { useState } from 'react';

import type { PhaseView } from '@/lib/curriculum/service';

import { DriftLine } from './drift-line';

/**
 * The phases, with the gap and the one way to close it.
 *
 * Re-planning is a form with a required reason, deliberately shaped like the
 * deadline-change form. Falling behind does not move these dates by itself and
 * never will: the plan holds and shows the gap, and moving it is a decision
 * someone makes and writes down.
 */
export function PhaseList({ initial }: { initial: PhaseView[] }): React.JSX.Element {
  const [phases, setPhases] = useState(initial);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function replan(phaseNumber: number, form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/curriculum/replan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phaseNumber,
          newEndDate: String(data.get('newEndDate') ?? ''),
          reason: String(data.get('reason') ?? ''),
        }),
        cache: 'no-store',
      });
      const body = (await response.json()) as { phases?: PhaseView[]; error?: string };
      if (!response.ok) {
        setError(body.error ?? 'That did not save.');
        return;
      }
      setPhases(body.phases ?? phases);
      setOpen(null);
    } catch {
      setError('That did not save. You are probably offline.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-md">
      {error ? <p className="text-signal text-sm">{error}</p> : null}

      {phases.map((phase) => (
        <section
          key={phase.number}
          className={`bg-surface rounded-lg border p-md ${
            phase.current ? 'border-signal' : 'border-edge'
          }`}
        >
          <div className="flex items-baseline justify-between gap-sm">
            <h2 className="text-base font-medium">
              Phase {phase.number} · {phase.outcome}
            </h2>
            <span className="text-text/40 text-xs">{phase.datesRaw}</span>
          </div>

          <p className="text-text/50 mt-2xs text-xs">
            {phase.startDate} to {phase.endDate}
            {phase.replanned ? (
              // Shown always, not only on the phase that moved: the original
              // schedule is the only thing that makes "behind" mean anything.
              <span className="text-signal">
                {' '}
                · re-planned, originally {phase.originalStartDate} to {phase.originalEndDate}
              </span>
            ) : null}
          </p>

          <p className="text-text/60 mt-xs text-sm">
            {phase.primaryFocus} · {phase.secondaryFocus}
          </p>
          <p className="text-text/40 mt-2xs text-xs">{phase.rule}</p>

          <div className="mt-sm">
            <DriftLine drift={phase.drift} />
          </div>

          {open === phase.number ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void replan(phase.number, event.currentTarget);
              }}
              className="border-edge mt-md flex flex-col gap-sm border-t pt-md"
            >
              <label className="flex flex-col gap-2xs">
                <span className="text-text/50 text-xs">New end date</span>
                <input
                  name="newEndDate"
                  type="date"
                  required
                  defaultValue={phase.endDate}
                  className="border-edge bg-base min-h-11 rounded border px-sm text-sm"
                />
              </label>

              <label className="flex flex-col gap-2xs">
                <span className="text-text/50 text-xs">Why</span>
                <textarea
                  name="reason"
                  required
                  minLength={10}
                  rows={2}
                  placeholder="Required. This goes in the log, and the phases after this one move by the same amount."
                  className="border-edge bg-base rounded border p-sm text-sm"
                />
              </label>

              <div className="flex gap-sm">
                <button
                  type="submit"
                  disabled={busy}
                  className="border-signal text-signal min-h-11 rounded border px-md text-sm"
                >
                  Move the plan
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(null)}
                  className="border-edge min-h-11 rounded border px-md text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(phase.number)}
              className="border-edge hover:border-signal mt-sm min-h-11 rounded border px-md text-xs transition-colors"
            >
              Re-plan this phase
            </button>
          )}
        </section>
      ))}
    </div>
  );
}
