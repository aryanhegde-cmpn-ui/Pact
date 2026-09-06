import { z } from 'zod';

import { isDateKey } from '@/lib/time';

const dateKey = z.string().refine(isDateKey, { message: 'must be YYYY-MM-DD' });
const wallClock = z.string().regex(/^\d{2}:\d{2}$/, 'must be HH:MM');

/**
 * The curriculum, imported from the workbook.
 *
 * The workbook is the authority on the plan. These schemas describe what it
 * says, not an idealised version of it: `practiceRaw` is kept verbatim, the
 * block column keeps its "Block N -- Category" shape as two fields, and the
 * phases keep the exact focus text alongside whatever could be derived from it.
 *
 * ---------------------------------------------------------------------------
 * THE PLAYLIST RULE
 * ---------------------------------------------------------------------------
 * The workbook says it twice, in two sheets: "Playlist links are resource
 * pools, not courses to finish end-to-end", and every Core resource's "how to
 * use" repeats it -- "Daily; don't finish as a course", "Pick relevant videos
 * only", "Pick weak topics only".
 *
 * So a Resource has NO progress, NO completion percentage, and NO remaining
 * count, and neither does a playlist. There is a test that scans the source
 * and fails if one appears. Progress belongs to a TOPIC, which is a thing you
 * can actually be done with; a playlist is a shelf, and 40% of a shelf is not
 * a fact about anybody.
 * ---------------------------------------------------------------------------
 */

// --- Blocks -----------------------------------------------------------------

/**
 * The daily windows.
 *
 * Three study blocks, plus the two evening rows the workbook lists. The
 * evening rows are here rather than dropped because the generator has to be
 * able to SEE them: "workout + rest" is listed as Priority, and a generator
 * that does not know it exists will happily schedule over it.
 */
export const blockIdSchema = z.enum([
  'block-1',
  'block-2',
  'block-3',
  'evening-optional',
  'evening-recovery',
]);
export type BlockId = z.infer<typeof blockIdSchema>;

/**
 * What the generator is allowed to do with a block.
 *
 * `study`     -- a daily series, materialised like any other recurrence.
 * `optional`  -- surfaced, never generated. See the evening rule below.
 * `recovery`  -- never generated and never competed with.
 */
export const blockKindSchema = z.enum(['study', 'optional', 'recovery']);
export type BlockKind = z.infer<typeof blockKindSchema>;

export const blockSchema = z.object({
  blockId: blockIdSchema,
  /** "Block 1", "Evening" -- the workbook's own Time/Block wording. */
  label: z.string().min(1),
  /** "DSA", "Frontend Engineering", "Workout + Rest". */
  area: z.string().min(1),
  /** The workbook's "Exact activity", verbatim. This becomes the outcome. */
  exactActivity: z.string().min(1),
  primaryResource: z.string(),
  cadence: z.string(),
  kind: blockKindSchema,
  /** Wall clock in APP_TIMEZONE. Null for the evening rows, which have no fixed time. */
  startTime: wallClock.nullable(),
  endTime: wallClock.nullable(),
  /** Minutes between start and end. Null when the block has no fixed window. */
  durationMinutes: z.number().int().min(1).nullable(),
  order: z.number().int().min(0),
});
export type Block = z.infer<typeof blockSchema>;

// --- Phases -----------------------------------------------------------------

export const phaseSchema = z.object({
  number: z.number().int().min(1),
  /** The workbook's own wording: "Sep 7-Sep 30", "October". Kept for display. */
  datesRaw: z.string().min(1),
  /** Normalised to real dates in APP_TIMEZONE. Both inclusive. */
  startDate: dateKey,
  endDate: dateKey,
  primaryFocus: z.string().min(1),
  secondaryFocus: z.string().min(1),
  outcome: z.string().min(1),
  rule: z.string().min(1),
  /**
   * Derived from the focus text at import, and STORED rather than recomputed.
   *
   * A phase's focus is prose, and matching prose against category names is a
   * guess. Storing the guess makes it visible and correctable; deriving it at
   * read time would make it a hidden condition nobody can see is wrong.
   */
  focusCategories: z.array(z.string()),
  focusModules: z.array(z.string()),
  /** The phase's rule says to study only what is already weak. */
  revisionOnly: z.boolean(),
  /** The focus text mentions revision, so revision outranks new material. */
  revisionBias: z.boolean(),
});
export type Phase = z.infer<typeof phaseSchema>;

// --- Topics -----------------------------------------------------------------

export const priorityBandSchema = z.enum(['P0', 'P1', 'P2']);
export type PriorityBand = z.infer<typeof priorityBandSchema>;

/** The workbook's legend, kept as data so the UI does not restate it. */
export const PRIORITY_BAND_LABELS: Record<PriorityBand, string> = {
  P0: 'Must master',
  P1: 'Important',
  P2: 'Supporting',
};

/**
 * What a topic's "Practice / Output" column is asking for.
 *
 * Deliberately small, and `other` is not a failure bucket to be ashamed of --
 * it is the honest answer for "Whiteboard + edge cases", which is a real
 * instruction that simply is not any of the others. A row parsed as `other` is
 * flagged for review, and the app shows a list of them to correct by hand.
 *
 * A wrong silent parse is worse than an obvious gap: a target of "5 problems"
 * invented from "Choose storage for scenarios" would show up as progress
 * against a number nobody set.
 */
export const targetKindSchema = z.enum([
  'problems',
  'build',
  'verbal',
  'audit',
  'explain',
  'other',
]);
export type TargetKind = z.infer<typeof targetKindSchema>;

