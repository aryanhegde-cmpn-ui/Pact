import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

/**
 * One recovery code, hashed.
 *
 * ---------------------------------------------------------------------------
 * CONSUMED, NEVER DELETED.
 * ---------------------------------------------------------------------------
 * A used code is marked with a timestamp and left where it is. Deleting it
 * would make "a code was used to reset this password on the 4th" unanswerable
 * from the data, which is exactly the question worth being able to answer about
 * a credential reset. The event log records it too; the row is what the log
 * points at.
 * ---------------------------------------------------------------------------
 */
const recoveryCodeSchema = new mongoose.Schema(
  {
    /** The account this code belongs to. Not `ownerId`: this is about the LOGIN. */
    userId: { type: String, required: true, index: true },

    /**
     * Groups the ten codes issued together.
     *
     * Validity is `setId === user.recoveryCodeSetId`, and regenerating switches
     * that pointer in one write. That is what makes invalidation atomic: there
     * is no moment where two sets are live and no moment where none are, which
     * an "invalidate the old ones, then insert the new ones" pair cannot
     * promise in either order.
     */
    setId: { type: String, required: true, index: true },

    /**
     * Argon2id, the same parameters as a password.
     *
     * `select: false` for the same reason the password hash is: a code that
     * reaches a response body because someone spread a document into JSON is a
     * code an attacker can crack offline at their leisure.
     */
    codeHash: { type: String, required: true, select: false },

    createdAt: { type: Date, required: true, default: () => new Date() },
    /** Set exactly once, by the reset that used it. Never unset. */
    consumedAt: { type: Date, default: null },
  },
  { collection: 'recovery_codes', versionKey: false },
);

/** The read the verify step makes: this account's live, unused codes. */
recoveryCodeSchema.index({ userId: 1, setId: 1, consumedAt: 1 });

export type RecoveryCodeDocument = InferSchemaType<typeof recoveryCodeSchema>;

export const RecoveryCodeModel: Model<RecoveryCodeDocument> =
  (mongoose.models.RecoveryCode as Model<RecoveryCodeDocument> | undefined) ??
  mongoose.model<RecoveryCodeDocument>('RecoveryCode', recoveryCodeSchema);
