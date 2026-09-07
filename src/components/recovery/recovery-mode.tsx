'use client';

import { useState } from 'react';

import type { RecoveryCandidate, RecoveryState } from '@/lib/commitments/recovery';
import {
  CATEGORY_FOR_MISS_REASON,
  RECOVERY_SLOT_HELP,
  RECOVERY_SLOT_LABELS,
  type RecoverySlot,
} from '@/lib/schemas/recovery';
import {
  DEADLINE_CATEGORY_LABELS,
  MISS_REASON_LABELS,
  missReasonSchema,
  type MissReason,
} from '@/lib/schemas/reckoning';

/**
 * The whole screen, when the backlog has passed the point where a dashboard
 * helps.
 *
 * Three slots and nothing else. No counts of what is left beyond the one line
 * at the top, no lists to scroll, no curriculum, no drift. Everything that is
 * absent is absent on purpose: they are all inputs to planning, and planning
 * is the thing that produced thirty-four unanswered misses.
 *
 * It is cold, like every other accountability surface. Nothing here says well
 * done.
 */
export function RecoveryMode({ initial }: { initial: RecoveryState }): React.JSX.Element {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<RecoverySlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Partial<Record<RecoverySlot, string>>>({});

  async function resolve(slot: RecoverySlot, body: Record<string, unknown>) {
    setBusy(slot);
    setError(null);
    try {
      const response = await fetch('/api/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot, ...body }),
        cache: 'no-store',
      });
      const payload = (await response.json()) as {
        effect?: string;
        state?: RecoveryState;
        error?: string;
      };

      if (!response.ok) {
        setError(payload.error ?? 'That did not save.');
        return;
      }

      setDone((current) => ({ ...current, [slot]: payload.effect }));
      if (payload.state) setState(payload.state);
      // A resolved slot clears when the next pass replaces it.
      if (payload.state && !payload.state.active) setDone({});
    } catch {
      setError('That did not save. You are probably offline.');
    } finally {
      setBusy(null);
    }
  }

  if (!state.active) {
    return (
      <div className="flex flex-col gap-md">
        <h1 className="text-xl font-semibold tracking-tight">Out of recovery</h1>
        <p className="text-text/60 text-sm">
          {state.counts.overdue} overdue, {state.counts.needsReckoning} unanswered. Below the
          thresholds. Reload for the dashboard.
        </p>
      </div>
    );
  }

  const resolvedThisPass = Object.keys(done).length;

  return (
    <div className="flex flex-col gap-xl">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Recovery</h1>
        {/*
          The count, once, plainly. Not a metric and not a chart -- the number
          is here so the size of the problem is not in doubt, and then the rest
          of the screen is three things to do about it.
        */}
        <p className="text-text/60 mt-xs text-sm">
          {state.counts.overdue} commitments are past due and {state.counts.needsReckoning} of them
          have not been answered for. The dashboard is off until that is under{' '}
          {state.thresholds.overdue} and {state.thresholds.needsReckoning}.
        </p>
        <p className="text-text/40 mt-2xs text-xs">
          Three at a time, three different ways. This will take more than one pass
          {state.session && state.session.passes > 0
            ? ` — ${state.session.passes} done so far.`
            : '.'}
        </p>
      </header>

      {error ? <p className="text-signal text-sm">{error}</p> : null}

      <div className="flex flex-col gap-lg">
        {state.slots.map((entry) => (
          <Slot
            key={entry.slot}
            slot={entry.slot}
            suggested={entry.suggested}
            why={entry.why}
            candidates={state.candidates}
            busy={busy === entry.slot}
            done={done[entry.slot]}
            onResolve={(body) => void resolve(entry.slot, body)}
          />
        ))}
      </div>

      {resolvedThisPass === 3 ? (
        <p className="text-text/60 text-sm">
          Three dispatched. {state.counts.overdue} left — the next three are above.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Choosing which commitment fills a slot.
 *
 * The OUTCOME is shown, in the option text and again under the select, because
 * the title alone is not an identifier. Two commitments called "Call the bank"
 * turned up in the first real data, and abandon is the only slot that cannot
 * be undone -- picking the wrong one there destroys a commitment the user
 * still meant to keep, and they would have no way to tell it had happened.
 */
function Picker({
  name,
  suggested,
  candidates,
  onSelect,
}: {
  name: string;
  suggested: RecoveryCandidate;
  candidates: RecoveryCandidate[];
  onSelect: (candidate: RecoveryCandidate) => void;
}): React.JSX.Element {
  return (
    <select
      name={name}
      defaultValue={suggested.id}
      onChange={(event) => {
        const chosen = candidates.find((candidate) => candidate.id === event.target.value);
        if (chosen) onSelect(chosen);
      }}
      className="border-edge bg-ground min-h-11 w-full rounded border px-sm text-sm"
    >
      {candidates.map((candidate) => (
        <option key={candidate.id} value={candidate.id}>
          {candidate.title} — {candidate.outcome} · {candidate.estimateMinutes}m ·{' '}
          {candidate.daysOverdue}d late
        </option>
      ))}
    </select>
  );
}

function Slot({
  slot,
  suggested,
  why,
  candidates,
  busy,
  done,
  onResolve,
}: {
  slot: RecoverySlot;
  suggested: RecoveryCandidate | null;
  why: string;
  candidates: RecoveryCandidate[];
  busy: boolean;
  done: string | undefined;
  onResolve: (body: Record<string, unknown>) => void;
}): React.JSX.Element {
  const [reason, setReason] = useState<MissReason>('underestimated');
  const [chosen, setChosen] = useState<RecoveryCandidate | null>(null);

  if (done) {
    return (
      <section className="border-edge bg-surface rounded-lg border p-md">
        <h2 className="text-base font-medium">{RECOVERY_SLOT_LABELS[slot]}</h2>
        <p className="text-text/60 mt-2xs text-sm">{done}</p>
      </section>
    );
  }

  if (!suggested) {
    return (
      <section className="border-edge bg-surface rounded-lg border p-md">
        <h2 className="text-base font-medium">{RECOVERY_SLOT_LABELS[slot]}</h2>
        <p className="text-text/50 mt-2xs text-sm">Nothing left for this slot.</p>
      </section>
    );
  }

  return (
    <section className="border-edge bg-surface rounded-lg border p-md">
      <h2 className="text-base font-medium">{RECOVERY_SLOT_LABELS[slot]}</h2>
      <p className="text-text/50 mt-2xs text-sm">{RECOVERY_SLOT_HELP[slot]}</p>
      <p className="text-text/40 mt-2xs text-xs">Chosen because it is {why}.</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const commitmentId = String(data.get('commitmentId') ?? '');

          if (slot === 'finish') {
            onResolve({ commitmentId, note: String(data.get('note') ?? '') || undefined });
          } else if (slot === 'reschedule') {
            onResolve({
              commitmentId,
              reason: String(data.get('reason') ?? ''),
              nextAction: String(data.get('nextAction') ?? ''),
              newDueAt: new Date(String(data.get('newDueAt') ?? '')).toISOString(),
            });
          } else {
            onResolve({ commitmentId, reason: String(data.get('reason') ?? '') });
          }
        }}
        className="mt-sm flex flex-col gap-sm"
      >
        <Picker
          name="commitmentId"
          suggested={suggested}
          candidates={candidates}
          onSelect={setChosen}
        />

        {/* Tracks the SELECTION, not the suggestion. A static line here would
            describe a different commitment the moment the select changed. */}
        <p className="text-text/50 text-xs">{(chosen ?? suggested).outcome}</p>
        <p className="text-text/40 text-xs">
          {(chosen ?? suggested).estimateMinutes} min · {(chosen ?? suggested).daysOverdue} days
          past due
          {(chosen ?? suggested).neverStarted ? ' · never started' : ''}
        </p>

        {slot === 'finish' ? (
          <input
            name="note"
            placeholder="What changed? One line, optional."
            className="border-edge bg-ground min-h-11 rounded border px-sm text-sm"
          />
        ) : null}

        {slot === 'reschedule' ? (
          <>
            <label className="flex flex-col gap-2xs">
              <span className="text-text/50 text-xs">Why was it missed?</span>
              <select
                name="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value as MissReason)}
                className="border-edge bg-ground min-h-11 rounded border px-sm text-sm"
              >
                {missReasonSchema.options.map((option) => (
                  <option key={option} value={option}>
                    {MISS_REASON_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>

            {/*
              Shown, never hidden. The deadline category is derived from the
              miss reason so the same question is not asked twice in two
              vocabularies -- but a mapping the user cannot see is one that
              misreports their history on their behalf.
            */}
            <p className="text-text/40 text-xs">
              The move will be recorded as{' '}
              <span className="text-text/70">
                {DEADLINE_CATEGORY_LABELS[CATEGORY_FOR_MISS_REASON[reason]]}
              </span>
              .
            </p>

            <input
              name="nextAction"
              required
              placeholder="The concrete next action. Required before any reschedule."
              className="border-edge bg-ground min-h-11 rounded border px-sm text-sm"
            />
            <label className="flex flex-col gap-2xs">
              <span className="text-text/50 text-xs">New deadline</span>
              <input
                name="newDueAt"
                type="datetime-local"
                required
                className="border-edge bg-ground min-h-11 rounded border px-sm text-sm"
              />
            </label>
          </>
        ) : null}

        {slot === 'abandon' ? (
          <input
            name="reason"
            required
            placeholder="Why are you stopping? This goes on the record."
            className="border-edge bg-ground min-h-11 rounded border px-sm text-sm"
          />
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="border-edge hover:border-signal min-h-11 rounded border px-md text-sm transition-colors"
        >
          {RECOVERY_SLOT_LABELS[slot]}
        </button>
      </form>
    </section>
  );
}
