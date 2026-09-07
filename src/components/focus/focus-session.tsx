'use client';

import { m } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { MotionProvider } from '@/components/motion/motion-provider';
import { useTransition } from '@/components/motion/transitions';

import type { ActiveSession } from '@/lib/focus/service';
import {
  BLOCKER_KIND_LABELS,
  blockerKindSchema,
  SESSION_KIND_HELP,
  SESSION_KIND_LABELS,
  sessionKindSchema,
  type BlockerKind,
  type SessionKind,
} from '@/lib/schemas/focus';

/**
 * The session screen.
 *
 * The commitment, its outcome, the topic, the estimate, and a timer. Nothing
 * else — no navigation, no lists, no badges. A screen with somewhere to go is
 * a screen you go from.
 */

/**
 * The timer.
 *
 * ---------------------------------------------------------------------------
 * IT DOES NOT COUNT. IT COMPUTES.
 * ---------------------------------------------------------------------------
 * Every tick works out `now - startedAt` from scratch, using an offset
 * measured against the server's clock once when the session loaded. It never
 * accumulates, so a tick that does not fire costs nothing.
 *
 * That is the whole design. A study block is 60 to 90 minutes with the phone
 * locked, and a backgrounded tab has its timers throttled to once a minute or
 * stopped outright — an accumulating counter would report ninety minutes as
 * eleven and nothing on screen would look wrong. The server recomputes it
 * again at the end anyway, so this display can never disagree with the record
 * for long.
 * ---------------------------------------------------------------------------
 */
function useElapsed(session: ActiveSession): number {
  const started = new Date(session.startedAt).getTime();

  /**
   * The gap between this browser's clock and the server's, measured once from
   * the `serverNow` that came back with the session.
   *
   * A phone whose clock is three minutes fast would otherwise show three
   * minutes of work that never happened -- and the number on screen has to
   * agree with the one the server writes at the end.
   */
  const [skew] = useState(() => new Date(session.serverNow).getTime() - Date.now());

  const compute = useCallback(
    () => Math.max(0, Math.floor((Date.now() + skew - started) / 1000)),
    [skew, started],
  );

  const [elapsed, setElapsed] = useState(compute);

  useEffect(() => {
    const tick = () => setElapsed(compute());
    const id = window.setInterval(tick, 1_000);

    // Recomputed the moment the tab comes back, so a throttled interval never
    // leaves a stale number on screen.
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);

    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [compute]);

  return elapsed;
}

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

type Exit = 'done' | 'more-time' | 'blocked' | null;

