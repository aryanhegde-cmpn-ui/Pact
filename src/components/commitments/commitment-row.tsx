'use client';

import Link from 'next/link';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { CommitmentTimeline } from '@/components/reckoning/commitment-timeline';
import { ReckoningFlow } from '@/components/reckoning/reckoning-flow';
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
  const [reckoning, setReckoning] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [effect, setEffect] = useState<string | null>(null);

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
        commitment.needsReckoning ? 'border-signal' : commitment.missed ? 'border-signal/50' : '',
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
        {commitment.deadlineChanges > 0 ? (
          <span className="text-text/40">moved {commitment.deadlineChanges}&times;</span>
        ) : null}
        {commitment.blockedOn ? (
          <span className="text-signal/80">blocked on {commitment.blockedOn}</span>
        ) : null}
        {closed ? <span className="text-text/40">{commitment.status}</span> : null}
      </div>

      {commitment.nextAction ? (
        <p className="text-text/60 mt-sm text-xs">Next action: {commitment.nextAction}</p>
      ) : null}

      {error ? (
        <p role="alert" className="text-signal mt-sm text-sm">
          {error}
        </p>
      ) : null}

      {effect ? (
        <p
          role="status"
          className="border-edge text-text/70 mt-sm rounded border px-md py-sm text-xs"
        >
          {effect}
        </p>
      ) : null}

      {/*
        An unanswered miss gets the reckoning, not the ordinary actions.
        Offering "complete / abandon" here would let the deadline be sidestepped
        without ever answering for it.
      */}
      {commitment.needsReckoning && !effect ? (
        reckoning ? (
          <div className="mt-md">
            <ReckoningFlow
              commitment={commitment}
              onDone={(message) => {
                setEffect(message);
                setReckoning(false);
                onChanged();
              }}
              onCancel={() => setReckoning(false)}
            />
          </div>
        ) : (
          <div className="border-signal/40 bg-signal/10 mt-md rounded border p-sm">
            <p className="text-signal text-sm font-medium">This needs reckoning</p>
            <p className="text-text/60 mt-2xs text-xs">
              It cannot be rescheduled until you answer what happened.
            </p>
            <button
              type="button"
              onClick={() => setReckoning(true)}
              className="bg-signal mt-sm min-h-11 w-full rounded px-md text-sm font-medium text-on-signal"
            >
              Reckon with it
            </button>
          </div>
        )
      ) : null}

      <button
        type="button"
        onClick={() => setShowTimeline((open) => !open)}
        className="text-text/40 hover:text-text mt-sm text-xs underline"
      >
        {showTimeline ? 'Hide history' : 'History'}
      </button>

      {showTimeline ? (
        <div className="border-edge mt-sm rounded border p-sm">
          <CommitmentTimeline commitmentId={commitment.id} />
        </div>
      ) : null}

      {!closed && !commitment.needsReckoning ? (
        <div className="mt-md flex flex-wrap gap-sm">
          {/*
            Sits before Complete deliberately. Completing straight from the
            list is a checkbox; a session is the thing that produces a real
            duration to compare against the estimate.
          */}
          <Link
            href={`/focus/${commitment.id}`}
            className="border-edge min-h-11 flex-1 rounded border px-md text-center text-sm leading-[2.75rem] transition-colors hover:border-signal sm:flex-none"
          >
            Start a session
          </Link>

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
