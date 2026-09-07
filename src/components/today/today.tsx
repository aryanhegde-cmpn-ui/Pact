'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { CommitmentRow } from '@/components/commitments/commitment-row';
import { DispatchHealthBanner } from '@/components/pwa/dispatch-health-banner';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import { NotificationPermission } from '@/components/pwa/notification-permission';
import { PushReconciler } from '@/components/pwa/push-reconciler';
import { StalenessBanner } from '@/components/pwa/staleness-banner';
import { StakesStatusLine } from '@/components/stakes/status-line';
import type { TodayView } from '@/lib/today/service';

import { BlockLedger } from './block-ledger';
import { BlockRing } from './block-ring';
import { NextAction } from './next-action';

/**
 * Today.
 *
 * Order down the page is the whole design:
 *
 *   1. the greeting, warm, set large
 *   2. an unanswered miss, if any -- above all other work, always
 *   3. the next action, the largest thing here
 *   4. the three blocks and the ring
 *   5. anything else due today, plainly
 *   6. the overdue COUNT, as a link. The list lives on its own page.
 *   7. phase drift, one line
 *
 * Two registers on one page. The greeting is 28px with room around it; the
 * ledger below is 14px on hairline rules with tabular figures. Warmth comes
 * from the typography and the copy, never from softening what the numbers say.
 *
 * Signal appears exactly twice: the miss rule, and the Start button.
 */
export function Today({
  initial,
  timeZone,
  vapidPublicKey,
  lastDispatchAt,
  nowIso,
}: {
  initial: TodayView;
  timeZone: string;
  vapidPublicKey?: string;
  lastDispatchAt?: string | null;
  nowIso?: string;
}): React.JSX.Element {
  const [data, setData] = useState(initial);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  /**
   * Re-reads the day.
   *
   * Completing anything updates the ring and the next action without a
   * refresh: the whole point of the ring is the moment it fills, and a page
   * reload loses that and the scroll position with it.
   */
  const reload = useCallback(async () => {
    try {
      const response = await fetch('/api/today', { cache: 'no-store' });
      if (!response.ok) return;

      setData((await response.json()) as TodayView);
      // Never assume a 200 means fresh -- the worker serves from cache on the
      // same status, and stale deadlines shown as current is the one lie this
      // app must not tell.
      setCachedAt(
        response.headers.get('x-pact-stale') === 'true'
          ? (response.headers.get('x-pact-cached-at') ?? new Date().toISOString())
          : null,
      );
    } catch {
      setCachedAt((previous) => previous ?? new Date().toISOString());
    }
  }, []);

  /**
   * Re-read when the tab comes back.
   *
   * A focus session is a full-screen route: you leave Today, work for ninety
   * minutes, finish, and come back. Without this the ring would still show the
   * count from before the session until something else forced a fetch, and the
   * one moment the ring exists for -- the segment filling -- would be missed
   * entirely. It also covers a block finished on another device.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [reload]);

  const override = useCallback(
    async (commitmentId: string, stableKey: string | null) => {
      await fetch('/api/curriculum/today', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitmentId, stableKey }),
        cache: 'no-store',
      });
      await reload();
    },
    [reload],
  );

  const currentIndex = data.blocks.findIndex(
    (block) => block.state !== 'done' && block.state !== 'abandoned',
  );

  return (
    <div className="flex flex-col gap-2xl">
      <StalenessBanner cachedAt={cachedAt} onRetry={() => void reload()} />
      <DispatchHealthBanner
        lastDispatchAt={lastDispatchAt ?? null}
        now={nowIso ?? new Date().toISOString()}
      />

      <header className="pt-sm">
        <p className="text-text/40 text-sm">{data.dateLine}</p>
        <h1 className="mt-xs text-2xl leading-tight font-semibold tracking-tight text-balance">
          {data.greeting.line}
        </h1>
      </header>

      {/*
        An unanswered miss outranks everything. It is the first of the two
        signal uses on this page, drawn as a left rule rather than a filled
        card -- an annotation in the margin of a ledger, not an alert box.
      */}
      {data.needsReckoning.length > 0 ? (
        <section className="border-signal border-l-2 pl-md">
          <p className="text-signal text-base">
            {data.needsReckoning.length} deadline
            {data.needsReckoning.length === 1 ? '' : 's'} passed without an answer.
          </p>
          <ul className="mt-xs flex flex-col gap-2xs">
            {data.needsReckoning.slice(0, 3).map((commitment) => (
              <li key={commitment.id} className="text-text/60 text-sm">
                {commitment.title}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        Between the miss and the next action. It is context for the day, not
        the thing to do -- and it carries no accent, because a reward drawn in
        the attention colour is the first step back towards a badge.
      */}
      <StakesStatusLine stakes={data.stakes} />

      {data.next ? (
        <NextAction next={data.next} />
      ) : (
        <section className="border-edge bg-surface rounded-lg border p-lg">
          <p className="text-base">Nothing open. That is the whole list.</p>
        </section>
      )}

      {/* The plan: three blocks and the gauge that measures them. */}
      {data.blocks.length > 0 ? (
        <section className="flex flex-col gap-lg lg:flex-row lg:items-start lg:gap-2xl">
          <div className="lg:order-2 lg:w-64 lg:shrink-0">
            <BlockRing
              done={data.blocksDone}
              total={data.blocks.length}
              currentIndex={currentIndex}
              label={data.blocks.length === 3 ? 'blocks kept today' : undefined}
            />
          </div>

          <div className="min-w-0 flex-1 lg:order-1">
            <BlockLedger blocks={data.blocks} onOverride={(id, key) => void override(id, key)} />
          </div>
        </section>
      ) : data.noCurriculum ? (
        <p className="text-text/40 text-sm">No curriculum imported, so there are no blocks yet.</p>
      ) : null}

      {data.alsoToday.length > 0 ? (
        <section>
          <h2 className="text-text/40 mb-sm text-sm">also today</h2>
          <ul className="flex flex-col gap-sm">
            {data.alsoToday.map((commitment) => (
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

      <div className="border-edge flex flex-col gap-sm border-t pt-lg">
        {/*
          A count and a link, never a list. The list is paged and lives on its
          own page -- and past the thresholds it is not a list at all, it is
          recovery mode.
        */}
        {data.overdue.total > 0 ? (
          <Link href="/postponements" className="text-text/60 hover:text-text text-sm">
            <span className="figures">{data.overdue.total}</span> overdue,{' '}
            <span className="figures">{data.overdue.needsReckoning}</span> unanswered
          </Link>
        ) : null}

        {data.phase && data.drift ? (
          <p className="text-text/40 text-sm">
            Phase <span className="figures">{data.phase.number}</span> is{' '}
            <span className="figures">{Math.round(data.drift.elapsedFraction * 100)}%</span>{' '}
            elapsed, <span className="figures">{Math.round(data.drift.doneFraction * 100)}%</span>{' '}
            of its P0 topics done.
          </p>
        ) : null}
      </div>

      <NotificationPermission
        commitmentCount={data.blocks.length + data.alsoToday.length}
        vapidPublicKey={vapidPublicKey}
      />
      <PushReconciler publicKey={vapidPublicKey} />
      <InstallPrompt />
    </div>
  );
}