export function FocusSession({ initial }: { initial: ActiveSession }): React.JSX.Element {
  const router = useRouter();
  const [session, setSession] = useState(initial);
  const [exit, setExit] = useState<Exit>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState<string | null>(null);
  const elapsed = useElapsed(session);
  /**
   * Entering a session is a mode change: the app stops being a list and
   * becomes one screen with one thing on it. A crossfade says that happened on
   * purpose. There is no exit animation -- the App Router has no built-in one
   * for route changes, and fighting it would cost more than a cut is worth.
   */
  const transition = useTransition('mode');

  const budgetSeconds = session.researchBudgetMinutes
    ? session.researchBudgetMinutes * 60 - elapsed
    : null;
  const budgetSpent = budgetSeconds !== null && budgetSeconds <= 0;

  async function post(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        setError((payload.error as string) ?? 'That did not save.');
        return null;
      }

      return payload;
    } catch {
      setError('That did not save. You are probably offline.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function end(body: Record<string, unknown>) {
    const result = await post('/api/focus/end', body);
    if (!result) return;

    setFinished(result.effect as string);
    // Back to today. Refreshed, because the commitment just changed.
    router.refresh();
  }

  if (finished) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[36rem] flex-col justify-center gap-lg p-lg sm:p-2xl">
        <p className="text-lg">{finished}</p>
        <button
          type="button"
          onClick={() => router.push('/study')}
          className="border-edge hover:border-signal min-h-11 rounded border px-md text-sm transition-colors"
        >
          Back to today
        </button>
      </main>
    );
  }

  return (
    <MotionProvider>
      <m.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transition}
        className="mx-auto flex min-h-dvh w-full max-w-[36rem] flex-col justify-center gap-xl p-lg sm:max-w-[42rem] sm:p-2xl"
      >
        {/* No nav, no back button, no badges. Leaving is the confirm below. */}
        <header>
          <p className="text-text/40 text-xs uppercase tracking-wide">
            {SESSION_KIND_LABELS[session.kind]}
          </p>
          <h1 className="mt-2xs text-xl font-semibold tracking-tight">
            {session.commitment.title}
          </h1>
          <p className="text-text/60 mt-xs text-sm">{session.commitment.outcome}</p>

          {session.topicLabel ? (
            <p className="text-text/50 mt-xs text-sm">
              {session.topicLabel}
              {session.topicTargetLabel ? (
                <span className="text-text/40"> · {session.topicTargetLabel}</span>
              ) : null}
            </p>
          ) : null}

          <p className="text-text/40 mt-xs text-xs">
            Estimated {session.plannedMinutes ?? session.commitment.estimateMinutes} minutes.
          </p>
        </header>

        <div className="flex flex-col items-center gap-xs py-xl">
          <p className="figures-display sm:text-[5rem]">{clock(elapsed)}</p>
          {session.interruptionCount > 0 ? (
            <p className="text-text/40 text-xs">
              {session.interruptionCount} interruption{session.interruptionCount === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>

        {error ? <p className="text-signal text-sm">{error}</p> : null}

        {/*
        The research budget's ONE interruption. Shown when the budget is spent
        and not yet answered, and never again after. A budget that nags gets
        dismissed reflexively, and then it is noise rather than a decision.
      */}
        {budgetSpent && !session.budgetWarned ? (
          <BudgetInterrupt
            busy={busy}
            onDecide={async (body) => {
              const result = await post('/api/focus/budget', body);
              if (result?.session) setSession(result.session as ActiveSession);
            }}
          />
        ) : null}

        {exit === null ? (
          <div className="flex flex-col gap-sm">
            <button
              type="button"
              onClick={() => setExit('done')}
              className="border-edge hover:border-signal min-h-11 rounded border px-md text-sm transition-colors"
            >
              Done
            </button>
            <button
              type="button"
              onClick={() => setExit('more-time')}
              className="border-edge hover:border-signal min-h-11 rounded border px-md text-sm transition-colors"
            >
              Need more time
            </button>
            <button
              type="button"
              onClick={() => setExit('blocked')}
              className="border-edge hover:border-signal min-h-11 rounded border px-md text-sm transition-colors"
            >
              Blocked
            </button>

            <KindSwitch
              current={session.kind}
              busy={busy}
              onChange={async (kind) => {
                // Only ever downward in flattery: switching TO execution is the
                // budget decision, and switching away from it is the honest one.
                const result = await post('/api/focus/budget', { decision: 'execute' });
                if (result?.session) setSession(result.session as ActiveSession);
                void kind;
              }}
            />

            <button
              type="button"
              onClick={async () => {
                if (!window.confirm('Leave the session? It keeps running.')) return;
                await post('/api/focus/interrupt', {});
                router.push('/study');
              }}
              className="text-text/40 hover:text-signal mt-lg min-h-11 text-xs underline"
            >
              Leave without ending it
            </button>
          </div>
        ) : (
          <ExitForm
            exit={exit}
            session={session}
            busy={busy}
            onCancel={() => setExit(null)}
            onSubmit={end}
          />
        )}
      </m.main>
    </MotionProvider>
  );
}

/**
 * Changing the kind mid-session.
 *
 * Only shown for a research session, and only offers "I'm building now" —
 * which is the direction that makes the planning ratio less flattering, not
 * more. There is deliberately no way to reclassify execution as research after
 * the fact.
 */
function KindSwitch({
  current,
  busy,
  onChange,
}: {
  current: SessionKind;
  busy: boolean;
  onChange: (kind: SessionKind) => void;
}): React.JSX.Element | null {
  if (current === 'execution') return null;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onChange('execution')}
      className="border-edge hover:border-signal mt-md min-h-11 rounded border px-md text-xs transition-colors"
    >
      I&apos;m building now — switch to {SESSION_KIND_LABELS.execution.toLowerCase()}
    </button>
  );
}

