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
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true },
    role: { type: String, required: true, enum: ['owner', 'member'], default: 'owner' },
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
