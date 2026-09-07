'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AnimatePresence, m } from 'motion/react';

import { useAnnounce } from '@/components/a11y/announcer';
import { CommitmentRow } from '@/components/commitments/commitment-row';
import { CreateCommitmentForm } from '@/components/commitments/create-form';
import { MotionProvider } from '@/components/motion/motion-provider';
import { useTransition } from '@/components/motion/transitions';
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
 *
 * ---------------------------------------------------------------------------
 * WHERE THE MOTION IS, AND WHERE IT DELIBERATELY IS NOT
 * ---------------------------------------------------------------------------
 * Rows leaving the list when they are completed, and the miss block appearing
 * above everything when a deadline passes. Both answer "what just moved and
 * where did it come from" -- without them, completing something makes the rest
 * of the list teleport upward and you lose your place.
 *
 * There is NO staggered entrance on load. It is fashionable, it adds perceived
 * latency to the screen opened most often, and it animates nothing that
 * changed. There is no completion flourish either: the row leaving IS the
 * feedback, and anything on top of it would be a reward for completing.
 * ---------------------------------------------------------------------------
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

  const transition = useTransition('state');
  const announce = useAnnounce();

  /**
   * Says what changed, for anyone who cannot see it change.
   *
   * The ring filling and the row leaving are the sighted feedback; without
   * this, completing something is silent and the page simply differs. Compared
   * against the previous read rather than fired from the click, so it also
   * covers a block finished in another tab.
   */
  const previousDone = useRef(initial.blocksDone);
  useEffect(() => {
    if (data.blocksDone === previousDone.current) return;

    if (data.blocksDone > previousDone.current) {
      announce(`Block complete. ${data.blocksDone} of ${data.blocks.length} blocks kept today.`);
    }
    previousDone.current = data.blocksDone;
  }, [announce, data.blocks.length, data.blocksDone]);

  /**
   * Open and done, split here rather than on the server.
   *
   * `alsoToday` is everything due today, completed included -- which is right
   * for the record but wrong for the list: a finished commitment sitting among
   * the unfinished ones is noise, and it also meant completing something
   * changed a row's appearance rather than removing it. The exit animation had
   * nothing to animate.
   *
   * Done rows are still shown, below, because what you finished today is worth
   * seeing. They simply stop being work.
   */
  const openToday = data.alsoToday.filter(
    (commitment) => commitment.status !== 'done' && commitment.status !== 'abandoned',
  );
  const doneToday = data.alsoToday.filter(
    (commitment) => commitment.status === 'done' || commitment.status === 'abandoned',
  );

  const currentIndex = data.blocks.findIndex(
    (block) => block.state !== 'done' && block.state !== 'abandoned',
  );

  return (
    <MotionProvider>
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
        <AnimatePresence initial={false}>
          {data.needsReckoning.length > 0 ? (
            <m.section
              key="needs-reckoning"
              // It arrives at the top of the page when a deadline passes. Without
              // the height transition everything below it jumps.
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={transition}
              className="border-signal overflow-hidden border-l-2 pl-md"
            >
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
            </m.section>
          ) : null}
        </AnimatePresence>

        {/*
        DESKTOP IS NOT A STRETCHED PHONE.
        ---------------------------------------------------------------------
        Above 1024 the primary column keeps the two things the day is actually
        about -- the next action and the three blocks -- and everything that is
        context moves BESIDE rather than below: the ring, the stakes line, the
        overdue count, the drift.

        Below 1024 the same elements stack in reading order, which is the order
        they matter in. Nothing is hidden at any width; the arrangement changes,
        the content does not.
      */}
        <div className="flex flex-col gap-2xl lg:flex-row lg:items-start lg:gap-2xl">
          <div className="flex min-w-0 flex-1 flex-col gap-2xl">
            {data.next ? (
              <NextAction next={data.next} />
            ) : (
              <section className="border-edge bg-surface rounded-lg border p-lg">
                <p className="text-base">Nothing open. That is the whole list.</p>
              </section>
            )}

            {data.blocks.length > 0 ? (
              <BlockLedger blocks={data.blocks} onOverride={(id, key) => void override(id, key)} />
            ) : data.noCurriculum ? (
              <p className="text-text/40 text-sm">
                No curriculum imported, so there are no blocks yet.
              </p>
            ) : null}

            {/*
              The section stays mounted even when empty.
              -------------------------------------------------------------
              `AnimatePresence` can only animate a child out if it is still
              rendered itself. Wrapping it in `length > 0` meant completing the
              LAST commitment unmounted the section, the presence context and
              the exiting row in the same tick -- so the one case where the
              animation matters most was the one case it never ran.
            */}
            <section aria-label="Other commitments due today">
              {openToday.length > 0 ? (
                <h2 className="text-text/40 mb-sm text-sm">also today</h2>
              ) : null}

              <ul className="flex flex-col gap-sm">
                {/*
                  The row animates its OWN exit -- see `CommitmentRow`. It used
                  to be wrapped in an `m.div` here, which put a div between a
                  `ul` and its `li` and silently never animated, and carried a
                  `layout` prop that `domAnimation` does not implement.
                */}
                <AnimatePresence initial={false}>
                  {openToday.map((commitment) => (
                    <CommitmentRow
                      key={commitment.id}
                      commitment={commitment}
                      timeZone={timeZone}
                      onChanged={() => void reload()}
                    />
                  ))}
                </AnimatePresence>
              </ul>

              {doneToday.length > 0 ? (
                <>
                  <h2 className="text-text/40 mt-lg mb-sm text-sm">done today</h2>
                  <ul className="flex flex-col gap-sm">
                    {doneToday.map((commitment) => (
                      <CommitmentRow
                        key={commitment.id}
                        commitment={commitment}
                        timeZone={timeZone}
                        onChanged={() => void reload()}
                      />
                    ))}
                  </ul>
                </>
              ) : null}
            </section>

            {/*
              CREATING A COMMITMENT LIVES HERE.
              -------------------------------------------------------------
              It had no mount point at all for a release: the form was rendered
              by the old commitment list, and deleting that list -- correctly,
              since Today replaced it -- took the only way of creating a
              commitment with it. Nothing failed, because nothing calls it; the
              app simply had no path to a manual commitment.

              Last on the page deliberately. Today is for executing what is
              already committed to, and a create form above the work turns the
              first screen of the morning into a planning surface.
            */}
            <CreateCommitmentForm timeZone={timeZone} onCreated={() => void reload()} />
          </div>

          {/* The secondary column. Beside on a laptop, above the ledger on a
            phone -- the ring is the day's summary and belongs near the top
            when there is only one column. */}
          <aside className="order-first flex flex-col gap-lg lg:order-none lg:w-72 lg:shrink-0">
            {data.blocks.length > 0 ? (
              <BlockRing
                done={data.blocksDone}
                total={data.blocks.length}
                currentIndex={currentIndex}
                label={data.blocks.length === 3 ? 'blocks kept today' : undefined}
              />
            ) : null}

            {/*
            Context for the day, not the thing to do -- and it carries no
            accent, because a reward drawn in the attention colour is the first
            step back towards a badge.
          */}
            <StakesStatusLine stakes={data.stakes} />
          </aside>
        </div>

        <div className="border-edge flex flex-col gap-sm border-t pt-lg">
          {/*
          A count and a link, never a list. The list is paged and lives on its
          own page -- and past the thresholds it is not a list at all, it is
          recovery mode.
        */}
          {data.overdue.total > 0 ? (
            <Link
              href="/postponements"
              className="text-text/60 hover:text-text inline-flex min-h-11 items-center text-sm"
            >
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
    </MotionProvider>
  );
}