function BudgetInterrupt({
  busy,
  onDecide,
}: {
  busy: boolean;
  onDecide: (body: Record<string, unknown>) => void;
}): React.JSX.Element {
  const [extending, setExtending] = useState(false);

  return (
    <section className="border-signal bg-surface rounded-lg border p-md">
      <p className="text-sm">Research budget spent. Decide or start building.</p>

      {extending ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onDecide({
              decision: 'extend',
              justification: String(data.get('justification') ?? ''),
              extraMinutes: Number(data.get('extraMinutes') ?? 15),
            });
          }}
          className="mt-sm flex flex-col gap-sm"
        >
          {/*
            Required. Extending without saying why is how a research budget
            becomes a number that is always extended, which is the same as not
            having one.
          */}
          <input
            name="justification"
            required
            placeholder="What specifically are you still looking for?"
            className="border-edge bg-ground min-h-11 rounded border px-sm text-sm"
          />
          <label className="flex flex-col gap-2xs">
            <span className="text-text/50 text-xs">More minutes</span>
            <input
              name="extraMinutes"
              type="number"
              min={1}
              max={120}
              defaultValue={15}
              className="border-edge bg-ground min-h-11 w-24 rounded border px-sm text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="border-edge min-h-11 rounded border px-md text-sm"
          >
            Extend
          </button>
        </form>
      ) : (
        <div className="mt-sm flex flex-wrap gap-sm">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide({ decision: 'execute' })}
            className="border-signal text-signal min-h-11 rounded border px-md text-sm"
          >
            Start executing
          </button>
          <button
            type="button"
            onClick={() => setExtending(true)}
            className="border-edge min-h-11 rounded border px-md text-sm"
          >
            Extend
          </button>
        </div>
      )}
    </section>
  );
}

