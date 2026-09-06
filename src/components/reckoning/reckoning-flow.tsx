'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { CommitmentView } from '@/lib/commitments/service';
import {
  ACTIONS_FOR_REASON,
  MAX_STARTING_ACTION_MINUTES,
  MISS_REASON_LABELS,
  RECOVERY_ACTION_LABELS,
  START_SESSION_MINUTES,
  type MissReason,
  type RecoveryAction,
} from '@/lib/schemas/reckoning';

/**
 * The reckoning: three questions, in order.
 *
 * The order matters. Asking "why" before "did you actually do it" would
 * collect a reason for a miss that never happened, and the most common honest
 * answer to a missed deadline is "I did it, just late" -- which the history
 * has to record as late rather than losing entirely.
 */
export function ReckoningFlow({
  commitment,
  onDone,
  onCancel,
}: {
  commitment: CommitmentView;
  onDone: (effect: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [reason, setReason] = useState<MissReason | null>(null);
  const [action, setAction] = useState<RecoveryAction | null>(null);
  const [note, setNote] = useState('');
  const [detail, setDetail] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/commitments/${commitment.id}/reckoning`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { effect?: string; error?: string };

      if (!response.ok) {
        setError(result.error ?? 'That did not work.');
        return;
      }
      onDone(result.effect ?? 'Recorded.');
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-signal/50 bg-surface rounded-md border p-md">
      <header className="mb-md">
        <p className="text-signal text-xs font-medium uppercase tracking-wide">
          Reckoning · step {step} of 3
        </p>
        <h3 className="mt-2xs font-medium break-words">{commitment.title}</h3>
        <p className="text-text/50 mt-2xs text-xs">
          Deadline passed{' '}
          {commitment.minutesOverdue > 0 ? `${formatOverdue(commitment.minutesOverdue)} ago` : ''}
        </p>
      </header>

      {error ? (
        <p
          role="alert"
          className="border-signal/40 bg-signal/10 text-signal mb-md rounded border px-md py-sm text-sm"
        >
          {error}
        </p>
      ) : null}

      {/* ---- Step 1: did you actually do it? ---- */}
      {step === 1 ? (
        <section>
          <p className="text-sm">Did you actually complete it?</p>
          <p className="text-text/50 mt-2xs text-xs">
            If you did, it is recorded as completed late — not on time. That is the honest record.
          </p>

          <div className="mt-md flex flex-wrap gap-sm">
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit({ completed: true })}
              className="border-edge min-h-11 flex-1 rounded border px-md text-sm hover:border-signal disabled:opacity-50"
            >
              Yes — it is done
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep(2)}
              className="bg-signal min-h-11 flex-1 rounded px-md text-sm font-medium text-[color:var(--pact-base)] disabled:opacity-50"
            >
              No
            </button>
          </div>
        </section>
      ) : null}

      {/* ---- Step 2: why? ---- */}
      {step === 2 ? (
        <section>
          <p className="text-sm">Why was it missed?</p>
          <p className="text-text/50 mt-2xs text-xs">
            One answer. This is counted, which is how a pattern becomes visible.
          </p>

          <ul className="mt-md flex flex-col gap-2xs">
            {(Object.keys(MISS_REASON_LABELS) as MissReason[]).map((key) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => {
                    setReason(key);
                    setAction(null);
                    setStep(3);
                  }}
                  className="border-edge min-h-11 w-full rounded border px-md text-left text-sm hover:border-signal"
                >
                  {MISS_REASON_LABELS[key]}
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setStep(1)}
            className="text-text/50 mt-md text-xs underline"
          >
            Back
          </button>
        </section>
      ) : null}

      {/* ---- Step 3: what changes? ---- */}
      {step === 3 && reason ? (
        <section>
          <p className="text-sm">What changes?</p>
          <p className="text-text/50 mt-2xs text-xs">
            Every option below does something. A reason with no consequence is journaling.
          </p>

          <ul className="mt-md flex flex-col gap-2xs">
            {ACTIONS_FOR_REASON[reason].map((key) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setAction(key)}
                  aria-pressed={action === key}
                  className={[
                    'min-h-11 w-full rounded border px-md text-left text-sm',
                    action === key ? 'border-signal' : 'border-edge hover:border-signal',
                  ].join(' ')}
                >
                  {RECOVERY_ACTION_LABELS[key]}
                </button>
              </li>
            ))}
          </ul>

          {action ? (
            <div className="mt-md flex flex-col gap-sm">
              <RecoveryFields action={action} detail={detail} setDetail={setDetail} />
            </div>
          ) : null}

          <label className="mt-md flex flex-col gap-2xs">
            <span className="text-text/70 text-sm">Anything else? (optional)</span>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="border-edge bg-base text-text w-full rounded border px-sm py-xs outline-none focus:border-signal"
            />
          </label>

          <div className="mt-md flex flex-wrap gap-sm">
            <button
              type="button"
              disabled={busy || !action}
              onClick={() => {
                if (!action) return;
                void submit({
                  completed: false,
                  reason,
                  note: note.trim() || undefined,
                  recovery: buildRecovery(action, detail, commitment),
                });
              }}
              className="bg-signal min-h-11 flex-1 rounded px-md text-sm font-medium text-[color:var(--pact-base)] disabled:opacity-50"
            >
              {busy ? 'Recording…' : 'Record it'}
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="border-edge text-text/70 min-h-11 rounded border px-md text-sm"
            >
              Back
            </button>
          </div>
        </section>
      ) : null}

      <button
        type="button"
        onClick={onCancel}
        className="text-text/40 hover:text-text mt-md block text-xs underline"
      >
        Not now
      </button>
    </div>
  );
}

const INPUT =
  'border-edge bg-base text-text min-h-11 w-full rounded border px-sm py-xs outline-none focus:border-signal';

/** The detail each action needs to actually take effect. */
function RecoveryFields({
  action,
  detail,
  setDetail,
}: {
  action: RecoveryAction;
  detail: Record<string, string>;
  setDetail: (next: Record<string, string>) => void;
}): React.JSX.Element | null {
  const set = (key: string, value: string) => setDetail({ ...detail, [key]: value });
  const field = (key: string) => detail[key] ?? '';

  switch (action) {
    case 'reduce-scope':
    case 'lower-quality-bar':
      return (
        <>
          <Field
            label={
              action === 'reduce-scope' ? 'The smaller outcome' : 'The lower bar, as the outcome'
            }
          >
            <input
              className={INPUT}
              value={field('newOutcome')}
              onChange={(e) => set('newOutcome', e.target.value)}
            />
          </Field>
          {action === 'reduce-scope' ? (
            <Field label="New estimate (minutes)">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                className={INPUT}
                value={field('newEstimateMinutes')}
                onChange={(e) => set('newEstimateMinutes', e.target.value)}
              />
            </Field>
          ) : null}
        </>
      );

    case 'define-next-action':
      return (
        <Field label="The concrete next action" hint="Required before this can be rescheduled.">
          <input
            className={INPUT}
            value={field('nextAction')}
            onChange={(e) => set('nextAction', e.target.value)}
          />
        </Field>
      );

    case 'define-starting-action':
      return (
        <>
          <Field label="A starting action" hint={`${MAX_STARTING_ACTION_MINUTES} minutes or less.`}>
            <input
              className={INPUT}
              value={field('nextAction')}
              onChange={(e) => set('nextAction', e.target.value)}
            />
          </Field>
          <Field label="Minutes">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_STARTING_ACTION_MINUTES}
              className={INPUT}
              value={field('startingMinutes')}
              onChange={(e) => set('startingMinutes', e.target.value)}
            />
          </Field>
        </>
      );

    case 'schedule-start-session':
      return (
        <Field label="Start at" hint={`A ${START_SESSION_MINUTES}-minute session, today.`}>
          <input
            type="datetime-local"
            className={INPUT}
            value={field('startAt')}
            onChange={(e) => set('startAt', e.target.value)}
          />
        </Field>
      );

    case 'mark-blocked':
      return (
        <>
          <Field label="Waiting on whom?">
            <input
              className={INPUT}
              value={field('blockedOn')}
              onChange={(e) => set('blockedOn', e.target.value)}
            />
          </Field>
          <Field label="Follow up on">
            <input
              type="date"
              className={INPUT}
              value={field('followUpDate')}
              onChange={(e) => set('followUpDate', e.target.value)}
            />
          </Field>
        </>
      );

    case 'link-displacing-commitment':
      return (
        <Field label="What displaced it?" hint="The id of the commitment that took priority.">
          <input
            className={INPUT}
            value={field('displacedBy')}
            onChange={(e) => set('displacedBy', e.target.value)}
          />
        </Field>
      );

    case 'split':
      return (
        <Field label="Split into" hint="One per line: title | outcome | minutes | YYYY-MM-DDTHH:MM">
          <textarea
            rows={3}
            className={INPUT}
            value={field('parts')}
            onChange={(e) => set('parts', e.target.value)}
          />
        </Field>
      );

    case 'abandon':
      return (
        <Field label="Why abandon it? (optional)">
          <input
            className={INPUT}
            value={field('abandonReason')}
            onChange={(e) => set('abandonReason', e.target.value)}
          />
        </Field>
      );

    default:
      return null;
  }
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2xs">
      <span className="text-text/70 text-sm">{label}</span>
      {hint ? <span className="text-text/40 text-xs">{hint}</span> : null}
      {children}
    </label>
  );
}

/** Shapes the form fields into the discriminated union the API expects. */
function buildRecovery(
  action: RecoveryAction,
  detail: Record<string, string>,
  commitment: CommitmentView,
): Record<string, unknown> {
  switch (action) {
    case 'reduce-scope':
      return {
        action,
        newOutcome: detail.newOutcome,
        newEstimateMinutes: Number(detail.newEstimateMinutes),
      };
    case 'lower-quality-bar':
      return { action, newOutcome: detail.newOutcome };
    case 'define-next-action':
      return { action, nextAction: detail.nextAction };
    case 'define-starting-action':
      return {
        action,
        nextAction: detail.nextAction,
        startingMinutes: Number(detail.startingMinutes),
      };
    case 'schedule-start-session':
      return { action, startAt: new Date(detail.startAt ?? '').toISOString() };
    case 'mark-blocked':
      return {
        action,
        blockedOn: detail.blockedOn,
        followUpDate: new Date(detail.followUpDate ?? '').toISOString(),
      };
    case 'link-displacing-commitment':
      return { action, displacedBy: detail.displacedBy };
    case 'abandon':
      return { action, abandonReason: detail.abandonReason || undefined };
    case 'split':
      return {
        action,
        parts: (detail.parts ?? '')
          .split('\n')
          .map((line) => line.split('|').map((part) => part.trim()))
          .filter((parts) => parts.length >= 4)
          .map(([title, outcome, minutes, due]) => ({
            title,
            outcome,
            estimateMinutes: Number(minutes),
            dueAt: new Date(due ?? '').toISOString(),
          })),
      };
    default:
      return { action, commitmentId: commitment.id };
  }
}

function formatOverdue(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
