import { z } from 'zod';

import { deadlineChangeCategorySchema, missReasonSchema } from '@/lib/schemas/reckoning';
import type { DeadlineChangeCategory, MissReason } from '@/lib/schemas/reckoning';

/**
 * Recovery mode.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REPLACES THE DASHBOARD RATHER THAN WARNING ON TOP OF IT
 * ---------------------------------------------------------------------------
 * A backlog past a certain size stops being information and starts being
 * wallpaper. Thirty-four unanswered misses under a banner is thirty-four
 * unanswered misses: the banner is read once, then never again, and the list
 * below it is scrolled past because no part of it is actionable.
 *
 * Worse, the normal dashboard invites the response that caused the backlog.
 * Faced with a long overdue list, the reflex is to reschedule all of it, and
 * the result is a bigger plan than the one already not being kept. Recovery
 * mode exists to make that impossible: three commitments, three DIFFERENT
 * dispositions, and no way to reschedule everything because only one of the
 * three slots reschedules at all.
 *
 * Nothing else is on screen. No metrics, no curriculum, no phase drift, no
 * lists. Those are all inputs to planning, and planning is the thing to stop
 * doing.
 * ---------------------------------------------------------------------------
 */

/**
 * Where recovery mode starts.
 *
 * Two independent triggers because they are two different failures. Unanswered
 * misses are a reckoning debt -- the record cannot say anything true about
 * behaviour until they are answered. Sheer overdue volume is a capacity
 * problem, and can happen with every miss dutifully reckoned.
 */
export const RECOVERY_THRESHOLDS = {
  /** Missed and unanswered. Above this, the event log is mostly unanswered questions. */
  needsReckoning: 10,
  /** Open and past due, answered or not. */
  overdue: 20,
} as const;

export function recoveryIsWarranted(counts: { needsReckoning: number; total: number }): boolean {
  return (
    counts.needsReckoning > RECOVERY_THRESHOLDS.needsReckoning ||
    counts.total > RECOVERY_THRESHOLDS.overdue
  );
}

/**
 * The three dispositions, and the fact that there are exactly three.
 *
 * One of each, every pass. Triage is the point: a pass where all three were
 * rescheduled would be the backlog spiral with extra steps.
 */
export const recoverySlotSchema = z.enum(['finish', 'reschedule', 'abandon']);
export type RecoverySlot = z.infer<typeof recoverySlotSchema>;

export const RECOVERY_SLOT_LABELS: Record<RecoverySlot, string> = {
  finish: 'Finish today',
  reschedule: 'Move it, deliberately',
  abandon: 'Let it go',
};

export const RECOVERY_SLOT_HELP: Record<RecoverySlot, string> = {
  finish: 'One thing you will actually do today. The smallest, by your own estimate.',
  reschedule: 'A new deadline, and an answer for the one you missed. Not a drag — a decision.',
  abandon: 'Stopping is a real answer. It is the one with the most information in it.',
};

/**
 * How a miss reason is recorded when a deadline moves in the same breath.
 *
 * Recovery's reschedule slot answers the miss AND moves the deadline, because
 * an unanswered miss cannot be rescheduled at all -- that refusal is the whole
 * reckoning feature, and recovery mode must not become the place it is quietly
 * dropped. Rather than asking the same question twice in two vocabularies,
 * the deadline category is derived from the miss reason.
 *
 * Derived, but never hidden: the surface shows the category that will be
 * recorded before the form is submitted. A mapping the user cannot see is a
 * mapping that misreports their history on their behalf.
 */
export const CATEGORY_FOR_MISS_REASON: Record<MissReason, DeadlineChangeCategory> = {
  underestimated: 'underestimated',
  forgot: 'deliberate-replan',
  distracted: 'deliberate-replan',
  'too-tired': 'deliberate-replan',
  'too-vague': 'scope-changed',
  'didnt-know-how-to-start': 'scope-changed',
  'waiting-on-someone': 'blocked-externally',
  'higher-priority-appeared': 'priority-changed',
  avoided: 'avoidance',
  perfectionism: 'scope-changed',
  'not-important': 'deliberate-replan',
  other: 'deliberate-replan',
};

const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

/** Resolving one slot. The shape depends on which. */
export const resolveSlotSchema = z.discriminatedUnion('slot', [
  z.object({
    slot: z.literal('finish'),
    commitmentId: z.string().min(1),
    /** One line on what changed. The same question the focus session asks. */
    note: z.string().trim().max(2_000).optional(),
  }),
  z.object({
    slot: z.literal('reschedule'),
    commitmentId: z.string().min(1),
    /** Answers the miss. A closed list, because free text cannot be counted. */
    reason: missReasonSchema,
    /** The concrete next action. Required before any reschedule, recovery or not. */
    nextAction: nonEmpty(300),
    newDueAt: z.coerce.date(),
  }),
  z.object({
    slot: z.literal('abandon'),
    commitmentId: z.string().min(1),
    reason: nonEmpty(500),
  }),
]);
export type ResolveSlotInput = z.infer<typeof resolveSlotSchema>;

/** Re-exported so a surface does not have to import from two places. */
export { deadlineChangeCategorySchema, missReasonSchema };