function ExitForm({
  exit,
  session,
  busy,
  onCancel,
  onSubmit,
}: {
  exit: Exclude<Exit, null>;
  session: ActiveSession;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}): React.JSX.Element {
  const [blockerKind, setBlockerKind] = useState<BlockerKind>('person');

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);

        if (exit === 'done') {
          const problems = String(data.get('problemsSolved') ?? '').trim();
          onSubmit({
            outcome: 'done',
            note: String(data.get('note') ?? ''),
            ...(session.topicKey
              ? {
                  topicProgress: {
                    ...(problems === '' ? {} : { problemsSolved: Number(problems) }),
                    ...(session.topicTargetKind === 'build'
                      ? { buildFinished: data.get('buildFinished') === 'on' }
                      : {}),
                    needsRevision: data.get('needsRevision') === 'on',
                  },
                }
              : {}),
          });
        } else if (exit === 'more-time') {
          onSubmit({
            outcome: 'more-time',
            revisedEstimateMinutes: Number(data.get('revisedEstimateMinutes') ?? 30),
            note: String(data.get('note') ?? '') || undefined,
          });
        } else {
          onSubmit({
            outcome: 'blocked',
            blockerKind,
            blocker: String(data.get('blocker') ?? ''),
            createFollowUp: data.get('createFollowUp') === 'on',
            followUpAt: data.get('followUpAt')
              ? new Date(String(data.get('followUpAt'))).toISOString()
              : undefined,
          });
        }
      }}
      className="flex flex-col gap-sm"
    >
      {exit === 'done' ? (
        <>
          <label className="flex flex-col gap-2xs">
            <span className="text-text/50 text-xs">What changed?</span>
            <input
              name="note"
              required
              placeholder="One line. This is what separates finished from ticked off."
              className="border-edge bg-ground min-h-11 rounded border px-sm text-sm"
            />
          </label>

          {/*
            The block's session records progress against the TOPIC's target.
            That is the reason the block is the commitment and the topic is the
            content — without this, finishing a block says nothing about the
            material.
          */}
          {session.topicKey ? (
            <>
              <p className="text-text/40 text-xs">
                Against: {session.topicTargetLabel ?? session.topicLabel}
              </p>

              {session.topicTargetKind === 'problems' ? (
                <label className="flex flex-col gap-2xs">
                  <span className="text-text/50 text-xs">Problems solved</span>
                  <input
                    name="problemsSolved"
                    type="number"
                    min={0}
                    className="border-edge bg-ground min-h-11 w-24 rounded border px-sm text-sm"
                  />
                </label>
              ) : null}

              {session.topicTargetKind === 'build' ? (
                <label className="flex items-center gap-xs text-sm">
                  <input name="buildFinished" type="checkbox" className="size-4" />
                  The build is finished
                </label>
              ) : null}

              <label className="flex items-center gap-xs text-sm">
                <input name="needsRevision" type="checkbox" className="size-4" />
                Mark it needs revision — finished, but shakily
              </label>
            </>
          ) : null}
        </>
      ) : null}

      {exit === 'more-time' ? (
        <>
          {/* Not a failure. Not in the copy, not in adherence, not anywhere. */}
          <p className="text-text/60 text-sm">
            Work happened and it is not finished. That is information, not a miss.
          </p>
          <label className="flex flex-col gap-2xs">
            <span className="text-text/50 text-xs">
              How many more minutes, now that you have seen it?
            </span>
            <input
              name="revisedEstimateMinutes"
              type="number"
              min={1}
              required
              defaultValue={session.plannedMinutes ?? 30}
              className="border-edge bg-ground min-h-11 w-28 rounded border px-sm text-sm"
            />
          </label>
          <input
            name="note"
            placeholder="Anything worth remembering? Optional."
            className="border-edge bg-ground min-h-11 rounded border px-sm text-sm"
          />
        </>
      ) : null}

      {exit === 'blocked' ? (
        <>
          <label className="flex flex-col gap-2xs">
            <span className="text-text/50 text-xs">What kind of block?</span>
            <select
              name="blockerKind"
              value={blockerKind}
              onChange={(event) => setBlockerKind(event.target.value as BlockerKind)}
              className="border-edge bg-ground min-h-11 rounded border px-sm text-sm"
            >
              {blockerKindSchema.options.map((option) => (
                <option key={option} value={option}>
                  {BLOCKER_KIND_LABELS[option]}
                </option>
              ))}
            </select>
          </label>

          <input
            name="blocker"
            required
            placeholder={blockerKind === 'person' ? 'Who?' : 'What is missing?'}
            className="border-edge bg-ground min-h-11 rounded border px-sm text-sm"
          />

          {/*
            "Waiting on someone" with no date attached is how a commitment sits
            blocked for a month with nobody having chased anything.
          */}
          {blockerKind === 'person' ? (
            <>
              <label className="flex items-center gap-xs text-sm">
                <input name="createFollowUp" type="checkbox" defaultChecked className="size-4" />
                Create a commitment to chase them
              </label>
              <label className="flex flex-col gap-2xs">
                <span className="text-text/50 text-xs">When</span>
                <input
                  name="followUpAt"
                  type="datetime-local"
                  className="border-edge bg-ground min-h-11 rounded border px-sm text-sm"
                />
              </label>
            </>
          ) : null}
        </>
      ) : null}

      <div className="mt-sm flex gap-sm">
        <button
          type="submit"
          disabled={busy}
          className="border-signal text-signal min-h-11 rounded border px-md text-sm"
        >
          {exit === 'done' ? 'Finish' : exit === 'more-time' ? 'Log the time' : 'Record the block'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border-edge min-h-11 rounded border px-md text-sm"
        >
          Keep going
        </button>
      </div>
    </form>
  );
}

/** The kinds, for the start screen. Execution is the default and stays first. */
export const SESSION_KINDS = sessionKindSchema.options.map((kind) => ({
  kind,
  label: SESSION_KIND_LABELS[kind],
  help: SESSION_KIND_HELP[kind],
}));
