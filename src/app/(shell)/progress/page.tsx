import { redirect } from 'next/navigation';

import { currentActor } from '@/lib/api/guard';
import { buildProgress, type ProgressView } from '@/lib/today/progress';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Progress' };

/**
 * The cold surface.
 *
 * Adherence as a rate over a window, block completion by day, topics by module,
 * estimate against actual, phase drift and reckoning reasons. All of it is
 * history, and none of it is on Today -- the first thing seen each morning
 * should not be a judgement of the last three weeks.
 *
 * There is no streak headline. The rate is the headline; the consecutive run
 * appears once, small, named as what it is, and gates nothing.
 */
export default async function ProgressPage(): Promise<React.JSX.Element> {
  const actor = await currentActor();
  if (!actor) redirect('/');

  const progress = await buildProgress(actor.ownerId);
  const percent = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <div className="flex flex-col gap-2xl">
      <header className="pt-sm">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight">Progress</h1>
      </header>

      {/* The headline. A rate, over a window, with the window named. */}
      <section>
        <p className="text-2xl leading-tight font-semibold tracking-tight">
          <span className="figures">{progress.window.kept}</span> of the last{' '}
          <span className="figures">{progress.window.of}</span> days with blocks, kept in full.
        </p>
        <p className="text-text/40 mt-xs text-sm">
          <span className="figures">{percent(progress.window.rate)}</span> over{' '}
          <span className="figures">{progress.window.days}</span> days. A day with nothing scheduled
          is not counted either way.
        </p>

        <DayStrip days={progress.days} />

        {/*
          Secondary, by name and by placement. A consecutive count has a cliff:
          miss one day at forty and it reads zero, which is a lie about
          adherence. It gates nothing here and must never become the headline.
        */}
        <p className="text-text/40 mt-md text-xs">
          Current unbroken run: <span className="figures">{progress.currentRun}</span>
        </p>
      </section>

      <section>
        <h2 className="text-text/40 mb-sm text-sm">estimate against actual</h2>
        {progress.estimateVsActual.ratio === null ? (
          <p className="text-text/50 text-sm">No finished sessions yet.</p>
        ) : (
          <>
            <p className="text-base">
              <span className="figures">{progress.estimateVsActual.actualMinutes}</span> minutes
              spent against{' '}
              <span className="figures">{progress.estimateVsActual.plannedMinutes}</span> estimated,
              over <span className="figures">{progress.estimateVsActual.sessions}</span> sessions.
            </p>
            <p className="text-text/40 mt-2xs text-sm">
              {progress.estimateVsActual.ratio > 1.1
                ? `Your estimates run ${percent(progress.estimateVsActual.ratio - 1)} short.`
                : progress.estimateVsActual.ratio < 0.9
                  ? `Your estimates run ${percent(1 - progress.estimateVsActual.ratio)} long.`
                  : 'Your estimates are about right.'}
            </p>
          </>
        )}

        {progress.timeByKind.length > 0 ? (
          <ul className="border-edge mt-md border-t">
            {progress.timeByKind.map((entry) => (
              <li key={entry.kind} className="border-edge flex justify-between border-b py-sm">
                <span className="text-sm">{entry.kind}</span>
                <span className="figures text-text/60 text-sm">{entry.minutes} min</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <h2 className="text-text/40 mb-sm text-sm">topics by module</h2>
        <ul className="border-edge border-t">
          {progress.topicsByModule.map((entry) => (
            <li
              key={`${entry.category}/${entry.module}`}
              className="border-edge flex items-baseline gap-md border-b py-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm">{entry.module}</p>
                <p className="text-text/40 text-xs">{entry.category}</p>
              </div>
              <span className="figures text-text/60 shrink-0 text-sm">
                {entry.done}/{entry.total}
              </span>
              {entry.needsRevision > 0 ? (
                <span className="figures text-text/40 shrink-0 text-xs">
                  {entry.needsRevision} weak
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-text/40 mb-sm text-sm">phase drift</h2>
        <ul className="border-edge border-t">
          {progress.phases.map((phase) => (
            <li
              key={phase.number}
              className="border-edge flex items-baseline gap-md border-b py-sm"
            >
              <span className="figures text-text/40 w-16 shrink-0 text-sm">
                Phase {phase.number}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="figures">{percent(phase.elapsed)}</span> elapsed,{' '}
                <span className="figures">{percent(phase.done)}</span> done
              </span>
              <span
                className={[
                  'shrink-0 text-sm',
                  phase.status === 'behind' ? 'text-signal' : 'text-text/40',
                ].join(' ')}
              >
                {phase.status}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-text/40 mb-sm text-sm">why deadlines were missed</h2>
        {progress.reckoningReasons.length === 0 ? (
          <p className="text-text/50 text-sm">No reckonings recorded.</p>
        ) : (
          <ul className="border-edge border-t">
            {progress.reckoningReasons.map((entry) => (
              <li key={entry.reason} className="border-edge flex justify-between border-b py-sm">
                <span className="min-w-0 flex-1 text-sm">{entry.label}</span>
                <span className="figures text-text/60 shrink-0 text-sm">{entry.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Twenty-one days, one mark each.
 *
 * A strip rather than a chart: the question is "which days did I keep", and a
 * line chart of a binary answers it worse than twenty-one marks in a row.
 */
function DayStrip({ days }: { days: ProgressView['days'] }): React.JSX.Element {
  return (
    <div className="mt-md flex gap-2xs" aria-hidden="true">
      {days.map((day) => (
        <span
          key={day.date}
          title={`${day.date}: ${day.blocksDone} of ${day.blocksTotal}`}
          className={[
            'h-8 flex-1 rounded-sm',
            day.blocksTotal === 0
              ? 'border-edge border'
              : day.kept
                ? 'bg-text'
                : day.blocksDone > 0
                  ? 'bg-text/40'
                  : 'bg-edge',
          ].join(' ')}
        />
      ))}
    </div>
  );
}