/** What `targetMin`/`targetMax` are counting. Null when nothing was parsed. */
export const targetUnitSchema = z.enum(['problems', 'minutes']);
export type TargetUnit = z.infer<typeof targetUnitSchema>;

export const practiceTargetSchema = z.object({
  kind: targetKindSchema,
  unit: targetUnitSchema.nullable(),
  targetMin: z.number().int().min(1).nullable(),
  targetMax: z.number().int().min(1).nullable(),
  /**
   * True when the parse produced nothing better than `other`, or when the text
   * matched two kinds at once and picking one would be a coin toss.
   */
  needsReview: z.boolean(),
  /** Why it was flagged, in one phrase, so the review list is readable. */
  reviewReason: z.string().nullable(),
});
export type PracticeTarget = z.infer<typeof practiceTargetSchema>;

export const curriculumTopicSchema = z.object({
  /**
   * block + module + topic + subTopic, slugged.
   *
   * The import key. Stable across re-runs so re-importing updates a definition
   * in place instead of creating a second row and orphaning its progress.
   */
  stableKey: z.string().min(1),
  blockId: blockIdSchema,
  /** The suffix of the workbook's Block column: "DSA", "Machine Coding". */
  category: z.string().min(1),
  module: z.string().min(1),
  topic: z.string().min(1),
  subTopic: z.string(),
  resourceName: z.string(),
  link: z.string(),
  /** VERBATIM. Never normalised, never rewritten by a parse. */
  practiceRaw: z.string(),
  target: practiceTargetSchema,
  priority: priorityBandSchema,
  /** The workbook's row order, so the curriculum browser reads like the sheet. */
  order: z.number().int().min(0),
});
export type CurriculumTopic = z.infer<typeof curriculumTopicSchema>;

// --- Progress ---------------------------------------------------------------

/**
 * `needs-revision` is a first-class state, not "done with an asterisk".
 *
 * It is what Sunday's review acts on and what the last phase's "study only
 * gaps that appear" rule means. Folding it into `done` would make the plan
 * unable to tell "finished" from "finished badly".
 */
export const topicStatusSchema = z.enum(['not-started', 'in-progress', 'done', 'needs-revision']);
export type TopicStatus = z.infer<typeof topicStatusSchema>;

export const topicProgressSchema = z.object({
  stableKey: z.string().min(1),
  status: topicStatusSchema,
  /** Free text, private to the primary like every other note. */
  note: z.string(),
  updatedAt: z.date(),
});
export type TopicProgress = z.infer<typeof topicProgressSchema>;

// --- Resources --------------------------------------------------------------

export const resourceTypeSchema = z.enum(['Core', 'Optional', 'Practice', 'Reference']);
export type ResourceType = z.infer<typeof resourceTypeSchema>;

/**
 * A resource is a POOL. See the playlist rule at the top of this file: there
 * is no progress field here and there must never be one.
 */
export const resourceSchema = z.object({
  name: z.string().min(1),
  type: resourceTypeSchema,
  use: z.string(),
  link: z.string(),
  /** The workbook's "How to use". Half of these say, in effect, don't finish it. */
  howToUse: z.string(),
  order: z.number().int().min(0),
});
export type Resource = z.infer<typeof resourceSchema>;

// --- Interview prep ---------------------------------------------------------

export const interviewCategorySchema = z.enum([
  'Resume',
  'Machine coding',
  'System design',
  'DSA',
  'Behavioral',
]);
export type InterviewCategory = z.infer<typeof interviewCategorySchema>;

export const interviewPrepItemSchema = z.object({
  stableKey: z.string().min(1),
  category: interviewCategorySchema,
  topic: z.string().min(1),
  whatToMaster: z.string(),
  practice: z.string(),
  /**
   * The date the workbook's "serious rehearsal from November" starts.
   *
   * MODELLED, not a hidden UI condition. The sheet says rehearsal begins in
   * November and that examples should be collected from work before then --
   * so the gate is a date the plan owns and the phase view can explain, not an
   * `if (month >= 11)` buried in a component where nobody can see why.
   */
  rehearsalFrom: dateKey,
  order: z.number().int().min(0),
});
export type InterviewPrepItem = z.infer<typeof interviewPrepItemSchema>;

// --- Request shapes ---------------------------------------------------------

export const setTopicProgressSchema = z.object({
  stableKey: z.string().min(1),
  status: topicStatusSchema,
  note: z.string().max(2000).optional(),
});

/** Correcting a flagged parse by hand, from the review list. */
export const correctTargetSchema = z.object({
  stableKey: z.string().min(1),
  kind: targetKindSchema,
  unit: targetUnitSchema.nullable(),
  targetMin: z.number().int().min(1).max(10_000).nullable(),
  targetMax: z.number().int().min(1).max(10_000).nullable(),
});

/** Overriding today's suggested topic for one block. */
export const overrideTopicSchema = z.object({
  commitmentId: z.string().min(1),
  /** Null clears the topic, leaving the block open. */
  stableKey: z.string().min(1).nullable(),
});

/**
 * An explicit re-plan.
 *
 * A reason is required for the same structural purpose it is required on a
 * deadline change: moving a plan you are behind on should be a decision
 * someone articulates, not a drag that happens five times without ever
 * feeling like anything.
 */
export const replanSchema = z.object({
  phaseNumber: z.number().int().min(1).max(20),
  newEndDate: dateKey,
  reason: z.string().trim().min(10, 'Say why, in a sentence.').max(500),
});
