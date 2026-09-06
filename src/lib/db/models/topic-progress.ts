import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

import { topicStatusSchema } from '@/lib/schemas/curriculum';

/**
 * What the user has done with a topic.
 *
 * SEPARATE from the topic definition on purpose. The import rewrites
 * definitions; it must never be able to touch this. Keying on `stableKey`
 * rather than on the topic's `_id` means a definition can be deleted and
 * re-imported without orphaning the record of having studied it.
 *
 * `needs-revision` is a real status rather than "done with an asterisk". It is
 * what Sunday's review acts on, and what the final phase's "study only gaps
 * that appear" rule means -- neither of which can be expressed if a badly
 * finished topic is indistinguishable from a finished one.
 */
const topicProgressSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },
    stableKey: { type: String, required: true },

    status: { type: String, required: true, enum: topicStatusSchema.options },
    /** Private to the primary, like every other free-text note. */
    note: { type: String, default: '' },

    updatedAt: { type: Date, required: true, default: () => new Date() },
    /** First time this left `not-started`. Null until then. */
    startedAt: { type: Date, default: null },
    /** First time this reached `done`. Kept even if it later becomes needs-revision. */
    firstDoneAt: { type: Date, default: null },
  },
  { collection: 'topicprogress', versionKey: false },
);

topicProgressSchema.index({ ownerId: 1, stableKey: 1 }, { unique: true });
topicProgressSchema.index({ ownerId: 1, status: 1 });

export type TopicProgressDocument = InferSchemaType<typeof topicProgressSchema>;

export const TopicProgressModel: Model<TopicProgressDocument> =
  (mongoose.models.TopicProgress as Model<TopicProgressDocument> | undefined) ??
  mongoose.model<TopicProgressDocument>('TopicProgress', topicProgressSchema);
