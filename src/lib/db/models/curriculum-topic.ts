import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

import {
  blockIdSchema,
  priorityBandSchema,
  targetKindSchema,
  targetUnitSchema,
} from '@/lib/schemas/curriculum';

/**
 * One row of the workbook's curriculum sheet.
 *
 * A DEFINITION, never a state. Progress lives in its own collection keyed on
 * `stableKey`, so re-importing the workbook can rewrite every definition here
 * without touching a single thing the user has recorded about their own work.
 * Putting a status field on this document would make the import destructive,
 * and an import that can lose progress is one nobody dares re-run.
 */
const curriculumTopicSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },

    /**
     * block + module + topic + subTopic, slugged.
     *
     * The identity of a row across imports. Derived from what the row IS
     * rather than from where it sits, so inserting a row in the middle of the
     * sheet does not renumber everything below it.
     */
    stableKey: { type: String, required: true },

    blockId: { type: String, required: true, enum: blockIdSchema.options },
    /** The suffix of the sheet's Block column: "DSA", "Machine Coding", "Resume". */
    category: { type: String, required: true },
    module: { type: String, required: true },
    topic: { type: String, required: true },
    subTopic: { type: String, default: '' },

    resourceName: { type: String, default: '' },
    link: { type: String, default: '' },

    /**
     * The Practice / Output cell, VERBATIM.
     *
     * Never normalised and never rewritten by the parser. When the parse fails
     * -- which it does for a third of the sheet -- this is the only thing that
     * still says what the user actually meant to do.
     */
    practiceRaw: { type: String, default: '' },

    target: {
      kind: { type: String, required: true, enum: targetKindSchema.options },
      unit: { type: String, default: null, enum: [...targetUnitSchema.options, null] },
      targetMin: { type: Number, default: null },
      targetMax: { type: Number, default: null },
      needsReview: { type: Boolean, required: true },
      reviewReason: { type: String, default: null },
      /** True once a person has fixed the parse by hand. A re-import leaves it alone. */
      correctedByHand: { type: Boolean, default: false },
    },

    priority: { type: String, required: true, enum: priorityBandSchema.options },
    order: { type: Number, required: true },
  },
  { collection: 'curriculumtopics', versionKey: false },
);

curriculumTopicSchema.index({ ownerId: 1, stableKey: 1 }, { unique: true });
// The curriculum browser reads block, then module, then sheet order.
curriculumTopicSchema.index({ ownerId: 1, blockId: 1, order: 1 });
// The review list.
curriculumTopicSchema.index({ ownerId: 1, 'target.needsReview': 1 });

export type CurriculumTopicDocument = InferSchemaType<typeof curriculumTopicSchema>;

export const CurriculumTopicModel: Model<CurriculumTopicDocument> =
  (mongoose.models.CurriculumTopic as Model<CurriculumTopicDocument> | undefined) ??
  mongoose.model<CurriculumTopicDocument>('CurriculumTopic', curriculumTopicSchema);
