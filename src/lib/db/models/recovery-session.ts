import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

/**
 * An episode of recovery mode.
 *
 * ---------------------------------------------------------------------------
 * NOT A FLAG. THE EPISODE.
 * ---------------------------------------------------------------------------
 * Whether recovery mode is ON is DERIVED, every read, from the overdue counts
 * and the thresholds -- exactly like a miss and exactly like needs-reckoning.
 * There is no `inRecovery: true` column and there must never be one, because
 * it changes with the clock rather than with a write.
 *
 * This document is the other thing: the record that an episode happened, when
 * it started, when it ended, and how many passes it took. A foreign key would
 * record only the current state; a collection records the episode itself, so
 * "you spent nine days in recovery in October and it took eleven passes"
 * survives it ending. The same argument as the Relationship collection.
 * ---------------------------------------------------------------------------
 *
 * The unique partial index is what makes entry safe under concurrency. Several
 * serverless invocations can each observe the thresholds crossed at the same
 * instant; exactly one wins the index and appends RECOVERY_MODE_ENTERED, and
 * the losers get a duplicate-key error, which is success.
 */
const recoverySessionSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },

    startedAt: { type: Date, required: true },
    /** Null while the episode is open. */
    endedAt: { type: Date, default: null },

    /** The counts that triggered it, for the record. Never read back as state. */
    startedWith: {
      needsReckoning: { type: Number, required: true },
      overdue: { type: Number, required: true },
    },

    /**
     * Completed triages. One pass is three commitments dispatched three
     * different ways, and it takes as many as it takes -- three at a time out
     * of thirty-four is eight passes, which is the honest size of the problem
     * rather than a number chosen to feel achievable.
     */
    passes: { type: Number, required: true, default: 0 },
    /** Commitment ids resolved during this episode, so a pass cannot repeat one. */
    resolved: { type: [String], default: [] },
  },
  { collection: 'recoverysessions', versionKey: false },
);

/**
 * One open episode per owner.
 *
 * Partial rather than plain: closed episodes are history and there can be any
 * number of them.
 *
 * Named explicitly: `ownerId` is also indexed plainly for scoped reads, and two
 * indexes on the same key would both auto-generate the name `ownerId_1` and
 * collide at sync time.
 */
recoverySessionSchema.index(
  { ownerId: 1 },
  { unique: true, partialFilterExpression: { endedAt: null }, name: 'ownerId_openEpisode' },
);

export type RecoverySessionDocument = InferSchemaType<typeof recoverySessionSchema>;

export const RecoverySessionModel: Model<RecoverySessionDocument> =
  (mongoose.models.RecoverySession as Model<RecoverySessionDocument> | undefined) ??
  mongoose.model<RecoverySessionDocument>('RecoverySession', recoverySessionSchema);
