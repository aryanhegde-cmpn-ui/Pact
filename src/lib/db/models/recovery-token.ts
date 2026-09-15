import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

import { RECOVERY_TOKEN_PURPOSE } from '@/lib/schemas/account-recovery';

/**
 * The single-purpose token issued between proving a code and setting a password.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT A SESSION, AND MUST NEVER BECOME ONE.
 * ---------------------------------------------------------------------------
 * It is a row in a collection that exactly one route reads. It authenticates
 * nothing: `currentActor()` has never heard of it, no middleware consults it,
 * and it is carried in a request body rather than a cookie so a browser cannot
 * attach it to anything by accident.
 *
 * The alternative -- signing the user in after the code check, then letting
 * them change their password like anyone else -- is the shape that goes wrong.
 * It hands a full session to someone who has proved they hold a code and
 * nothing else, and if they wander off at that point the session stays.
 *
 * `purpose` is an enum with one member rather than an implicit "tokens are for
 * passwords". The next purpose has to be named, and the reset route checks for
 * this exact value.
 * ---------------------------------------------------------------------------
 */
const recoveryTokenSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },

    /**
     * SHA-256 of the token. Stored hashed because it is a bearer credential:
     * holding it is the whole authorisation, so a database dump must not
     * contain usable ones.
     *
     * Not argon2, unlike the codes. A 32-byte random token has no entropy
     * problem to compensate for, and this is looked up by equality on every
     * reset -- which a deliberately slow hash cannot be.
     */
    tokenHash: { type: String, required: true, unique: true },

    /** The code this token was minted from, consumed when the reset succeeds. */
    codeId: { type: String, required: true },

    purpose: {
      type: String,
      required: true,
      enum: [RECOVERY_TOKEN_PURPOSE],
      default: RECOVERY_TOKEN_PURPOSE,
    },

    createdAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    /** Set by the reset that used it. A second attempt finds it non-null. */
    consumedAt: { type: Date, default: null },
  },
  { collection: 'recovery_tokens', versionKey: false },
);

/**
 * Swept a day after issue.
 *
 * The token is useless after ten minutes; the row is kept a little longer only
 * so a consumed one is still visibly consumed while anyone is looking. Nothing
 * audits this collection -- the event log does that -- so there is no reason
 * to accumulate spent bearer tokens indefinitely.
 */
recoveryTokenSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export type RecoveryTokenDocument = InferSchemaType<typeof recoveryTokenSchema>;

export const RecoveryTokenModel: Model<RecoveryTokenDocument> =
  (mongoose.models.RecoveryToken as Model<RecoveryTokenDocument> | undefined) ??
  mongoose.model<RecoveryTokenDocument>('RecoveryToken', recoveryTokenSchema);
