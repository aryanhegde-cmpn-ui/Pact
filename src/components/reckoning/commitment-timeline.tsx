'use client';

import { useEffect, useState } from 'react';

interface TimelineEntry {
  ts: string;
  type: string;
  line: string;
  significant: boolean;
}

/**
 * A commitment's history, in order, one line per event.
 *
 * The evidence base, not decoration. Everything the app says about someone's
 * behaviour has to be traceable to a line here -- that is the difference
 * between an accountability tool and an opinion.
 */
export function CommitmentTimeline({ commitmentId }: { commitmentId: string }): React.JSX.Element {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [summary, setSummary] = useState<{ changes: number; totalDaysPostponed: number } | null>(
    null,
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetch(`/api/commitments/${commitmentId}/timeline`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          if (!body) return;
          setEntries(body.entries);
          setSummary(body.postponements);
        })
        .catch(() => setEntries([]));
    }, 0);

    return () => clearTimeout(timer);
  }, [commitmentId]);

  if (entries === null) return <p className="text-text/40 text-xs">Loading history…</p>;
  if (entries.length === 0) return <p className="text-text/40 text-xs">No history yet.</p>;

  return (
    <div>
      {summary && summary.changes > 0 ? (
        <p className="text-text/60 mb-sm text-xs">
          Deadline moved {summary.changes}×, {summary.totalDaysPostponed}d total drift
        </p>
      ) : null}

      <ol className="flex flex-col gap-2xs">
        {entries.map((entry, index) => (
          <li
            key={`${entry.ts}-${index}`}
            className={[
              'flex gap-sm text-xs',
              entry.significant ? 'text-text' : 'text-text/50',
            ].join(' ')}
          >
            <time className="shrink-0 tabular-nums" dateTime={entry.ts}>
              {entry.ts.slice(0, 16).replace('T', ' ')}
            </time>
            <span className="break-words">{entry.line}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
