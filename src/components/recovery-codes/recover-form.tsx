'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { RECOVERY_LOW_WATERMARK } from '@/lib/schemas/account-recovery';

/**
 * Recovering an account, in two steps and one page.
 *
 * ---------------------------------------------------------------------------
 * STEP ONE TAKES BOTH FIELDS AT ONCE, AND THAT IS THE POINT.
 * ---------------------------------------------------------------------------
 * A form that asked for the identifier, said "check your codes", and then
 * asked for one would have told an anonymous visitor whether that account
 * exists before they presented anything. Both fields, one submit, one message
 * for every way it can fail.
 *
 * The copy never says which part was wrong, because the server does not know
 * how to tell us either -- it returns the same sentence for an unknown
 * identifier, a wrong code, a spent code and a locked account.
 * ---------------------------------------------------------------------------
 */
type Stage =
  | { name: 'verify' }
  | { name: 'set-password'; token: string }
  | { name: 'done'; username: string; remaining: number };

export function RecoverForm(): React.JSX.Element {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ name: 'verify' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/recovery/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          identifier: String(form.get('identifier') ?? '').trim(),
          code: String(form.get('code') ?? ''),
        }),
      });
      const body = (await response.json()) as { token?: string; error?: string };

      if (!response.ok || !body.token) {
        setError(body.error ?? 'That identifier and code do not match.');
        return;
      }

      setStage({ name: 'set-password', token: body.token });
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function reset(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (stage.name !== 'set-password') return;

    setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');

    if (password !== String(form.get('confirm') ?? '')) {
      setError('Those passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/recovery/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: stage.token, password }),
      });
      const body = (await response.json()) as {
        username?: string;
        remaining?: number;
        error?: string;
      };

      if (!response.ok) {
        setError(body.error ?? 'That did not work.');
        return;
      }

      setStage({
        name: 'done',
        username: body.username ?? '',
        remaining: body.remaining ?? 0,
      });
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (stage.name === 'done') {
    return (
      <div className="flex flex-col gap-md">
        <h2 className="text-base font-medium">Password changed</h2>
        <p className="text-text/60 text-sm">
          Every other session has been signed out. Sign in with your new password.
        </p>

        {/*
          The count is stated whether it is nine or one. Someone who has just
          used a code is the person best placed to notice they are running out,
          and the warning below three is the same threshold settings uses.
        */}
        <p
          className={
            stage.remaining < RECOVERY_LOW_WATERMARK
              ? 'border-signal text-signal border-l-2 pl-md text-sm'
              : 'text-text/60 text-sm'
          }
        >
          <span className="figures">{stage.remaining}</span> recovery{' '}
          {stage.remaining === 1 ? 'code' : 'codes'} left.
          {stage.remaining < RECOVERY_LOW_WATERMARK
            ? ' Generate a new set from Settings once you are back in.'
            : null}
        </p>

        <button
          type="button"
          onClick={() => router.push('/')}
          className="bg-signal text-ground min-h-14 rounded px-md font-medium transition-opacity hover:opacity-90"
        >
          Go to sign in
        </button>
      </div>
    );
  }

  if (stage.name === 'set-password') {
    return (
      <form onSubmit={reset} noValidate className="flex flex-col gap-md">
        <div>
          <h2 className="text-base font-medium">Set a new password</h2>
          <p className="text-text/60 mt-2xs text-sm">
            At least 12 characters. This link is good for ten minutes.
          </p>
        </div>

        <Field label="New password">
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            className={INPUT}
          />
        </Field>

        <Field label="Confirm">
          <input name="confirm" type="password" autoComplete="new-password" className={INPUT} />
        </Field>

        {error ? <Problem>{error}</Problem> : null}

        <button
          type="submit"
          disabled={busy}
          className="bg-signal text-ground min-h-14 rounded px-md font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Set password'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} noValidate className="flex flex-col gap-md">
      <Field label="Username or email">
        <input
          name="identifier"
          autoCapitalize="none"
          autoComplete="username"
          spellCheck={false}
          autoFocus
          className={INPUT}
        />
      </Field>

      <Field label="Recovery code" hint="One of the ten you saved. Hyphens and case do not matter.">
        <input
          name="code"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          spellCheck={false}
          placeholder="A2B3C-D4E5F"
          className={`${INPUT} figures`}
        />
      </Field>

      {error ? <Problem>{error}</Problem> : null}

      <button
        type="submit"
        disabled={busy}
        className="bg-signal text-ground min-h-14 rounded px-md font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Checking…' : 'Continue'}
      </button>
    </form>
  );
}

const INPUT =
  'border-edge bg-surface text-text focus:border-signal min-h-11 w-full rounded border px-md disabled:opacity-50';

function Problem({ children }: { children: React.ReactNode }) {
  // A left rule, like every other annotation in the app.
  return (
    <p role="alert" className="border-signal text-signal border-l-2 pl-md text-sm">
      {children}
    </p>
  );
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
    <label className="flex flex-col gap-xs">
      <span className="text-text/70 text-sm">{label}</span>
      {hint ? <span className="text-text/40 text-xs">{hint}</span> : null}
      {children}
    </label>
  );
}
