'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { CommitmentView } from '@/lib/commitments/service';
import { formatDue, formatEstimate, formatOverdue } from './format';

/**
 * One commitment.
 *
 * Overdue state is shown plainly -- "3h overdue" -- and never dressed up. The
 * app's job is to make the gap between commitment and execution visible, and a
 * softened label is the same lie as a reward.
 */
export function CommitmentRow({
  commitment,
  timeZone,
  onChanged,
}: {
  commitment: CommitmentView;
  timeZone: string;
  onChanged: () => void;
}): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: 'complete' | 'abandon', body?: unknown): Promise<void> {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/commitments/${commitment.id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string };
        setError(detail.error ?? 'That did not work.');
        return;
      }
      onChanged();
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  const closed = commitment.status === 'done' || commitment.status === 'abandoned';

  return (
    <li
      className={[
        'border-edge bg-surface rounded-md border p-md',
        commitment.missed ? 'border-signal/50' : '',
        closed ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="min-w-0 flex-1">
          <p
            className={[
              'font-medium break-words',
              commitment.status === 'done' ? 'line-through' : '',
            ].join(' ')}
          >
            {commitment.title}
          </p>
          {/* The outcome is what makes this verifiable, so it is not hidden. */}
          <p className="text-text/60 mt-2xs text-sm break-words">{commitment.outcome}</p>
        </div>

        <span className="text-text/50 shrink-0 text-xs uppercase tracking-wide">
          {commitment.priority}
        </span>
      </div>

      <div className="text-text/60 mt-sm flex flex-wrap items-center gap-x-md gap-y-2xs text-xs">
        <span>{formatDue(commitment.dueAt, timeZone)}</span>
        <span>{formatEstimate(commitment.estimateMinutes)}</span>

        {commitment.missed ? (
          <span className="text-signal font-medium">
            {formatOverdue(commitment.minutesOverdue)}
          </span>
        ) : null}

        {/* Postponement is surfaced, not buried: it is the behaviour the app exists to show. */}
        {commitment.postponed ? (
          <span className="text-signal/80">
            moved from {formatDue(commitment.originalDueAt, timeZone)}
          </span>
        ) : null}

        {commitment.seriesId ? <span className="text-text/40">recurring</span> : null}
        {closed ? <span className="text-text/40">{commitment.status}</span> : null}
      </div>

      {error ? (
        <p role="alert" className="text-signal mt-sm text-sm">
          {error}
        </p>
      ) : null}

      {!closed ? (
        <div className="mt-md flex flex-wrap gap-sm">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act('complete')}
            className="border-edge min-h-11 flex-1 rounded border px-md text-sm transition-colors hover:border-signal disabled:opacity-50 sm:flex-none"
          >
            {busy === 'complete' ? 'Completing…' : 'Complete'}
          </button>

          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              const reason = window.prompt('Why are you abandoning this?');
              // Cancelled: do nothing. Abandoning is a decision, not an accident.
              if (reason === null) return;
              void act('abandon', { reason });
            }}
            className="border-edge text-text/70 min-h-11 flex-1 rounded border px-md text-sm transition-colors hover:border-signal hover:text-text disabled:opacity-50 sm:flex-none"
          >
            {busy === 'abandon' ? 'Abandoning…' : 'Abandon'}
          </button>
        </div>
      ) : null}
    </li>
  );
}
