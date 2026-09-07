import type {
  ConsequenceStatus,
  DischargeCondition,
  RewardStatus,
  TriggerConfig,
  TriggerKind,
} from '@/lib/schemas/stakes';
import type { DateKey } from '@/lib/time';

/**
 * Deciding what the stakes should do.
 *
 * Pure -- no I/O, the clock passed in -- like everything under
 * `src/lib/behavior`. The service applies these decisions; this module makes
 * them, so every rule below can be tested without a database and without a
 * second account.
 */

// --- Adherence --------------------------------------------------------------

export interface DayRecord {
  date: DateKey;
  blocksDone: number;
  blocksTotal: number;
  /** Inside a vacation period. Excluded from the denominator entirely. */
  onVacation: boolean;
}

export interface AdherenceWindow {
  kept: number;
  /** Days that COUNT: had blocks, and were not on vacation. */
  of: number;
  rate: number;
  /** Excluded because they were paused. Reported so the exclusion is visible. */
  vacationDays: number;
  /** Not enough evidence to act on. No trigger fires against this. */
  sparse: boolean;
}

/**
 * The fewest counting days a threshold may be evaluated against.
 *
 * Below this the rate is noise: one kept day out of one is a rate of 1.0 and
 * would earn a reward, and one missed day out of one is 0.0 and would fire a
 * consequence. Real-world stakes should not turn on a single Tuesday.
 */
export const MINIMUM_WINDOW_DAYS = 5;

/**
 * Adherence over the window.
 *
 * A rate, never a run. Vacation days leave the denominator rather than
 * entering it as misses -- the difference between a pause and a lie -- and a
 * day with nothing scheduled is not a kept day either, or an empty week would
 * read as perfect adherence.
 */
export function adherenceOver(days: readonly DayRecord[]): AdherenceWindow {
  const vacationDays = days.filter((day) => day.onVacation).length;
  const counting = days.filter((day) => !day.onVacation && day.blocksTotal > 0);
  const kept = counting.filter((day) => day.blocksDone >= day.blocksTotal).length;

  return {
    kept,
    of: counting.length,
    rate: counting.length === 0 ? 0 : kept / counting.length,
    vacationDays,
    sparse: counting.length < MINIMUM_WINDOW_DAYS,
  };
}

// --- Triggers ---------------------------------------------------------------

export interface StakeRule {
  id: string;
  name: string;
  trigger: TriggerKind;
  triggerConfig: TriggerConfig;
}

export interface EvaluationInput {
  adherence: AdherenceWindow;
  /** P0 topics finished, for milestone triggers. */
  topicsDone: number;
  /** True while a vacation period is open. */
  onVacation: boolean;
}

/**
 * Whether a reward's condition is met.
 *
 * `manual-grant` never fires here: it is the Overseer's decision with no rule,
 * so evaluation must not be able to award it on their behalf.
 */
export function rewardIsEarned(rule: StakeRule, input: EvaluationInput): boolean {
  if (input.onVacation) return false;

  switch (rule.trigger) {
    case 'adherence-threshold': {
      const threshold = rule.triggerConfig.thresholdRate;
      if (threshold === undefined || input.adherence.sparse) return false;

      return input.adherence.rate >= threshold;
    }
    case 'milestone':
      return input.topicsDone >= (rule.triggerConfig.topicsDone ?? Infinity);
    case 'manual-grant':
      return false;
  }
}

/** Whether a consequence's condition is met. The mirror of the above. */
export function consequenceIsTriggered(rule: StakeRule, input: EvaluationInput): boolean {
  /**
   * VACATION STOPS EVALUATION.
   *
   * Not "fires but is suppressed" -- nothing is evaluated at all, so a pause
   * cannot silently accumulate a debt that lands the moment it ends.
   */
  if (input.onVacation) return false;

  switch (rule.trigger) {
    case 'adherence-threshold': {
      const threshold = rule.triggerConfig.thresholdRate;
      if (threshold === undefined || input.adherence.sparse) return false;

      return input.adherence.rate < threshold;
    }
    case 'milestone':
      // A milestone consequence fires when the milestone has NOT been reached
      // by the time it is evaluated. Same shape as adherence: below the line.
      return input.topicsDone < (rule.triggerConfig.topicsDone ?? 0);
    case 'manual-grant':
      // Excluded by the schema. Belt and braces: nobody gets a consequence
      // because someone clicked a button.
      return false;
  }
}

// --- Discharge --------------------------------------------------------------

export interface DischargeInput {
  adherence: AdherenceWindow;
  topicsDone: number;
  /** Whether the commitment named by a `commitment-resolved` condition is closed. */
  triggeringCommitmentResolved: boolean;
}

/**
 * Whether an active consequence's discharge condition is satisfied.
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO "DISMISSED" BRANCH, AND THERE MUST NOT BE.
 * ---------------------------------------------------------------------------
 * Every branch here is the work being put right. That is the entire mechanism:
 * a consequence with a dismiss button is a notification, and a notification is
 * the thing the user learns to close without reading.
 *
 * Note that vacation is absent too. Turning it on while a consequence is
 * active pauses further evaluation but cannot satisfy any of these, because
 * none of them is about time passing.
 * ---------------------------------------------------------------------------
 */
