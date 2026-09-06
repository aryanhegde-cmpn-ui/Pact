import { z } from 'zod';

/**
 * The reckoning: answering a missed deadline.
 *
 * A miss that is never answered is just a red row. The point of this flow is
 * that the answer produces a change the system can observe, so the next
 * attempt differs from the last one.
 */

/**
 * Why a commitment was missed.
 *
 * A closed list, not free text. Free text cannot be counted, and a reason that
 * cannot be counted cannot show a pattern -- which is the entire point of
 * asking. Free text is available alongside, never instead.
 */
export const missReasonSchema = z.enum([
  'underestimated',
  'forgot',
  'distracted',
  'too-tired',
  'too-vague',
  'didnt-know-how-to-start',
  'waiting-on-someone',
  'higher-priority-appeared',
  'avoided',
  'perfectionism',
  'not-important',
  'other',
]);
export type MissReason = z.infer<typeof missReasonSchema>;

export const MISS_REASON_LABELS: Record<MissReason, string> = {
  underestimated: 'I underestimated the effort',
  forgot: 'I forgot',
  distracted: 'I got distracted',
  'too-tired': 'I was too tired',
  'too-vague': 'The task was too vague',
  'didnt-know-how-to-start': "I didn't know how to start",
  'waiting-on-someone': 'I was waiting on someone',
  'higher-priority-appeared': 'Higher-priority work appeared',
  avoided: 'I avoided it',
  perfectionism: 'Perfectionism',
  'not-important': "I decided it wasn't important",
  other: 'Something else',
};

/**
 * What changes as a result.
 *
 * EVERY option produces an effect the system can observe or enforce. That is
 * the rule this whole feature rests on: a reason that produces no consequence
 * is journaling, and journaling does not make the next attempt go differently.
 */
export const recoveryActionSchema = z.enum([
  /** Cut the scope: a smaller outcome and a smaller estimate. */
  'reduce-scope',
  /** Break it into smaller commitments, created now. */
  'split',
  /** Name the concrete next action. Required before rescheduling. */
  'define-next-action',
  /** Name a starting action of 25 minutes or less. */
  'define-starting-action',
  /** Create a 15-minute start session today. */
  'schedule-start-session',
  /** Mark blocked on a named person, with a follow-up date. */
  'mark-blocked',
  /** Lower the quality bar explicitly, as the outcome. */
  'lower-quality-bar',
  /** Abandon it now, with the reason recorded. */
  'abandon',
  /** Name the commitment that displaced it. */
  'link-displacing-commitment',
]);
export type RecoveryAction = z.infer<typeof recoveryActionSchema>;

export const RECOVERY_ACTION_LABELS: Record<RecoveryAction, string> = {
  'reduce-scope': 'Cut the scope down',
  split: 'Split it into smaller commitments',
  'define-next-action': 'Define the concrete next action',
  'define-starting-action': 'Define a starting action (25 min or less)',
  'schedule-start-session': 'Schedule a 15-minute start session today',
  'mark-blocked': 'Mark it blocked on someone',
  'lower-quality-bar': 'Set a lower quality bar',
  abandon: 'Abandon it',
  'link-displacing-commitment': 'Name what displaced it',
};

/**
 * Which recovery actions are offered for each reason.
 *
 * Derived from the answer rather than an undifferentiated list, because the
 * useful response to "I underestimated" is not the useful response to "I was
 * waiting on someone", and offering all nine every time makes the choice
 * meaningless.
 *
 * `abandon` is available from every reason. Being able to stop is not a
 * failure state, and hiding it would push people toward silently letting
 * things rot instead — which is the outcome with the least information in it.
 */
export const ACTIONS_FOR_REASON: Record<MissReason, readonly RecoveryAction[]> = {
  underestimated: ['reduce-scope', 'split', 'abandon'],
  forgot: ['schedule-start-session', 'define-next-action', 'abandon'],
  distracted: ['schedule-start-session', 'reduce-scope', 'abandon'],
  'too-tired': ['reduce-scope', 'schedule-start-session', 'abandon'],
  'too-vague': ['define-next-action', 'split', 'abandon'],
  'didnt-know-how-to-start': ['define-starting-action', 'split', 'abandon'],
  'waiting-on-someone': ['mark-blocked', 'abandon'],
  'higher-priority-appeared': ['link-displacing-commitment', 'reduce-scope', 'abandon'],
  avoided: ['schedule-start-session', 'define-starting-action', 'reduce-scope', 'abandon'],
  perfectionism: ['lower-quality-bar', 'reduce-scope', 'abandon'],
  'not-important': ['abandon'],
  other: [
    'define-next-action',
    'reduce-scope',
    'split',
    'schedule-start-session',
    'mark-blocked',
    'abandon',
  ],
};

