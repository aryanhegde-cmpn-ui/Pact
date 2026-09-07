import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

import { rewardStatusSchema, triggerKindSchema } from '@/lib/schemas/stakes';

/**
 * Something an Overseer will give, once a condition is met.
 *
 * Configured only by the overseer, earned by the record, claimed by the
 * primary. Three separate moments, three separate timestamps, and none of them
 * settable by the person the reward is for.
 *
 * There is no points value, no tier and no rarity. The reward is a sentence
 * describing a real thing outside the app; the app's only contribution is
 * saying truthfully whether it has been earned.
 */
const rewardSchema = new mongoose.Schema(
  {
    /** The primary these stakes are about. Every query filters on it. */
    ownerId: { type: String, required: true, index: true },
    /** The overseer who configured it. Kept even after the relationship ends. */
    createdBy: { type: String, required: true },

    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },

    trigger: { type: String, required: true, enum: triggerKindSchema.options },
    triggerConfig: {
      thresholdRate: { type: Number, default: null },
      topicsDone: { type: Number, default: null },
    },

    status: {
      type: String,
      required: true,
      enum: rewardStatusSchema.options,
      default: 'available',
    },
    /** When the record said it was earned. Written by evaluation, never by hand. */
    earnedAt: { type: Date, default: null },
    /** When the primary said they had taken it. */
    claimedAt: { type: Date, default: null },

    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'rewards', versionKey: false },
);

rewardSchema.index({ ownerId: 1, status: 1 });

export type RewardDocument = InferSchemaType<typeof rewardSchema>;

export const RewardModel: Model<RewardDocument> =
  (mongoose.models.Reward as Model<RewardDocument> | undefined) ??
  mongoose.model<RewardDocument>('Reward', rewardSchema);