export function isDischarged(condition: DischargeCondition, input: DischargeInput): boolean {
  switch (condition.kind) {
    case 'adherence-recovered': {
      const threshold = condition.thresholdRate;
      if (threshold === undefined || input.adherence.sparse) return false;

      return input.adherence.rate >= threshold;
    }
    case 'commitment-resolved':
      return input.triggeringCommitmentResolved;
    case 'milestone-reached':
      return input.topicsDone >= (condition.topicsDone ?? Infinity);
  }
}

/** Whether an active consequence has run past its window. Independent of discharge. */
export function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && now.getTime() >= expiresAt.getTime();
}

/**
 * When a consequence activated now would end.
 *
 * Capped by the schema at config time, so this cannot produce a date beyond the
 * maximum window even if a stored row somehow held a larger number.
 */
export function expiryFor(now: Date, windowDays: number, maximum: number): Date {
  return new Date(now.getTime() + Math.min(windowDays, maximum) * 86_400_000);
}

// --- The decision -----------------------------------------------------------

export type StakeDecision =
  | { kind: 'earn-reward'; id: string; reason: string }
  | { kind: 'activate-consequence'; id: string; reason: string }
  | { kind: 'suppress-consequence'; id: string; reason: string }
  | { kind: 'discharge-consequence'; id: string; reason: string }
  | { kind: 'expire-consequence'; id: string; reason: string };

export interface ActiveConsequence {
  id: string;
  name: string;
  dischargeCondition: DischargeCondition;
  expiresAt: Date | null;
}

export interface EvaluateAllInput extends EvaluationInput {
  rewards: (StakeRule & { status: RewardStatus })[];
  consequences: (StakeRule & { status: ConsequenceStatus })[];
  active: ActiveConsequence | null;
  discharge: DischargeInput;
  now: Date;
}

/**
 * Everything that should happen, in one pass.
 *
 * Returned as decisions rather than applied, so the ordering is visible and
 * testable: an active consequence is discharged or expired BEFORE any new one
 * is considered, which is what lets a good day end today's consequence and a
 * bad one start tomorrow's rather than both at once.
 */
export function evaluateStakes(input: EvaluateAllInput): StakeDecision[] {
  const decisions: StakeDecision[] = [];

  /**
   * Vacation stops evaluation, but not the clock on an existing consequence.
   *
   * An active consequence still expires while paused -- pausing expectations
   * must not extend a penalty already running.
   */
  let slotIsFree = input.active === null;

  if (input.active) {
    if (isExpired(input.active.expiresAt, input.now)) {
      decisions.push({
        kind: 'expire-consequence',
        id: input.active.id,
        reason: 'Its window ran out. An undischarged consequence is not permanent.',
      });
      slotIsFree = true;
    } else if (
      !input.onVacation &&
      isDischarged(input.active.dischargeCondition, input.discharge)
    ) {
      decisions.push({
        kind: 'discharge-consequence',
        id: input.active.id,
        reason: 'The condition it named was satisfied.',
      });
      slotIsFree = true;
    }
  }

  if (input.onVacation) return decisions;

  for (const reward of input.rewards) {
    if (reward.status !== 'available') continue;
    if (!rewardIsEarned(reward, input)) continue;

    decisions.push({
      kind: 'earn-reward',
      id: reward.id,
      reason: describe(reward, input),
    });
  }

  for (const consequence of input.consequences) {
    if (consequence.status !== 'pending') continue;
    if (!consequenceIsTriggered(consequence, input)) continue;

    if (!slotIsFree) {
      /**
       * Recorded, not queued. A suppressed trigger is a fact worth having in
       * the log -- it says the week was bad enough to fire twice -- but acting
       * on it would stack, and stacking is what makes a bad week
       * unrecoverable.
       */
      decisions.push({
        kind: 'suppress-consequence',
        id: consequence.id,
        reason: 'Another consequence is already active. Consequences do not stack.',
      });
      continue;
    }

    decisions.push({
      kind: 'activate-consequence',
      id: consequence.id,
      reason: describe(consequence, input),
    });
    // One at a time, including within a single pass.
    slotIsFree = false;
  }

  return decisions;
}

/**
 * Why it fired, in words.
 *
 * Required, not decorative. A consequence with no visible cause is arbitrary,
 * and arbitrary stakes get ignored rather than met.
 */
function describe(rule: StakeRule, input: EvaluationInput): string {
  const percent = (value: number) => `${Math.round(value * 100)}%`;

  switch (rule.trigger) {
    case 'adherence-threshold': {
      const threshold = rule.triggerConfig.thresholdRate ?? 0;

      return `Adherence is ${percent(input.adherence.rate)} — ${input.adherence.kept} of ${input.adherence.of} days with blocks — against a threshold of ${percent(threshold)}.`;
    }
    case 'milestone':
      return `${input.topicsDone} must-master topics done, against a milestone of ${rule.triggerConfig.topicsDone ?? 0}.`;
    case 'manual-grant':
      return 'Granted by the overseer.';
  }
}
