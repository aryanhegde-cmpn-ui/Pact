'use client';

import { useCallback, useState } from 'react';

import type { CommitmentView } from '@/lib/commitments/service';
import { DispatchHealthBanner } from '@/components/pwa/dispatch-health-banner';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import { PushReconciler } from '@/components/pwa/push-reconciler';
import { NotificationPermission } from '@/components/pwa/notification-permission';
import { StalenessBanner } from '@/components/pwa/staleness-banner';
import { CommitmentRow } from './commitment-row';
import { CreateCommitmentForm } from './create-form';

/**
 * Today's list.
 *
 * Overdue work sits ABOVE today's, not mixed in and not tucked behind a tab.
 * Something you have already failed to do is more important than something you
 * have not yet failed to do, and burying it is how it stays buried.
 */
export function CommitmentList({
  initial,
  timeZone,
  today,
  vapidPublicKey,
  lastDispatchAt,
  nowIso,
}: {
  initial: {
    commitments: CommitmentView[];
    overdue: CommitmentView[];
    /** Every overdue row, not just the page above. */
    overdueTotal: number;
    needsReckoningTotal: number;
  };
  timeZone: string;
  today: string;
  vapidPublicKey?: string;
  lastDispatchAt?: string | null;
  nowIso?: string;
}): React.JSX.Element {
  const [data, setData] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  /** Set when the service worker served this from cache. Null means live. */
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/commitments?from=${today}&to=${today}`, {
        cache: 'no-store',
      });
      if (response.ok) {
        const body = (await response.json()) as {
          commitments: CommitmentView[];
          overdue: CommitmentView[];
          overdueTotal: number;
          needsReckoningTotal: number;
        };
        setData({
          commitments: body.commitments,
          overdue: body.overdue,
          overdueTotal: body.overdueTotal,
          needsReckoningTotal: body.needsReckoningTotal,
        });
        // The worker sets these when it falls back to cache. Never assume a
        // 200 means fresh -- that is exactly how stale deadlines get shown as
        // current.
        setCachedAt(
          response.headers.get('x-pact-stale') === 'true'
            ? (response.headers.get('x-pact-cached-at') ?? new Date().toISOString())
            : null,
        );
      }
    } catch {
      // The request failed outright, so what is on screen is whatever was last
      // loaded. Say so rather than leaving it looking live.
      setCachedAt((previous) => previous ?? new Date().toISOString());
    } finally {
      setRefreshing(false);
    }
  }, [today]);

  const open = data.commitments.filter((c) => c.status === 'pending' || c.status === 'in-progress');
  const closed = data.commitments.filter((c) => c.status === 'done' || c.status === 'abandoned');

  const totalCommitments = data.commitments.length + data.overdue.length;

  return (
    <div className="flex flex-col gap-xl">
      <StalenessBanner cachedAt={cachedAt} onRetry={() => void reload()} />

      {/* Silent scheduler failure is the one thing push cannot report itself. */}
      {lastDispatchAt !== undefined && nowIso ? (
        <DispatchHealthBanner lastDispatchAt={lastDispatchAt} now={nowIso} />
      ) : null}

      {/* Reconciles this browser's subscription against the server. */}
      <PushReconciler publicKey={vapidPublicKey} />

      <CreateCommitmentForm timeZone={timeZone} onCreated={() => void reload()} />

      {/* Only once there is something worth being interrupted about. */}
      <NotificationPermission commitmentCount={totalCommitments} vapidPublicKey={vapidPublicKey} />
      <InstallPrompt />

      {data.overdue.length > 0 ? (
        <section aria-labelledby="overdue-heading">
          <h2
            id="overdue-heading"
            className="text-signal mb-sm text-sm font-medium uppercase tracking-wide"
          >
            {/*
              The count is the WHOLE set, not the page. Showing the page size
              here would tell someone with forty overdue commitments that they
              have fifteen.
            */}
            Overdue ·{' '}
            {data.overdueTotal > data.overdue.length
              ? `${data.overdue.length} of ${data.overdueTotal}`
              : data.overdue.length}
          </h2>
          <ul className="flex flex-col gap-sm">
            {data.overdue.map((commitment) => (
              <CommitmentRow
                key={commitment.id}
                commitment={commitment}
                timeZone={timeZone}
                onChanged={() => void reload()}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="today-heading">
        <h2
          id="today-heading"
          className="text-text/70 mb-sm text-sm font-medium uppercase tracking-wide"
        >
          Today{refreshing ? ' · updating' : ''}
        </h2>

        {open.length === 0 ? (
          <p className="text-text/50 text-sm">
            {data.overdue.length > 0
              ? 'Nothing else due today.'
              : 'Nothing due today. Make a commitment when you have one.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-sm">
            {open.map((commitment) => (
              <CommitmentRow
                key={commitment.id}
                commitment={commitment}
                timeZone={timeZone}
                onChanged={() => void reload()}
              />
            ))}
          </ul>
        )}
      </section>

      {closed.length > 0 ? (
        <section aria-labelledby="closed-heading">
          <h2
            id="closed-heading"
            className="text-text/50 mb-sm text-sm font-medium uppercase tracking-wide"
          >
            Closed today
          </h2>
          <ul className="flex flex-col gap-sm">
            {closed.map((commitment) => (
              <CommitmentRow
                key={commitment.id}
                commitment={commitment}
                timeZone={timeZone}
                onChanged={() => void reload()}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
