import Link from 'next/link';

import type { NextAction as NextActionData } from '@/lib/today/service';

/**
 * The one thing to do next.
 *
 * The largest element on the page and the only place a button is drawn in
 * signal. Everything below it is set at body size or smaller on hairline
 * rules, so the ordering is carried by size and weight rather than by colour
 * or by boxes.
 *
 * The heading is split from its detail upstream. A plan-generated title runs to
 * 96 characters -- "Frontend Engineering: Interview Process · Clarify scope;
 * model data; components; services; performance; security; a11y" -- and set
 * whole at this size on a 390px screen that is five lines, at which point it
 * stops looking like one thing to do.
 */
export function NextAction({
  next,
  interactive = true,
}: {
  next: NextActionData;
  /** Tomorrow shows the same card without a Start button. */
  interactive?: boolean;
}): React.JSX.Element {
  return (
    <section
      className={[
        'bg-surface rounded-lg border p-lg sm:p-xl',
        next.needsReckoning ? 'border-signal/50' : 'border-edge',
      ].join(' ')}
    >
      {next.needsReckoning ? (
        <p className="text-signal mb-sm text-sm">This deadline passed and has no answer yet.</p>
      ) : null}

      <h2 className="text-2xl leading-tight font-semibold tracking-tight text-balance">
        {next.heading}
      </h2>
      {next.detail ? <p className="text-text/60 mt-xs text-base">{next.detail}</p> : null}

      <p className="mt-md text-base">{next.outcome}</p>

      <p className="figures text-text/40 mt-sm text-sm">
        {next.window ? `${next.window} · ` : ''}
        {next.estimateMinutes} min
      </p>

      {interactive ? (
        <Link
          href={
            next.needsReckoning
              ? `/dashboard?reckon=${next.commitmentId}`
              : `/focus/${next.commitmentId}`
          }
          className="border-signal text-signal hover:bg-signal hover:text-on-signal mt-lg flex min-h-14 w-full items-center justify-center rounded-md border text-base font-medium transition-colors sm:w-auto sm:px-2xl"
        >
          {next.needsReckoning ? 'Answer for it' : 'Start'}
        </Link>
      ) : null}
    </section>
  );
}