/** Longest a "starting action" may be. Beyond this it is not a start, it is the task. */
export const MAX_STARTING_ACTION_MINUTES = 25;

/** How long a recovery start session is. Short enough that beginning is the only ask. */
export const START_SESSION_MINUTES = 15;

const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

/**
 * The payload each action needs to actually take effect.
 *
 * Validated per action rather than as one loose bag, so an action cannot be
 * recorded without the detail that makes it real -- "mark blocked" with nobody
 * named is a status change that changes nothing.
 */
export const recoveryDetailSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('reduce-scope'),
    /** The smaller outcome. Replaces the original. */
    newOutcome: nonEmpty(500),
    newEstimateMinutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60),
  }),
  z.object({
    action: z.literal('split'),
    /** Created immediately, so the split is real rather than intended. */
    parts: z
      .array(
        z.object({
          title: nonEmpty(200),
          outcome: nonEmpty(500),
          estimateMinutes: z.coerce
            .number()
            .int()
            .min(1)
            .max(24 * 60),
          dueAt: z.coerce.date(),
        }),
      )
      .min(2, 'A split needs at least two parts')
      .max(10),
  }),
  z.object({ action: z.literal('define-next-action'), nextAction: nonEmpty(300) }),
  z.object({
    action: z.literal('define-starting-action'),
    nextAction: nonEmpty(300),
    startingMinutes: z.coerce.number().int().min(1).max(MAX_STARTING_ACTION_MINUTES),
  }),
  z.object({
    action: z.literal('schedule-start-session'),
    /** When today's session starts. The session itself is a real commitment. */
    startAt: z.coerce.date(),
  }),
  z.object({
    action: z.literal('mark-blocked'),
    blockedOn: nonEmpty(200),
    followUpDate: z.coerce.date(),
  }),
  z.object({ action: z.literal('lower-quality-bar'), newOutcome: nonEmpty(500) }),
  z.object({ action: z.literal('abandon'), abandonReason: nonEmpty(500).optional() }),
  z.object({
    action: z.literal('link-displacing-commitment'),
    displacedBy: z.string().min(1, 'Name the commitment that displaced this one'),
  }),
]);
export type RecoveryDetail = z.infer<typeof recoveryDetailSchema>;

export const reckoningSubmissionSchema = z
  .object({
    /**
     * Step 1. True means it WAS done, just not on time -- the completion is
     * recorded with its real time and the history shows it late.
     */
    completed: z.boolean(),
    /** When it was actually finished. Only meaningful when completed. */
    completedAt: z.coerce.date().optional(),
    reason: missReasonSchema.optional(),
    /** Alongside the reason, never instead of it. */
    note: z.string().trim().max(2_000).optional(),
    recovery: recoveryDetailSchema.optional(),
  })
  .refine((value) => value.completed || value.reason !== undefined, {
    message: 'A reason is required when the commitment was not completed',
    path: ['reason'],
  })
  .refine((value) => value.completed || value.recovery !== undefined, {
    // The rule the whole feature rests on.
    message: 'A recovery action is required: a reason with no consequence is journaling',
    path: ['recovery'],
  })
  .refine(
    (value) =>
      value.completed ||
      value.reason === undefined ||
      value.recovery === undefined ||
      ACTIONS_FOR_REASON[value.reason].includes(value.recovery.action),
    { message: 'That recovery action is not offered for this reason', path: ['recovery'] },
  );
export type ReckoningSubmission = z.infer<typeof reckoningSubmissionSchema>;

/**
 * Why a deadline moved.
 *
 * Required alongside the free-text reason, for the same counting argument: a
 * hundred distinct sentences cannot show that half of them say "avoidance".
 */
export const deadlineChangeCategorySchema = z.enum([
  'underestimated',
  'scope-changed',
  'blocked-externally',
  'priority-changed',
  'avoidance',
  'deliberate-replan',
]);
export type DeadlineChangeCategory = z.infer<typeof deadlineChangeCategorySchema>;

export const DEADLINE_CATEGORY_LABELS: Record<DeadlineChangeCategory, string> = {
  underestimated: 'I underestimated it',
  'scope-changed': 'The scope changed',
  'blocked-externally': 'Blocked externally',
  'priority-changed': 'Priorities changed',
  avoidance: 'Avoidance',
  'deliberate-replan': 'Deliberate replan',
};

/** Deadline changes at or above this are flagged as an intervention candidate. */
export const INTERVENTION_THRESHOLD = 3;
