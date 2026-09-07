import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

/**
 * A period with the expectations paused.
 *
 * ---------------------------------------------------------------------------
 * A PAUSE, NOT A LIE.
 * ---------------------------------------------------------------------------
 * Days inside a vacation are EXCLUDED from the adherence denominator. They are
 * not counted as kept, and they are not counted as missed. That distinction is
 * the whole feature: counting them as kept would make the record flatter, and
 * counting them as missed would make the pressure valve cost something -- at
 * which point nobody uses it, and "I am behind, so I will abandon the whole
 * thing" is back.
 *
 * A period rather than a flag on the user, so the exclusion is auditable after
 * the fact. A boolean would say only that vacation is on NOW; the adherence
 * figure for last month has to know which days in it were paused, and it can
 * only know that if the periods are still there.
 * ---------------------------------------------------------------------------
 */
const vacationSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },

    startedAt: { type: Date, required: true },
    /** Null while it is on. */
    endedAt: { type: Date, default: null },

    /** The primary's own note. Never included in the overseer's read model. */
    note: { type: String, default: '' },
  },
  { collection: 'vacations', versionKey: false },
);

/** One open period per owner. */
vacationSchema.index(
  { ownerId: 1 },
  { unique: true, partialFilterExpression: { endedAt: null }, name: 'ownerId_openVacation' },
);

vacationSchema.index({ ownerId: 1, startedAt: -1 });

export type VacationDocument = InferSchemaType<typeof vacationSchema>;

export const VacationModel: Model<VacationDocument> =
  (mongoose.models.Vacation as Model<VacationDocument> | undefined) ??
  mongoose.model<VacationDocument>('Vacation', vacationSchema);
