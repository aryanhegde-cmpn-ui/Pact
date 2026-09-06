import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

/**
 * The User collection.
 *
 * `passwordHash` is `select: false`: a query has to ask for it explicitly, so
 * the hash cannot reach a response body by way of someone spreading a user
 * document into JSON.
 */
const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    /** The display form, as chosen. */
    username: { type: String, required: true, trim: true },
    /**
     * Lowercased, and the field every lookup and the unique index use.
     *
     * A normalised column rather than a collated index: it behaves the same
     * across drivers, survives dump and restore, and is visible in the
     * document. A collation applies only when a query asks for it and silently
     * degrades to case-sensitive when it does not -- which would let "Aryan"
     * and "aryan" both exist.
     */
    usernameLower: { type: String, required: true, unique: true, index: true },

    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true },
    role: { type: String, required: true, enum: ['primary', 'overseer'], default: 'primary' },

    /**
     * The primary this account's data belongs to.
     *
     * For a primary it is their own id; for an overseer it is the primary they
     * were invited by. Every other collection carries the same field, so a
     * query is scoped by one predicate regardless of who is asking.
     */
    ownerId: { type: String, default: null, index: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    lastLoginAt: { type: Date, default: null },
  },
  { collection: 'users', versionKey: false },
);

export type UserDocument = InferSchemaType<typeof userSchema>;

/**
 * Models are cached on the connection. Re-registering on hot reload throws
 * `OverwriteModelError`, so reuse an existing registration when there is one.
 */
export const UserModel: Model<UserDocument> =
  (mongoose.models.User as Model<UserDocument> | undefined) ??
  mongoose.model<UserDocument>('User', userSchema);
