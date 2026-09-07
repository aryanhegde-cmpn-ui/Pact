import { z } from 'zod';

/**
 * A focus session: one sitting of work against one commitment.
 *
 * The commitment says what was promised. The session says what actually
 * happened while trying to keep it -- how long, doing what kind of work, how
 * often it was interrupted, and how it ended. That is the only place the app
 * gets real durations from, and it is what makes "you estimated 60 and it
 * takes you 95" a fact rather than an impression.
 */

/**
 * What KIND of work this was.
 *
 * ---------------------------------------------------------------------------
 * THIS FIELD IS THE MOST GAMEABLE THING IN THE APP.
 * ---------------------------------------------------------------------------
 * The planning-versus-execution ratio is computed from it, and that ratio is
 * one of the few numbers that can tell someone they are busy rather than
 * productive. It is also trivially defeated by calling planning "execution" --
 * and the person doing that would not experience it as cheating, because
 * reading around a problem genuinely feels like working on it.
 *
 * So: `execution` is the default, and changing it takes a deliberate click.
 * Not a dropdown that has to be set every time, which would make the value
 * whatever was least effort. The friction is on the honest-but-unflattering
 * answer being *available*, never on it being *required* -- a field you must
 * fill in before starting is a field that gets filled in with the first
 * option.
 * ---------------------------------------------------------------------------
 */
export const sessionKindSchema = z.enum(['execution', 'planning', 'research']);
export type SessionKind = z.infer<typeof sessionKindSchema>;

export const SESSION_KIND_LABELS: Record<SessionKind, string> = {
  execution: 'Doing the thing',
  planning: 'Planning or organising',
  research: 'Reading or researching',
};

export const SESSION_KIND_HELP: Record<SessionKind, string> = {
  execution: 'Building, writing, solving. The default, because it should be most of them.',
  planning: 'Deciding what to do. Counted separately, because it is not the work.',
  research: 'Finding out how. Real, and easy to hide in — set a budget.',
};

/**
 * How a session ended.
 *
 * `more-time` is NOT a failure, anywhere: not in the copy, not in adherence,
 * not in any metric. It is the honest report that the estimate was wrong, and
 * an app that penalises it teaches the user to stop reporting it — at which
 * point every estimate in the history is fiction.
 */
export const sessionOutcomeSchema = z.enum(['done', 'more-time', 'blocked']);
export type SessionOutcome = z.infer<typeof sessionOutcomeSchema>;

/** What kind of blocker. A closed list, because free text cannot be counted. */
export const blockerKindSchema = z.enum(['person', 'information', 'skill']);
export type BlockerKind = z.infer<typeof blockerKindSchema>;

export const BLOCKER_KIND_LABELS: Record<BlockerKind, string> = {
  person: 'Waiting on a person',
  information: 'Missing information',
  skill: 'I do not know how yet',
};

const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

export const startSessionSchema = z.object({
  commitmentId: z.string().min(1),
  /** Defaults to execution. See the note on `sessionKindSchema`. */
  kind: sessionKindSchema.default('execution'),
  plannedMinutes: z
    .number()
    .int()
    .min(1)
    .max(8 * 60)
    .optional(),
  /**
   * Optional, and only meaningful for a research session. When it runs out the
   * session interrupts once and asks for a decision.
   */
  researchBudgetMinutes: z
    .number()
    .int()
    .min(1)
    .max(4 * 60)
    .optional(),
});

/**
 * Progress against a curriculum topic's target.
 *
 * A block session's whole point: the block is the commitment and the topic is
 * the content, so finishing the block has to say something about the topic or
 * the two never connect.
 */
export const topicProgressReportSchema = z.object({
  /** For a `problems` target. */
  problemsSolved: z.number().int().min(0).max(500).optional(),
  /** For a `build` target. */
  buildFinished: z.boolean().optional(),
  /** Whatever the target was, in the user's words. Always allowed. */
  note: z.string().trim().max(2_000).optional(),
  /** True when the topic is finished but shakily. Its own status, not a lesser done. */
  needsRevision: z.boolean().optional(),
});
export type TopicProgressReport = z.infer<typeof topicProgressReportSchema>;

export const endSessionSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('done'),
    /** One line on what changed. The question that separates finished from ticked off. */
    note: nonEmpty(2_000),
    topicProgress: topicProgressReportSchema.optional(),
  }),
  z.object({
    outcome: z.literal('more-time'),
    /** The estimate, revised now that there is evidence for it. */
    revisedEstimateMinutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
    note: z.string().trim().max(2_000).optional(),
  }),
  z.object({
    outcome: z.literal('blocked'),
    blockerKind: blockerKindSchema,
    /** What is blocking it. For a person, their name. */
    blocker: nonEmpty(300),
    /** Only offered when the blocker is a person. */
    createFollowUp: z.boolean().optional(),
    followUpAt: z.coerce.date().optional(),
  }),
]);
export type EndSessionInput = z.infer<typeof endSessionSchema>;

/** What to do when a research budget runs out. Offered once, never again. */
export const budgetDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('execute') }),
  z.object({
    decision: z.literal('extend'),
    /**
     * Required. Extending without saying why is how a research budget becomes
     * a number that is always extended, which is the same as not having one.
     */
    justification: nonEmpty(500),
    extraMinutes: z.number().int().min(1).max(120),
  }),
]);
export type BudgetDecision = z.infer<typeof budgetDecisionSchema>;

/**
 * Capabilities refused while a session is running.
 *
 * The point of a full-screen session is that it is the only thing happening.
 * A lock enforced in the UI is not a lock: a second tab, or the same tab on a
 * phone that restored an old page, routes straight around it. So the server
 * refuses, and the refusal lives next to the matrix rather than in each route.
 *
 * Reckoning is absent deliberately. Answering a miss is not planning, it
 * cannot create work, and blocking it would mean a session started by accident
 * could wedge the reckoning queue.
 */
export const SESSION_LOCKED_CAPABILITIES = [
  'commitment:write',
  'series:write',
  'curriculum:write',
  'settings:write',
] as const;

export const SESSION_LOCK_MESSAGE = "You're in a session.";
