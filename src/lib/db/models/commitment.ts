import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

import { commitmentStatusSchema, prioritySchema } from '@/lib/schemas/commitment';

/**
 * A Commitment. Not a task.
 *
 * ---------------------------------------------------------------------------
 * FIELDS THAT ARE DELIBERATELY ABSENT
 * ---------------------------------------------------------------------------
 * `postponementCount`, `isMissed`, `isStale`, `actualMinutes`, `completionRate`
 * and anything else of that shape do NOT belong here, and the temptation to add
 * one WILL come back -- usually disguised as a performance argument.
 *
 * Every one of them is derivable:
 *
 *   postponementCount -> count DEADLINE_CHANGED events for this entity
 *   isMissed          -> now > dueAt && status is pending or in-progress
 *   isStale           -> derived from the event log's last activity
 *   actualMinutes     -> completedAt - startedAt
 *
 * A stored copy is a second source of truth that drifts the first time a write
 * path forgets to update it, and it cannot be recomputed after a bug because
 * the history it summarised is gone. The event log can always be replayed; a
 * counter cannot. See CLAUDE.md, "Event log rule".
 *
 * If a query is genuinely too slow, the answer is an index or a cache with an
 * explicit lifetime -- not a mutable field on this document.
 * ---------------------------------------------------------------------------
 */
const commitmentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    /**
     * The primary this row belongs to.
     *
     * Every scoped query filters on it, so a primary reading their own data
     * and an overseer reading the same primary's run one query with a
     * different value. Indexed because it is in the predicate of essentially
     * every read.
     */
    ownerId: { type: String, required: true, index: true },

    /** What is true when this is done. Required: an unverifiable commitment cannot be honoured. */
    outcome: { type: String, required: true, trim: true },

    /**
     * The live deadline.
     *
     * Written at creation and thereafter ONLY by `changeDeadline()`. The
     * generic update path rejects any body containing it. This is the product,
     * not a style preference: an unlogged reschedule erases the postponement
     * history the whole app exists to show.
     */
    dueAt: { type: Date, required: true },

    /**
     * The deadline first committed to. Immutable after creation -- enforced by
     * the pre-hooks below, not by convention.
     */
    originalDueAt: { type: Date, required: true, immutable: true },

    estimateMinutes: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      required: true,
      enum: commitmentStatusSchema.options,
      default: 'pending',
    },
    priority: { type: String, required: true, enum: prioritySchema.options },

    seriesId: { type: String, default: null, index: true },

    /**
     * Set when this commitment was generated from the study plan.
     *
     * Its presence is what makes this a plan-generated commitment rather than
     * a manually created one -- which is the distinction that lets the
     * creation guardrails be skipped. Nothing was typed, so there is no vague
     * outcome for them to catch: the outcome and estimate come from the
     * curriculum definition. See docs/product.md, Conflict 3.
     */
    blockId: { type: String, default: null },
    /**
     * The curriculum topic this occurrence is for, by stable key.
     *
     * A KEY, not an id: the topic definition is re-imported and can be
     * replaced, and a commitment in the history must keep pointing at the
     * topic it was actually about. Overridable -- the suggestion is a default,
     * never a lock -- and a change appends PLAN_TOPIC_OVERRIDDEN.
     */
    curriculumTopicKey: { type: String, default: null },
    /**
     * Set once a person has chosen the topic themselves.
     *
     * The plan may re-resolve a suggestion that has gone stale -- an
     * occurrence materialised a fortnight early can name a topic finished
     * since -- but it must never overwrite a choice. A default the app quietly
     * reverts is not a default, it is a lock that pretends otherwise.
     */
    topicOverridden: { type: Boolean, default: false },
    /** Local calendar date in APP_TIMEZONE, `YYYY-MM-DD`. */
    occurrenceDate: { type: String, default: null },

    /** Overrides the default notification lead time for this commitment only. */
    leadMinutes: { type: Number, default: null },

    // ---- Set by recovery actions -----------------------------------------
    // These are the observable effects of a reckoning. Each one exists so a
    // recovery choice changes something the system can act on rather than
    // being a note about an intention.

    /** The concrete next action. Blocks rescheduling after a "too vague" miss. */
    nextAction: { type: String, default: null },
    /** Who this is waiting on, from a `mark-blocked` recovery. */
    blockedOn: { type: String, default: null },
    followUpDate: { type: Date, default: null },
    /** The commitment that displaced this one. */
    displacedBy: { type: String, default: null },
    /** Commitments produced by a `split` recovery. */
    splitInto: { type: [String], default: [] },
    /** Set when this commitment IS a 15-minute recovery start session. */
    startSessionFor: { type: String, default: null },

    createdAt: { type: Date, required: true, default: () => new Date() },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    notes: { type: String, default: '' },

    /**
     * Marks a row generated by `npm run seed:history`.
     *
     * Sparse index: real rows do not carry the field at all, so the purge can
     * target synthetic data precisely instead of dropping collections and
     * taking real history with them.
     */
    synthetic: { type: Boolean, default: undefined },
  },
  { collection: 'commitments', versionKey: false },
);

// The dashboard's queries: a date window, and open work that is past due.
commitmentSchema.index({ dueAt: 1 });
commitmentSchema.index({ status: 1, dueAt: 1 });

/**
 * One occurrence per series per local date.
 *
 * Lazy materialisation means several concurrent requests can each decide the
 * same occurrence is missing and try to create it. This index makes the losers
 * fail with a duplicate-key error, which the materialiser treats as success.
 * `partialFilterExpression` keeps standalone commitments -- where both fields
 * are null -- out of it.
 */
commitmentSchema.index(
  { seriesId: 1, occurrenceDate: 1 },
  {
    unique: true,
    partialFilterExpression: {
      seriesId: { $type: 'string' },
      occurrenceDate: { $type: 'string' },
    },
  },
);

const IMMUTABLE_ORIGINAL =
  'originalDueAt is written once at creation and never again. ' +
  'To move a deadline use changeDeadline(), which writes dueAt and logs the reason.';

/**
 * Mongoose's `immutable: true` covers `save()` and honours it on updates only
 * when the schema is consulted; a raw `$set` through a query still slips past
 * in some paths. These hooks close that.
 */
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'] as const) {
  commitmentSchema.pre(op, function guardOriginalDueAt() {
    const update = this.getUpdate() as Record<string, Record<string, unknown>> | null;
    if (!update) return;

    const touched =
      'originalDueAt' in update ||
      Object.values(update).some(
        (operand) =>
          operand && typeof operand === 'object' && 'originalDueAt' in (operand as object),
      );

    if (touched) throw new Error(IMMUTABLE_ORIGINAL);
  });
}

// Sparse: only synthetic rows carry the field, so the purge scans nothing else.
commitmentSchema.index({ synthetic: 1 }, { sparse: true });

export type CommitmentDocument = InferSchemaType<typeof commitmentSchema>;

export const CommitmentModel: Model<CommitmentDocument> =
  (mongoose.models.Commitment as Model<CommitmentDocument> | undefined) ??
  mongoose.model<CommitmentDocument>('Commitment', commitmentSchema);
