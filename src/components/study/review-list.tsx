'use client';

import { useState } from 'react';

import type { FlaggedTopic } from '@/lib/curriculum/service';
import { targetKindSchema, type TargetKind, type TargetUnit } from '@/lib/schemas/curriculum';

/**
 * The rows the parser refused to guess at.
 *
 * This list existing is the design working. A third of the Practice / Output
 * column is prose with no countable target in it -- "Whiteboard + edge cases",
 * "Give pros/cons + alternative" -- and every row here is one where inventing
 * a number would have produced a target the plan then measured progress
 * against while looking exactly like a number somebody set.
 */
export function ReviewList({ initial }: { initial: FlaggedTopic[] }): React.JSX.Element {
  const [flagged, setFlagged] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function correct(stableKey: string, form: HTMLFormElement) {
    const data = new FormData(form);
    const min = String(data.get('targetMin') ?? '').trim();
    const max = String(data.get('targetMax') ?? '').trim();
    const unit = String(data.get('unit') ?? '');

    setBusy(stableKey);
    setError(null);
    try {
      const response = await fetch('/api/curriculum/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stableKey,
          kind: String(data.get('kind') ?? 'other') as TargetKind,
          unit: unit === '' ? null : (unit as TargetUnit),
          targetMin: min === '' ? null : Number(min),
          targetMax: max === '' ? null : Number(max || min),
        }),
        cache: 'no-store',
      });
      const body = (await response.json()) as { flagged?: FlaggedTopic[]; error?: string };
      if (!response.ok) {
        setError(body.error ?? 'That did not save.');
        return;
      }
      setFlagged(body.flagged ?? []);
    } catch {
      setError('That did not save. You are probably offline.');
    } finally {
      setBusy(null);
    }
  }

  if (flagged.length === 0) {
    return <p className="text-text/50 text-sm">Nothing is waiting to be reviewed.</p>;
  }

  return (
    <div className="flex flex-col gap-md">
      {error ? <p className="text-signal text-sm">{error}</p> : null}

      {flagged.map((topic) => (
        <form
          key={topic.stableKey}
          onSubmit={(event) => {
            event.preventDefault();
            void correct(topic.stableKey, event.currentTarget);
          }}
          className="border-edge bg-surface rounded-lg border p-md"
        >
          <p className="text-sm">
            {topic.module} · {topic.topic}
          </p>
          {topic.subTopic ? <p className="text-text/50 text-xs">{topic.subTopic}</p> : null}

          {/* The workbook's own words, which are the only thing that still
              says what this row actually asks for. */}
          <p className="mt-xs text-sm">
            <span className="text-text/40">Sheet says: </span>
            {topic.practiceRaw}
          </p>
          {topic.reviewReason ? (
            <p className="text-text/40 mt-2xs text-xs">Not parsed: {topic.reviewReason}.</p>
          ) : null}

          <div className="mt-sm flex flex-wrap items-end gap-sm">
            <label className="flex flex-col gap-2xs">
              <span className="text-text/50 text-xs">Kind</span>
              <select
                name="kind"
                defaultValue="other"
                className="border-edge bg-ground min-h-11 rounded border px-sm text-sm"
              >
                {targetKindSchema.options.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2xs">
              <span className="text-text/50 text-xs">Unit</span>
              <select
                name="unit"
                defaultValue=""
                className="border-edge bg-ground min-h-11 rounded border px-sm text-sm"
              >
                <option value="">none</option>
                <option value="problems">problems</option>
                <option value="minutes">minutes</option>
              </select>
            </label>

            <label className="flex flex-col gap-2xs">
              <span className="text-text/50 text-xs">Min</span>
              <input
                name="targetMin"
                type="number"
                min={1}
                className="border-edge bg-ground min-h-11 w-20 rounded border px-sm text-sm"
              />
            </label>

            <label className="flex flex-col gap-2xs">
              <span className="text-text/50 text-xs">Max</span>
              <input
                name="targetMax"
                type="number"
                min={1}
                className="border-edge bg-ground min-h-11 w-20 rounded border px-sm text-sm"
              />
            </label>

            <button
              type="submit"
              disabled={busy === topic.stableKey}
              className="border-edge hover:border-signal min-h-11 rounded border px-md text-sm transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      ))}
    </div>
  );
}
