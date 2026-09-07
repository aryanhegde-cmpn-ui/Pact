import Link from 'next/link';

import type { StakesState } from '@/lib/stakes/service';

/**
 * The primary's compact status line on Today.
 *
 * ---------------------------------------------------------------------------
 * A COLD SURFACE. NOTHING HERE CELEBRATES.
 * ---------------------------------------------------------------------------
 * No accent on a reward and no accent on a consequence. `signal` means "this
 * needs you", and neither of these does: a reward is a fact about what the
 * record says, and a consequence is a fact about what is currently withheld.
 * The thing that needs you today is the next action, which is already the
 * largest element on the page and already carries the only accent.
 *
 * Drawing a reward in a bright colour would also be the first step back
 * towards a badge, which is the one thing this whole arrangement exists
 * instead of.
 * ---------------------------------------------------------------------------
 */
export function StakesStatusLine({ stakes }: { stakes: StakesState }): React.JSX.Element | null {
  const parts: React.JSX.Element[] = [];

  if (stakes.onVacation) {
    parts.push(
      <span key="vacation">
        Vacation mode is on. Nothing is being evaluated, and these days are out of the adherence
        count rather than counted as missed.
      </span>,
    );
  }

  if (stakes.active) {
    parts.push(
      <span key="consequence">
        <span className="text-text">{stakes.active.name}</span> is active.
      </span>,
    );
  }

  if (stakes.claimable.length > 0) {
    parts.push(
      <span key="reward">
        <span className="text-text">{stakes.claimable[0]?.name}</span>
        {stakes.claimable.length > 1 ? ` and ${stakes.claimable.length - 1} more` : ''} earned.
      </span>,
    );
  }

  if (parts.length === 0) return null;

  return (
    <section className="border-edge border-l-2 pl-md">
      <p className="text-text/60 text-sm">
        {parts.map((part, index) => (
          <span key={index}>
            {index > 0 ? ' ' : ''}
            {part}
          </span>
        ))}{' '}
        <Link href="/stakes" className="hover:text-text underline">
          Details
        </Link>
      </p>
    </section>
  );
}
