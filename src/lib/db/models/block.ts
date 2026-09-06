import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

import { blockIdSchema, blockKindSchema } from '@/lib/schemas/curriculum';

/**
 * A daily window from the workbook's operating plan.
 *
 * Five rows: three study blocks, and the two evening rows. The evening rows
 * are stored rather than dropped because the generator has to know they exist.
 * "Workout + Rest" is listed as Priority, and a generator that cannot see it
 * will fill the evening with study and quietly make the plan the thing that
 * costs the user their sleep.
 */
const blockSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },
    blockId: { type: String, required: true, enum: blockIdSchema.options },

    label: { type: String, required: true, trim: true },
    area: { type: String, required: true, trim: true },
    /** The workbook's "Exact activity", verbatim. Becomes a commitment's outcome. */
    exactActivity: { type: String, required: true, trim: true },
    primaryResource: { type: String, default: '' },
    cadence: { type: String, default: '' },

    kind: { type: String, required: true, enum: blockKindSchema.options },

    /** Wall clock in APP_TIMEZONE. Null for the evening rows, which have no fixed time. */
    startTime: { type: String, default: null },
    endTime: { type: String, default: null },
    durationMinutes: { type: Number, default: null },

    order: { type: Number, required: true },

    /** The daily Series this block generates, once one exists. Null for non-study blocks. */
    seriesId: { type: String, default: null },
  },
  { collection: 'blocks', versionKey: false },
);

/** One row per block per owner, so a re-import updates rather than duplicates. */
blockSchema.index({ ownerId: 1, blockId: 1 }, { unique: true });

export type BlockDocument = InferSchemaType<typeof blockSchema>;

export const BlockModel: Model<BlockDocument> =
  (mongoose.models.Block as Model<BlockDocument> | undefined) ??
  mongoose.model<BlockDocument>('Block', blockSchema);
