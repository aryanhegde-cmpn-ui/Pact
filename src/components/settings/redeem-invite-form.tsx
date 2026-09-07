'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/** Creates the overseer account from a single-use invite. */
export function RedeemInviteForm({ initialToken }: { initialToken: string }): React.JSX.Element {
  const router = useRouter();
  const [token, setToken] = useState(initialToken);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

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
      const body = (await response.json()) as { error?: string; details?: { message: string }[] };

      if (!response.ok) {
        setError(body.details?.[0]?.message ?? body.error ?? 'That did not work.');
        return;
      }
      setDone(true);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="border-edge bg-surface rounded-md border p-md">
        <p className="text-sm font-medium">Account created</p>
        <p className="text-text/60 mt-2xs text-xs">Sign in with the username you chose.</p>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="bg-signal mt-md min-h-11 w-full rounded px-md text-sm font-medium text-ground"
        >
          Go to sign in
        </button>
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
