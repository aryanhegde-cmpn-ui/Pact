'use client';

import { useState } from 'react';

import type { StudyToday } from '@/lib/curriculum/service';

import { DriftLine } from './drift-line';

/**
 * The three morning blocks, the evening, and the phase.
 *
 * The override is a plain `<select>` next to each block. That is the whole
 * interaction: the suggestion is a default, and switching away from it costs
 * one tap rather than a trip into a settings screen. A default that is
 * expensive to change is a lock with extra steps.
 */
export function TodayBlocks({ initial }: { initial: StudyToday }): React.JSX.Element {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function override(commitmentId: string, stableKey: string | null) {
    setBusy(commitmentId);
    setError(null);
    try {
      const response = await fetch('/api/curriculum/today', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitmentId, stableKey }),
        cache: 'no-store',
      });
      const body = (await response.json()) as StudyToday & { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'That did not save.');
        return;
      }
      setData(body);
    } catch {
      setError('That did not save. You are probably offline.');
    } finally {
      setBusy(null);
    }
  }

  if (data.empty) {
    return (
      <div className="border-edge bg-surface rounded-lg border p-lg">
        <p className="text-sm">No curriculum has been imported.</p>
        <p className="text-text/50 mt-xs text-sm">
          Run <code className="font-mono">npm run curriculum:import -- --dry-run</code>, read the
          report, then run it without the flag.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <p className="text-text/50 text-sm">
          {data.rhythm.label} · output: {data.rhythm.output}
        </p>
      </header>

      {error ? <p className="text-signal text-sm">{error}</p> : null}

      <ul className="flex flex-col gap-md">
        {data.blocks.map((block) => (
          <li key={block.blockId} className="border-edge bg-surface rounded-lg border p-md">
            <div className="flex items-baseline justify-between gap-sm">
              <h2 className="text-base font-medium">{block.area}</h2>
              <span className="text-text/40 text-xs">{block.slant}</span>
            </div>

            {block.commitment ? (
              <>
                <p className="mt-2xs text-sm">{block.commitment.title}</p>
                <p className="text-text/50 mt-2xs text-xs">{block.commitment.outcome}</p>
                <p className="text-text/40 mt-2xs text-xs">
                  {block.commitment.estimateMinutes} min · {block.commitment.status}
                  {block.commitment.needsReckoning ? ' · needs reckoning' : ''}
                </p>
              </>
            ) : (
              <p className="text-text/50 mt-2xs text-sm">
                Not materialised yet. It appears on the dashboard when the day is read.
              </p>
            )}

            {block.reasons.length > 0 ? (
              <p className="text-text/40 mt-xs text-xs">Suggested because {block.reasons[0]}.</p>
            ) : null}

            {block.commitment ? (
              <label className="mt-sm flex flex-col gap-2xs">
                <span className="text-text/50 text-xs">Studying</span>
                <select
                  value={block.topicKey ?? ''}
                  disabled={busy === block.commitment.id}
                  onChange={(event) =>
                    void override(
                      block.commitment?.id ?? '',
                      event.target.value === '' ? null : event.target.value,
                    )
                  }
                  className="border-edge bg-base min-h-11 rounded border px-sm text-sm"
                >
                  <option value="">Nothing in particular</option>
                  {block.alternatives.map((option) => (
                    <option key={option.stableKey} value={option.stableKey}>
                      {option.label} · {option.priority}
                      {option.status === 'needs-revision' ? ' · needs revision' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </li>
        ))}
      </ul>

      <section className="border-edge bg-surface rounded-lg border p-md">
        <h2 className="text-base font-medium">Evening</h2>
        <p className="text-text/50 mt-2xs text-sm">{data.evening.reason}</p>

        {data.evening.options.length > 0 ? (
          <ul className="mt-xs flex flex-col gap-2xs">
            {data.evening.options.map((option) => (
              <li key={option.label} className="text-text/70 text-sm">
                {option.label}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {data.phase && data.drift ? (
        <section className="border-edge bg-surface rounded-lg border p-md">
          <h2 className="text-base font-medium">
            Phase {data.phase.number} · {data.phase.outcome}
          </h2>
          <p className="text-text/40 mt-2xs text-xs">
            {data.phase.startDate} to {data.phase.endDate}
          </p>
          <div className="mt-xs">
            <DriftLine drift={data.drift} />
          </div>
        </section>
      ) : (
        <p className="text-text/50 text-sm">Today falls outside every phase of the plan.</p>
      )}
    </div>
  );
}
