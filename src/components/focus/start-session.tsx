'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  SESSION_KIND_HELP,
  SESSION_KIND_LABELS,
  sessionKindSchema,
  type SessionKind,
} from '@/lib/schemas/focus';

/**
 * Starting a session.
 *
 * ---------------------------------------------------------------------------
 * EXECUTION IS THE DEFAULT, AND CHANGING IT TAKES A CLICK.
 * ---------------------------------------------------------------------------
 * The planning-versus-execution ratio is one of the few numbers that can tell
 * someone they are busy rather than productive, and it is defeated entirely by
 * calling planning "execution" -- which the person doing it would not
 * experience as cheating, because reading around a problem genuinely feels
 * like working on it.
 *
 * So the kind is not a required field on the way in. A required field gets the
 * first option, every time, and the value becomes noise. It is a default that
 * is right most of the time, with the honest-but-unflattering answers one
 * deliberate tap away.
 * ---------------------------------------------------------------------------
 */
export function StartSession({
  commitment,
}: {
  commitment: {
    id: string;
    title: string;
    outcome: string;
    estimateMinutes: number;
    dueAt: string;
    blockId: string | null;
    topicKey: string | null;
  };
}): React.JSX.Element {
  const router = useRouter();
  const [kind, setKind] = useState<SessionKind>('execution');
  const [budget, setBudget] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/focus/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commitmentId: commitment.id,
          kind,
          ...(kind === 'research' ? { researchBudgetMinutes: budget } : {}),
        }),
        cache: 'no-store',
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? 'That did not start.');
        return;
      }

      router.refresh();
    } catch {
      setError('That did not start. You are probably offline.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-lg p-lg">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{commitment.title}</h1>
        <p className="text-text/60 mt-xs text-sm">{commitment.outcome}</p>
        <p className="text-text/40 mt-xs text-xs">
          {commitment.estimateMinutes} minutes · due{' '}
          {new Date(commitment.dueAt).toLocaleString('en-GB', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </header>

      {error ? <p className="text-signal text-sm">{error}</p> : null}

      <fieldset className="flex flex-col gap-xs">
        <legend className="text-text/50 mb-xs text-xs">What kind of work is this?</legend>
        {sessionKindSchema.options.map((option) => (
          <label
            key={option}
            className={`flex cursor-pointer flex-col rounded border p-sm ${
              kind === option ? 'border-signal' : 'border-edge'
            }`}
          >
            <span className="flex items-center gap-xs text-sm">
              <input
                type="radio"
                name="kind"
                value={option}
                checked={kind === option}
                onChange={() => setKind(option)}
                className="size-4"
              />
              {SESSION_KIND_LABELS[option]}
            </span>
            <span className="text-text/40 mt-2xs pl-6 text-xs">{SESSION_KIND_HELP[option]}</span>
          </label>
        ))}
      </fieldset>

      {/*
        Only for research, and optional. When it runs out the session
        interrupts exactly once and asks for a decision.
      */}
      {kind === 'research' ? (
        <label className="flex flex-col gap-2xs">
          <span className="text-text/50 text-xs">
            Research budget, in minutes. At zero it will ask once.
          </span>
          <input
            type="number"
            min={1}
            max={240}
            value={budget}
            onChange={(event) => setBudget(Number(event.target.value))}
            className="border-edge bg-base min-h-11 w-28 rounded border px-sm text-sm"
          />
        </label>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => void start()}
        className="border-signal text-signal min-h-11 rounded border px-md text-sm"
      >
        Start
      </button>

      <button
        type="button"
        onClick={() => router.back()}
        className="text-text/40 hover:text-signal min-h-11 text-xs underline"
      >
        Not now
      </button>
    </main>
  );
}
