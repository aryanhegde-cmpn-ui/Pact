import type { PriorityBand, TopicStatus } from '@/lib/schemas/curriculum';
import { daysBetween, type DateKey } from '@/lib/time';

/**
 * Schedule drift, derived.
 *
 * Pure -- no I/O, the date passed in -- like everything under src/lib/behavior.
 *
 * ---------------------------------------------------------------------------
 * THE PLAN HOLDS AND SHOWS THE GAP. IT NEVER RE-FLOWS.
 * ---------------------------------------------------------------------------
 * Nothing here writes anything. Falling behind does not move a phase's dates,
 * does not redistribute its topics, and does not shorten anything to make the
 * remaining time fit. It produces a number, and the number is allowed to be
 * bad.
 *
 * Silent re-flowing is the study-plan version of silently moving a deadline:
 * a five-month plan quietly becomes an eight-month one with no moment where
 * anybody noticed. Re-planning exists, it is explicit, and it records an event
 * with a reason -- see `src/lib/curriculum/replan.ts`.
 * ---------------------------------------------------------------------------
 *
 * Measured over P0 topics only. P0 is the workbook's own "must master" band,
 * and it is the only honest denominator: counting P2 Supporting rows would let
 * a Docker video paper over an unfinished event loop, and counting everything
 * would make the plan look worse than it is for a user who correctly skipped
 * the optional material.
 */

export interface DriftTopic {
  stableKey: string;
  priority: PriorityBand;
  category: string;
  module: string;
}

export interface PhaseWindow {
  number: number;
  startDate: DateKey;
  endDate: DateKey;
  focusCategories: readonly string[];
  focusModules: readonly string[];
}

export type DriftStatus = 'not-started' | 'ahead' | 'on-track' | 'behind';

export interface Drift {
  phaseNumber: number;
  /** How far through the phase's dates today is, 0 to 1. */
  elapsedFraction: number;
  /** How much of the phase's P0 material is done, 0 to 1. */
  doneFraction: number;
  /** done - elapsed. Negative is behind. */
  drift: number;
  status: DriftStatus;
  p0Total: number;
  p0Done: number;
  /**
   * P0 topics that would need to be done by now to be level.
   *
   * Rounded to a whole topic because a phrase like "2.4 topics behind" reads
   * as precision the number does not have.
   */
  topicsBehind: number;
  daysRemaining: number;
}

/**
 * The band either side of level within which the plan says nothing.
 *
 * A phase runs three to four weeks over a dozen or so P0 topics, so one topic
 * is roughly 8% of it. A tighter band would flag every ordinary Tuesday, and a
 * warning that fires constantly is one that gets ignored -- which costs more
 * than the warning was worth.
 */
export const DRIFT_TOLERANCE = 0.1;

/**
 * Topics a phase is actually about.
 *
 * A phase whose focus matched nothing gets NO topics, not all of them. The
 * last phase of the real plan is "Applications + interviews", which the
 * curriculum sheet does not itemise -- and measuring it against all 43
 * must-master topics would report the whole curriculum as outstanding in
 * January, which is both alarming and false. `computeDrift` says "nothing to
 * measure" instead, which is the true answer.
 */
export function topicsInPhase(
  topics: readonly DriftTopic[],
  phase: Pick<PhaseWindow, 'focusCategories' | 'focusModules'>,
): DriftTopic[] {
  if (phase.focusCategories.length === 0 && phase.focusModules.length === 0) return [];

  const has = (names: readonly string[], value: string) =>
    names.some((name) => name.toLowerCase() === value.toLowerCase());

  return topics.filter(
    (topic) => has(phase.focusCategories, topic.category) || has(phase.focusModules, topic.module),
  );
}

export function computeDrift(
  phase: PhaseWindow,
  topics: readonly DriftTopic[],
  progress: ReadonlyMap<string, TopicStatus>,
  today: DateKey,
): Drift {
  const inPhase = topicsInPhase(topics, phase).filter((topic) => topic.priority === 'P0');

  /**
   * Inclusive of both ends: a phase running the 1st to the 30th is thirty
   * days long, not twenty-nine. Off by one here would report a phase as 3%
   * behind on the morning it starts.
   */
  const totalDays = daysBetween(phase.startDate, phase.endDate) + 1;
  const elapsedDays = daysBetween(phase.startDate, today) + 1;

  const elapsedFraction = clamp(elapsedDays / totalDays);
  const daysRemaining = Math.max(0, daysBetween(today, phase.endDate));

  const p0Total = inPhase.length;
  /**
   * `needs-revision` does not count as done.
   *
   * It is the status that says a topic was finished badly, and counting it
   * would make the drift figure agree with the user's most optimistic reading
   * of their own progress -- which is the one thing this number exists to
   * contradict.
   */
  const p0Done = inPhase.filter(
    (topic) => (progress.get(topic.stableKey) ?? 'not-started') === 'done',
  ).length;

  const doneFraction = p0Total === 0 ? elapsedFraction : p0Done / p0Total;
  const drift = doneFraction - elapsedFraction;

  return {
    phaseNumber: phase.number,
    elapsedFraction,
    doneFraction,
    drift,
    status: statusOf(drift, elapsedDays),
    p0Total,
    p0Done,
    topicsBehind: Math.max(0, Math.ceil(-drift * p0Total)),
    daysRemaining,
  };
}

function statusOf(drift: number, elapsedDays: number): DriftStatus {
  // Before the phase begins there is nothing to be behind on, and reporting a
  // brand-new phase as 100% behind on its first morning is just wrong.
  if (elapsedDays <= 0) return 'not-started';
  if (drift > DRIFT_TOLERANCE) return 'ahead';
  if (drift < -DRIFT_TOLERANCE) return 'behind';

  return 'on-track';
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;

  return Math.min(1, Math.max(0, value));
}

/** The phase containing a date, or null when the date falls outside the plan. */
export function phaseOn<T extends { startDate: DateKey; endDate: DateKey }>(
  phases: readonly T[],
  date: DateKey,
): T | null {
  return phases.find((phase) => date >= phase.startDate && date <= phase.endDate) ?? null;
}
