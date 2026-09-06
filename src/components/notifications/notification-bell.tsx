'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { InboxItem } from '@/lib/notifications/inbox';

/**
 * The in-app notification channel.
 *
 * Polled rather than pushed: web push is the next change, and until then the
 * app has to notice a notification came due while it was open. Sixty seconds
 * is a compromise -- a deadline notification arriving up to a minute late is
 * fine, and anything tighter is a request per few seconds against an M0
 * cluster for a single user.
 */
const POLL_MS = 60_000;

export function NotificationBell(): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' });
      if (!response.ok) return;
      const body = (await response.json()) as { items: InboxItem[]; unread: number };
      setItems(body.items);
      setUnread(body.unread);
    } catch {
      // Offline. The badge keeps its last value rather than flashing to zero,
      // which would read as "nothing to do" — the one wrong answer here.
    }
  }, []);

  useEffect(() => {
    // Deferred by a tick rather than called inline: an effect must not write
    // state in the same pass that scheduled it, and this keeps the first fetch
    // on exactly the same footing as every subsequent poll.
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);

    // Coming back to the app is the moment most likely to have a backlog.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  async function act(item: InboxItem, action: 'complete' | 'abandon' | 'open'): Promise<void> {
    if (action === 'open') {
      setOpen(false);
      router.push('/dashboard');
      return;
    }

    setBusy(item.id);
    try {
      await fetch(`/api/commitments/${item.commitmentId}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'abandon' ? { reason: 'Answered no on the check-in' } : {}),
      });
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [item.id] }),
      });
      await load();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((wasOpen) => !wasOpen);
          if (!open) void load();
        }}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="border-edge relative flex min-h-11 min-w-11 items-center justify-center rounded border px-sm transition-colors hover:border-signal"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
          <path d="M10.3 21a2 2 0 0 0 3.4 0" />
        </svg>

        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="bg-signal absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full text-[10px] font-semibold text-[color:var(--pact-base)]"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {/* Tapping away closes it, which is the expected gesture on a phone. */}
          <button
            type="button"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />

          <div className="border-edge bg-surface absolute right-0 z-50 mt-sm flex max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-md border shadow-lg">
            <div className="border-edge flex items-center justify-between border-b px-md py-sm">
              <p className="text-sm font-medium">Notifications</p>
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    void fetch('/api/notifications', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ all: true }),
                    }).then(load);
                  }}
                  className="text-text/60 hover:text-text text-xs"
                >
                  Mark all read
                </button>
              ) : null}
            </div>

            {items.length === 0 ? (
              <p className="text-text/50 px-md py-lg text-sm">Nothing yet.</p>
            ) : (
              <ul className="divide-edge divide-y overflow-y-auto">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={['px-md py-sm', item.read ? 'opacity-60' : ''].join(' ')}
                  >
                    <div className="flex items-start gap-sm">
                      {!item.read ? (
                        <span
                          aria-hidden="true"
                          className="bg-signal mt-1.5 size-2 shrink-0 rounded-full"
                        />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium break-words">{item.title}</p>
                        <p className="text-text/60 mt-2xs text-xs break-words">{item.body}</p>

                        {item.deferredFromQuietHours ? (
                          <p className="text-text/40 mt-2xs text-xs">
                            Held until quiet hours ended.
                          </p>
                        ) : null}

                        <div className="mt-sm flex flex-wrap gap-xs">
                          {item.actions.map((action) => (
                            <button
                              key={action.action}
                              type="button"
                              disabled={busy === item.id}
                              onClick={() => void act(item, action.action)}
                              className="border-edge min-h-9 rounded border px-sm text-xs transition-colors hover:border-signal disabled:opacity-50"
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
