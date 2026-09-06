import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

import { interviewCategorySchema } from '@/lib/schemas/curriculum';

/**
 * An interview rehearsal item.
 *
 * `rehearsalFrom` is the workbook's "Serious rehearsal from November", MODELLED
 * as a date the plan owns rather than expressed as a condition inside a
 * component. The difference matters: a date on the document can be read, shown
 * ("rehearsal opens 1 November"), moved by an explicit re-plan, and tested. An
 * `if (month >= 11)` in the UI is invisible, un-testable, and silently wrong
 * the first time the phase dates move.
 *
 * The sheet also says what to do BEFORE that date -- "keep collecting examples
 * and metrics from work now" -- so the gate hides rehearsal, never the item.
 */
const interviewPrepItemSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },
    stableKey: { type: String, required: true },

    category: { type: String, required: true, enum: interviewCategorySchema.options },
    topic: { type: String, required: true },
    whatToMaster: { type: String, default: '' },
    practice: { type: String, default: '' },

    /** Local date in APP_TIMEZONE. Before this, the item is collect-only. */
    rehearsalFrom: { type: String, required: true },
    order: { type: Number, required: true },
  },
  { collection: 'interviewprepitems', versionKey: false },
);

interviewPrepItemSchema.index({ ownerId: 1, stableKey: 1 }, { unique: true });

export type InterviewPrepItemDocument = InferSchemaType<typeof interviewPrepItemSchema>;

export const InterviewPrepItemModel: Model<InterviewPrepItemDocument> =
  (mongoose.models.InterviewPrepItem as Model<InterviewPrepItemDocument> | undefined) ??
  mongoose.model<InterviewPrepItemDocument>('InterviewPrepItem', interviewPrepItemSchema);
