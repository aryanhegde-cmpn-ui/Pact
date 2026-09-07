'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Taking a reward already earned.
 *
 * Plain, and deliberately not in the accent. The server enforces that this can
 * only move `earned` to `claimed` -- the condition on the update is what stops
 * a claim request being a way to award yourself.
 */
export function ClaimReward({
  rewardId,
  name,
}: {
  rewardId: string;
  name: string;
}): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/rewards/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardId }),
        cache: 'no-store',
      });
      if (!response.ok) {
        setError(((await response.json()) as { error?: string }).error ?? 'That did not save.');
        return;
      }

      router.refresh();
    } catch {
      setError('That did not save. You are probably offline.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-sm">
      <button
        type="button"
        disabled={busy}
        onClick={() => void claim()}
        aria-label={`Mark ${name} as taken`}
        className="border-edge hover:border-signal min-h-11 rounded border px-md text-sm transition-colors"
      >
        Mark as taken
      </button>
      {error ? <p className="text-signal mt-2xs text-sm">{error}</p> : null}
    </div>
  );
}
