'use client';

import { useCallback, useEffect, useState } from 'react';

interface RelationshipState {
  status: 'none' | 'pending' | 'active' | 'revoked';
  overseerUsername: string | null;
  inviteExpiresAt: string | null;
  revokedAt: string | null;
}

/**
 * The primary's control over the arrangement.
 *
 * Revoke ends the RELATIONSHIP. It deliberately offers no way to dismiss an
 * individual consequence -- that distinction is the point of the arrangement,
 * and it has to hold in the interface as well as the permission matrix.
 */
export function OverseerSection({
  shareNotes,
  onShareNotesChange,
}: {
  shareNotes: boolean;
  onShareNotesChange: (next: boolean) => void;
}): React.JSX.Element {
  const [state, setState] = useState<RelationshipState | null>(null);
  const [invite, setInvite] = useState<{ token: string; expiresAt: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/relationship/invite', { cache: 'no-store' });
      if (response.ok) setState((await response.json()) as RelationshipState);
    } catch {
      // Offline; the section simply shows nothing rather than a wrong state.
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <section>
      <h2 className="text-text/70 mb-md text-sm font-medium uppercase tracking-wide">Overseer</h2>
      <div className="border-edge bg-surface rounded-md border p-md">
        <p className="text-text/60 text-xs">
          An overseer sees what you committed to and whether you did it. They administer the rewards
          and consequences; you cannot change those yourself, which is the point.
        </p>

        <p className="mt-md text-sm">
          {state === null
            ? 'Loading…'
            : state.status === 'active'
              ? `Active — ${state.overseerUsername ?? 'an overseer'}`
              : state.status === 'pending'
                ? 'Invite outstanding, not yet accepted'
                : state.status === 'revoked'
                  ? 'Revoked'
                  : 'No overseer'}
        </p>

        {invite ? (
          <div className="border-signal/40 bg-signal/10 mt-md rounded border p-sm">
            <p className="text-signal text-xs font-medium">Send this link. It is shown once.</p>
            <code className="text-text mt-2xs block break-all text-xs">
              {`${window.location.origin}/join?token=${invite.token}`}
            </code>
            <p className="text-text/50 mt-2xs text-xs">
              Expires {new Date(invite.expiresAt).toLocaleDateString()}. Single use.
            </p>
          </div>
        ) : null}

        <div className="mt-md flex flex-wrap gap-sm">
          {state?.status !== 'active' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void fetch('/api/relationship/invite', { method: 'POST' })
                  .then((r) => r.json())
                  .then((body: { token?: string; expiresAt?: string; error?: string }) => {
                    if (body.token && body.expiresAt) {
                      setInvite({ token: body.token, expiresAt: body.expiresAt });
                    }
                  })
                  .then(load)
                  .finally(() => setBusy(false));
              }}
              className="border-edge min-h-11 rounded border px-md text-sm hover:border-signal disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Generate an invite'}
            </button>
          ) : null}

          {state?.status === 'active' || state?.status === 'pending' ? (
            confirming ? (
              <div className="border-signal/50 w-full rounded border p-sm">
                <p className="text-sm">
                  Revoke access? They lose it on their next request. The history stays.
                </p>
                <div className="mt-sm flex gap-sm">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void fetch('/api/relationship/revoke', { method: 'POST' })
                        .then(load)
                        .finally(() => {
                          setBusy(false);
                          setConfirming(false);
                          setInvite(null);
                        });
                    }}
                    className="bg-signal min-h-11 rounded px-md text-sm font-medium text-on-signal"
                  >
                    Yes, revoke
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="border-edge min-h-11 rounded border px-md text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="border-edge text-text/70 hover:text-text min-h-11 rounded border px-md text-sm"
              >
                Revoke access
              </button>
            )
          ) : null}
        </div>

        <label className="border-edge mt-md flex items-start justify-between gap-md border-t pt-md">
          <span>
            <span className="text-sm">Share my free-text notes</span>
            <span className="text-text/50 mt-2xs block text-xs">
              Off by default. Your reasons and categories are always visible; the notes are where
              you are honest with yourself.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={shareNotes}
            aria-label="Share my free-text notes"
            onClick={() => onShareNotesChange(!shareNotes)}
            className={[
              'border-edge min-h-11 shrink-0 rounded border px-md text-sm',
              shareNotes ? 'border-signal text-text' : 'text-text/50',
            ].join(' ')}
          >
            {shareNotes ? 'Shared' : 'Private'}
          </button>
        </label>
      </div>
    </section>
  );
}
