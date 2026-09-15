'use client';

import { useState } from 'react';

import { RecoveryCodesPanel } from '@/components/recovery-codes/codes-panel';
import { RECOVERY_LOW_WATERMARK } from '@/lib/schemas/account-recovery';

/**
 * Recovery codes, in Settings.
 *
 * Two facts and one action: how many are left, that regenerating destroys the
 * old set, and the button. There is no "view my codes" -- they exist in
 * plaintext once, at generation, and a route that read them back would hand the
 * account's recovery credential to whoever happened to be signed in.
 *
 * The confirmation is not ceremony. Regenerating invalidates every code the
 * user has already saved, so somebody who clicks it and then closes the tab
 * without copying the new set has locked themselves out more thoroughly than
 * before they started.
 */
export function RecoveryCodesSection({ remaining }: { remaining: number }): React.JSX.Element {
  const [count, setCount] = useState(remaining);
  const [confirming, setConfirming] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/recovery/codes', { method: 'POST' });
      const body = (await response.json()) as { codes?: string[]; error?: string };

      if (!response.ok || !body.codes) {
        setError(body.error ?? 'That did not work.');
        return;
      }

      setCodes(body.codes);
      setCount(body.codes.length);
      setConfirming(false);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (codes) {
    return (
      <section className="border-edge bg-surface rounded-lg border p-lg">
        <RecoveryCodesPanel codes={codes} />
        <button
          type="button"
          onClick={() => setCodes(null)}
          className="border-edge hover:border-signal mt-lg inline-flex min-h-11 items-center rounded border px-md text-sm transition-colors"
        >
          Done
        </button>
      </section>
    );
  }

  const low = count < RECOVERY_LOW_WATERMARK;

  return (
    <section className="border-edge bg-surface rounded-lg border p-lg">
      <h2 className="text-base font-medium">Recovery codes</h2>
      <p className="text-text/60 mt-2xs text-sm">
        Single-use codes that get you back in when you have forgotten your password. There is no
        reset email.
      </p>

      <p
        className={
          low
            ? 'border-signal text-signal mt-md border-l-2 pl-md text-sm'
            : 'mt-md text-sm text-text/60'
        }
      >
        <span className="figures">{count}</span> {count === 1 ? 'code' : 'codes'} left.
        {low ? ' Generate a new set before you run out.' : null}
      </p>

      {error ? (
        <p role="alert" className="border-signal text-signal mt-md border-l-2 pl-md text-sm">
          {error}
        </p>
      ) : null}

      {confirming ? (
        <div className="border-edge mt-md rounded border p-md">
          <p className="text-sm">
            This invalidates all {count} of your current codes immediately. Anything you have
            written down stops working.
          </p>
          <div className="mt-md flex flex-wrap gap-sm">
            <button
              type="button"
              disabled={busy}
              onClick={() => void regenerate()}
              className="bg-signal text-ground min-h-11 rounded px-md text-sm font-medium disabled:opacity-50"
            >
              {busy ? 'Generating…' : 'Generate a new set'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="border-edge hover:border-signal inline-flex min-h-11 items-center rounded border px-md text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="border-edge hover:border-signal mt-md inline-flex min-h-11 items-center rounded border px-md text-sm transition-colors"
        >
          {count === 0 ? 'Generate codes' : 'Regenerate codes'}
        </button>
      )}
    </section>
  );
}
