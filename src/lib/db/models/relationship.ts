import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

/**
 * The Overseer arrangement, as its own collection.
 *
 * Deliberately NOT a field on User. A foreign key would record only the
 * current state: who is watching whom right now. This records the arrangement
 * itself -- when it started, whether it was revoked, and when -- so the
 * history survives the relationship ending.
 *
 * That matters because the arrangement is the thing being audited. "You had an
 * overseer for six weeks and then removed them" is a fact worth keeping, and a
 * nulled foreign key erases it.
 */
const relationshipSchema = new mongoose.Schema(
  {
    primaryUserId: { type: String, required: true, index: true },
    /** Null until the invite is redeemed. */
    overseerUserId: { type: String, default: null, index: true },

    /**
     * `pending` -> invited, not yet redeemed.
     * `active`  -> redeemed and in force.
     * `revoked` -> ended. Never deleted.
     */
    status: {
      type: String,
      required: true,
      enum: ['pending', 'active', 'revoked'],
      default: 'pending',
    },

    /**
     * The single-use invite token, stored hashed.
     *
     * Hashed because it is a bearer credential: anyone holding it can create an
     * account with read access to the primary's record. A database dump should
     * not hand that over.
     */
    inviteTokenHash: { type: String, default: null, index: true },
    inviteExpiresAt: { type: Date, default: null },
    /** Set when redeemed, so a consumed invite is visibly consumed. */
    redeemedAt: { type: Date, default: null },

    createdAt: { type: Date, required: true, default: () => new Date() },
    revokedAt: { type: Date, default: null },
  },
  { collection: 'relationships', versionKey: false },
);

/** The lookup every overseer request makes: "am I still active for this primary?" */
relationshipSchema.index({ overseerUserId: 1, status: 1 });

export type RelationshipDocument = InferSchemaType<typeof relationshipSchema>;

export const RelationshipModel: Model<RelationshipDocument> =
  (mongoose.models.Relationship as Model<RelationshipDocument> | undefined) ??
  mongoose.model<RelationshipDocument>('Relationship', relationshipSchema);
