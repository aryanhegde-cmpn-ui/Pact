import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

/**
 * One document per failed sign-in attempt, keyed by email.
 *
 * This lives in the database rather than in memory because serverless
 * invocations share no process: an in-process counter would reset on every cold
 * start and throttle nothing. See CLAUDE.md, "Deployment constraints".
 *
 * Rows are written for emails that do not exist, too. Skipping them would leak
 * which addresses are real through a timing or storage side channel.
 */
const loginAttemptSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    attemptedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'login_attempts', versionKey: false },
);

// Compound index: every read is "failures for this email since T".
loginAttemptSchema.index({ email: 1, attemptedAt: -1 });

/**
 * Mongo expires these on its own, so the collection cannot grow without bound
 * and no cron job is needed -- which matters on Hobby, where there is one
 * daily invocation to spend. The TTL is comfortably longer than the window the
 * lockout logic actually reads.
 */
loginAttemptSchema.index({ attemptedAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export type LoginAttemptDocument = InferSchemaType<typeof loginAttemptSchema>;

export const LoginAttemptModel: Model<LoginAttemptDocument> =
  (mongoose.models.LoginAttempt as Model<LoginAttemptDocument> | undefined) ??
  mongoose.model<LoginAttemptDocument>('LoginAttempt', loginAttemptSchema);
