import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

/**
 * A phase of the plan.
 *
 * ---------------------------------------------------------------------------
 * NO DERIVED PROGRESS FIELD.
 * ---------------------------------------------------------------------------
 * There is no `percentComplete`, no `topicsDone`, no `driftDays`. Drift is
 * computed on read from topic progress and the clock, by a pure function in
 * `src/lib/behavior/drift.ts`. It changes with the date, not with a write, so
 * storing it would mean a number that is correct only until midnight -- the
 * same reason `isMissed` is not a column on a commitment.
 * ---------------------------------------------------------------------------
 *
 * `startDate` and `endDate` are the SCHEDULE. They move only through an
 * explicit re-plan, which records an event with a reason. Nothing re-flows
 * them because the user fell behind: that is the study-plan version of
 * silently moving a deadline.
 */
const phaseSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },
    number: { type: Number, required: true },

    /** The workbook's own wording: "Sep 7-Sep 30", "October". */
    datesRaw: { type: String, required: true },
    /** Normalised local dates in APP_TIMEZONE, both inclusive. */
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },

    primaryFocus: { type: String, required: true },
    secondaryFocus: { type: String, required: true },
    outcome: { type: String, required: true },
    rule: { type: String, required: true },

    /**
     * What the focus text was understood to mean, derived once at import.
     *
     * Stored rather than recomputed on read so the guess is visible in the
     * document and can be corrected. A phase's focus is prose; matching prose
     * to category names is a guess, and a guess made invisibly at read time is
     * a hidden condition nobody can tell is wrong.
     */
    focusCategories: { type: [String], default: [] },
    focusModules: { type: [String], default: [] },
    revisionOnly: { type: Boolean, default: false },
    revisionBias: { type: Boolean, default: false },

    /** Set when a re-plan has moved this phase. Null while it stands as written. */
    replannedAt: { type: Date, default: null },
    /** The dates this phase was originally planned with. Written once. */
    originalStartDate: { type: String, required: true, immutable: true },
    originalEndDate: { type: String, required: true, immutable: true },
  },
  { collection: 'phases', versionKey: false },
);

phaseSchema.index({ ownerId: 1, number: 1 }, { unique: true });

export type PhaseDocument = InferSchemaType<typeof phaseSchema>;

export const PhaseModel: Model<PhaseDocument> =
  (mongoose.models.Phase as Model<PhaseDocument> | undefined) ??
  mongoose.model<PhaseDocument>('Phase', phaseSchema);
