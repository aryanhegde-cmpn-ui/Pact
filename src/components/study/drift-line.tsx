import type { Drift } from '@/lib/behavior/drift';

/**
 * The gap, stated plainly.
 *
 * No bar, no ring, no colour reward for being ahead. Being ahead gets the same
 * one line as being behind, because the point is the number rather than the
 * feeling about it -- and a visual treatment that celebrates one and scolds the
 * other is the beginning of a score.
 */
export function DriftLine({ drift }: { drift: Drift }): React.JSX.Element {
  const percent = (value: number) => `${Math.round(value * 100)}%`;

  if (drift.p0Total === 0) {
    return (
      <p className="text-text/50 text-sm">
        This phase itemises no must-master topics, so there is nothing to measure against.
      </p>
    );
  }

  return (
    <div className="text-sm">
      <p className={drift.status === 'behind' ? 'text-signal' : 'text-text/70'}>
        {drift.p0Done} of {drift.p0Total} must-master topics done · {percent(drift.elapsedFraction)}{' '}
        of the phase elapsed
      </p>
      <p className="text-text/50 mt-2xs text-xs">
        {drift.status === 'behind' &&
          `Behind by ${drift.topicsBehind} topic${drift.topicsBehind === 1 ? '' : 's'}. The plan holds; the dates have not moved.`}
        {drift.status === 'ahead' && 'Ahead of schedule.'}
        {drift.status === 'on-track' && 'On track.'}
        {drift.status === 'not-started' && 'Not started yet.'}
        {drift.daysRemaining > 0 && ` ${drift.daysRemaining} days left in this phase.`}
      </p>
    </div>
  );
}
