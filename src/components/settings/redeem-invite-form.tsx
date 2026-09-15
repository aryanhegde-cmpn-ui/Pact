'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { RecoveryCodesPanel } from '@/components/recovery-codes/codes-panel';

/** Creates the overseer account from a single-use invite. */
export function RedeemInviteForm({ initialToken }: { initialToken: string }): React.JSX.Element {
  const router = useRouter();
  const [token, setToken] = useState(initialToken);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The codes, held only until they are acknowledged.
   *
   * Non-null IS the done state: an account exists the moment this is set, and
   * there is no screen between creating it and showing these. An account
   * created without its codes shown is an account with no way back in -- there
   * is no reset email, and an overseer cannot ask the primary to run a script.
   */
  const [codes, setCodes] = useState<string[] | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/relationship/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: token.trim(),
          username: String(form.get('username') ?? '').trim(),
          email: String(form.get('email') ?? '').trim(),
          password: String(form.get('password') ?? ''),
          displayName: String(form.get('displayName') ?? '').trim() || undefined,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        details?: { message: string }[];
        recoveryCodes?: string[];
      };

      if (!response.ok) {
        setError(body.details?.[0]?.message ?? body.error ?? 'That did not work.');
        return;
      }
      setCodes(body.recoveryCodes ?? []);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (codes) {
    return (
      <div className="flex flex-col gap-lg">
        <div className="border-edge bg-surface rounded-md border p-md">
          <p className="text-sm font-medium">Account created</p>
          <p className="text-text/60 mt-2xs text-xs">Sign in with the username you chose.</p>
        </div>

        {/*
          The ONLY way past this screen is the acknowledgement. No skip, no
          "remind me later", no route that reads the codes back afterwards --
          all three would turn a saved credential into an unsaved one.
        */}
        <RecoveryCodesPanel
          codes={codes}
          onAcknowledged={() => router.push('/')}
          continueLabel="Go to sign in"
        />
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-md">
      <Field label="Invite code">
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoCapitalize="none"
          spellCheck={false}
          className={INPUT}
        />
      </Field>

      <Field label="Username" hint="3–20 characters: letters, digits, hyphen, underscore.">
        <input name="username" autoCapitalize="none" spellCheck={false} className={INPUT} />
      </Field>

      <Field label="Email">
        <input name="email" type="email" autoCapitalize="none" className={INPUT} />
      </Field>

      <Field label="Password" hint="At least 12 characters.">
        <input name="password" type="password" autoComplete="new-password" className={INPUT} />
      </Field>

      <Field label="Display name (optional)">
        <input name="displayName" className={INPUT} />
      </Field>

      {error ? (
        <p
          role="alert"
          className="border-signal/40 bg-signal/10 text-signal rounded border px-md py-sm text-sm"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="bg-signal min-h-11 rounded px-md font-medium text-ground disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create account'}
      </button>
    </form>
  );
}

const INPUT =
  'border-edge bg-surface text-text min-h-11 w-full rounded border px-md py-sm focus:border-signal';

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
