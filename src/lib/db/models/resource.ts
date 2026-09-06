import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

import { resourceTypeSchema } from '@/lib/schemas/curriculum';

/**
 * A resource: a POOL to draw from, not a course to finish.
 *
 * ---------------------------------------------------------------------------
 * FIELDS THAT ARE DELIBERATELY ABSENT, AND MUST STAY ABSENT
 * ---------------------------------------------------------------------------
 * `videosWatched`, `percentComplete`, `remaining`, `completedAt`, and anything
 * else that would let a playlist have a completion figure.
 *
 * The workbook says so twice. The curriculum sheet's own header line reads
 * "Playlist links are resource pools, not courses to finish end-to-end", and
 * the resource sheet repeats it per row: "Daily; don't finish as a course",
 * "Pick relevant videos only", "Pick weak topics only", "Reference, not daily
 * core".
 *
 * A completion percentage over a pool would turn "watch the two videos on the
 * thing you are weak at" into "get through 214 videos", which is the exact
 * substitution of tool-engagement for execution that this app exists to
 * prevent. There is a source-scanning test that fails if such a field or
 * calculation appears anywhere in src/.
 * ---------------------------------------------------------------------------
 */
const resourceSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },

    name: { type: String, required: true },
    type: { type: String, required: true, enum: resourceTypeSchema.options },
    use: { type: String, default: '' },
    link: { type: String, default: '' },
    /** The workbook's "How to use". Most of these say, in effect, do not finish it. */
    howToUse: { type: String, default: '' },
    order: { type: Number, required: true },
  },
  { collection: 'resources', versionKey: false },
);

resourceSchema.index({ ownerId: 1, name: 1 }, { unique: true });

export type ResourceDocument = InferSchemaType<typeof resourceSchema>;

export const ResourceModel: Model<ResourceDocument> =
  (mongoose.models.Resource as Model<ResourceDocument> | undefined) ??
  mongoose.model<ResourceDocument>('Resource', resourceSchema);
