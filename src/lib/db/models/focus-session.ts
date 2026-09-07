import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

import { blockerKindSchema, sessionKindSchema, sessionOutcomeSchema } from '@/lib/schemas/focus';

/**
 * One sitting of work against one commitment.
 *
 * ---------------------------------------------------------------------------
 * `startedAt` IS THE CLOCK. THE BROWSER IS NOT.
 * ---------------------------------------------------------------------------
 * Elapsed time is computed from this field, on the server, every time it is
 * asked for. `actualMinutes` is written once, at the end, from
 * `endedAt - startedAt`.
 *
 * Nothing counts intervals in the browser, because a study block is sixty to
 * ninety minutes of exactly the conditions that break interval counting: the
 * tab gets backgrounded and its timers are throttled to once a minute or
 * stopped altogether, the phone sleeps, the PWA is suspended by the OS. A
 * counter incremented client-side would report a ninety-minute session as
 * eleven minutes, and there would be no way to tell afterwards that it had.
 * ---------------------------------------------------------------------------
 */
const focusSessionSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },
    commitmentId: { type: String, required: true, index: true },

    /**
     * The curriculum topic this was spent on, by stable key.
     *
     * A key rather than a row id, for the same reason the commitment carries
     * one: topic definitions are re-imported and replaced, and a session in
     * the history has to keep pointing at the topic it was actually about.
     * Null for any session that is not a study block.
     */
    topicKey: { type: String, default: null },
    /** Which block, when this is one. Null otherwise. */
    blockId: { type: String, default: null },

    startedAt: { type: Date, required: true },
    /** Null while the session is running. The lock keys on this. */
    endedAt: { type: Date, default: null },

    /** What was intended, from the commitment's estimate or the block's length. */
    plannedMinutes: { type: Number, default: null },
    /**
     * Written once, at the end, from the server clock.
     *
     * Never sent by the client. A duration the client could set is a duration
     * that can be set to whatever makes the number look better.
     */
    actualMinutes: { type: Number, default: null },

    kind: {
      type: String,
      required: true,
      enum: sessionKindSchema.options,
      // Deliberate: see the note on `sessionKindSchema`. The planning ratio is
      // defeated by a default that makes miscategorising the easy path.
      default: 'execution',
    },
    outcome: { type: String, default: null, enum: [...sessionOutcomeSchema.options, null] },

    interruptionCount: { type: Number, required: true, default: 0 },
    notes: { type: String, default: '' },

    /** Set when the session ended blocked. */
    blockerKind: { type: String, default: null, enum: [...blockerKindSchema.options, null] },
    blocker: { type: String, default: null },

    // --- Research budget ----------------------------------------------------
    researchBudgetMinutes: { type: Number, default: null },
    /**
     * When the one interruption was shown.
     *
     * Once, ever, per session. A budget that nags is a budget that gets
     * dismissed reflexively, and then it is not a decision point, it is noise.
     */
    budgetWarnedAt: { type: Date, default: null },
    budgetExtendedBy: { type: Number, default: 0 },
    budgetJustification: { type: String, default: null },

    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'focussessions', versionKey: false },
);

/**
 * One running session per owner.
 *
 * Partial: finished sessions are the history and there are as many as there
 * are. This index is the lock -- it is what makes "you are already in a
 * session" true across two tabs and two serverless invocations rather than
 * true only in the tab that knows about it.
 *
 * Named explicitly: `ownerId` is also indexed plainly for scoped reads, and
 * two indexes on the same key would both auto-generate the name `ownerId_1`
 * and collide at sync time.
 */
focusSessionSchema.index(
  { ownerId: 1 },
  { unique: true, partialFilterExpression: { endedAt: null }, name: 'ownerId_runningSession' },
);

// The history reads, per commitment and per topic.
focusSessionSchema.index({ ownerId: 1, commitmentId: 1, startedAt: -1 });
focusSessionSchema.index({ ownerId: 1, topicKey: 1, startedAt: -1 });

export type FocusSessionDocument = InferSchemaType<typeof focusSessionSchema>;

export const FocusSessionModel: Model<FocusSessionDocument> =
  (mongoose.models.FocusSession as Model<FocusSessionDocument> | undefined) ??
  mongoose.model<FocusSessionDocument>('FocusSession', focusSessionSchema);
