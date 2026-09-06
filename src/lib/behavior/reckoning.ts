import { isMissed, type MissInput } from '@/lib/behavior/miss';
import type { EventType } from '@/lib/schemas/event';
import type { DeadlineChangeCategory } from '@/lib/schemas/reckoning';
import { INTERVENTION_THRESHOLD } from '@/lib/schemas/reckoning';

/**
 * Needs-reckoning, derived.
 *
 * Consistent with miss detection: computed on read from the deadline, the
 * status and the event log, never stored. A stored flag would be wrong the
 * moment a deadline passed and stay wrong until something happened to touch
 * the row.
 *
 * Pure -- no I/O, `now` passed in -- like everything under src/lib/behavior.
 */

export interface ReckoningEvent {
  ts: Date;
  type: EventType;
  payload?: Record<string, unknown>;
}

/**
 * Whether this commitment's CURRENT deadline has been missed and not answered.
 *
 * Keyed on the deadline, not the commitment. A commitment missed on Monday,
 * reckoned, rescheduled to Friday and missed again needs reckoning a second
 * time -- the first answer was about a different deadline and does not
 * discharge the new one. `RECKONING_SUBMITTED` carries the missed deadline as
 * its `ts` for exactly this reason.
 */
export function needsReckoning(
  commitment: MissInput,
  events: readonly ReckoningEvent[],
  now: Date,
): boolean {
  if (!isMissed(commitment, now)) return false;

  return !hasReckonedDeadline(events, commitment.dueAt);
}

/** Whether a reckoning exists for one specific deadline instant. */
export function hasReckonedDeadline(events: readonly ReckoningEvent[], deadline: Date): boolean {
  return events.some(
    (event) => event.type === 'RECKONING_SUBMITTED' && event.ts.getTime() === deadline.getTime(),
  );
}

/** Every reckoning this commitment has produced, oldest first. */
export function reckoningCount(events: readonly ReckoningEvent[]): number {
  return events.filter((event) => event.type === 'RECKONING_SUBMITTED').length;
}

export interface PostponementSummary {
  /** How many times the deadline has moved. */
  changes: number;
  /** Total days added across every move, against the ORIGINAL deadline. */
  totalDaysPostponed: number;
  /** The category given most often. Null when there are no changes. */
  mostCommonCategory: DeadlineChangeCategory | null;
  /** Three or more changes: worth a conversation rather than another reschedule. */
  interventionCandidate: boolean;
}

/**
 * Summarises a commitment's deadline history.
 *
 * The number that matters is not "is this late" but "how many times has this
 * been moved, and what does the person say each time". Three identical
 * "underestimated" answers is a different problem from three different ones.
 */
export function summarisePostponements(
  events: readonly ReckoningEvent[],
  originalDueAt: Date,
  currentDueAt: Date,
): PostponementSummary {
  const changes = events.filter((event) => event.type === 'DEADLINE_CHANGED');

  const counts = new Map<DeadlineChangeCategory, number>();
  for (const change of changes) {
    const category = change.payload?.category as DeadlineChangeCategory | undefined;
    if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  let mostCommonCategory: DeadlineChangeCategory | null = null;
  let best = 0;
  for (const [category, count] of counts) {
    if (count > best) {
      best = count;
      mostCommonCategory = category;
    }
  }

  // Measured against the ORIGINAL deadline rather than summing each hop, so a
  // move forward and back does not read as two postponements' worth of drift.
  const totalDaysPostponed = Math.max(
    0,
    Math.round((currentDueAt.getTime() - originalDueAt.getTime()) / 86_400_000),
  );

  return {
    changes: changes.length,
    totalDaysPostponed,
    mostCommonCategory,
    interventionCandidate: changes.length >= INTERVENTION_THRESHOLD,
  };
}

/**
 * Adherence as a rolling rate over the last `window` resolved commitments.
 *
 * NOT a streak. A streak turns one missed day into a reason to stop opening
 * the app, and rewards avoiding hard commitments over keeping them. A rate
 * moves a little for one miss, a lot for a pattern, and recovers visibly as
 * the window advances. See CLAUDE.md.
 */
export function adherenceRate(
  resolved: readonly { onTime: boolean }[],
  window = 20,
): { kept: number; of: number; rate: number } {
  const recent = resolved.slice(-window);
  const kept = recent.filter((item) => item.onTime).length;

  return {
    kept,
    of: recent.length,
    rate: recent.length === 0 ? 1 : kept / recent.length,
  };
}
