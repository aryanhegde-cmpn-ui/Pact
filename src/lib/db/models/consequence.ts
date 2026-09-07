import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

import {
  consequenceStatusSchema,
  dischargeKindSchema,
  MAX_CONSEQUENCE_WINDOW_DAYS,
  triggerKindSchema,
} from '@/lib/schemas/stakes';

/**
 * Something an Overseer withholds, until the work is put right.
 *
 * ---------------------------------------------------------------------------
 * ONE ACTIVE AT A TIME, ENFORCED BY THE INDEX.
 * ---------------------------------------------------------------------------
 * A second trigger while one is active extends nothing and queues nothing. It
 * is recorded as suppressed and dropped.
 *
 * That is the rule that stops a bad week compounding into a state nobody can
 * recover from. Two stacked consequences are not twice the motivation; they
 * are the point at which the arrangement stops feeling survivable, and an
 * arrangement that stops feeling survivable gets abandoned rather than
 * satisfied.
 *
 * A unique partial index rather than a check-then-write, for the same reason
 * every other uniqueness rule here is an index: two concurrent evaluations can
 * both observe no active consequence at the same instant.
 * ---------------------------------------------------------------------------
 */
const consequenceSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },
    createdBy: { type: String, required: true },

    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },

    trigger: { type: String, required: true, enum: triggerKindSchema.options },
    triggerConfig: {
      thresholdRate: { type: Number, default: null },
      topicsDone: { type: Number, default: null },
    },

    /**
     * How long it runs once triggered, capped in the schema.
     *
     * A cap enforced only in the form is a cap the API does not have.
     */
    windowDays: { type: Number, required: true, min: 1, max: MAX_CONSEQUENCE_WINDOW_DAYS },

    status: {
      type: String,
      required: true,
      enum: consequenceStatusSchema.options,
      default: 'pending',
    },
    activatedAt: { type: Date, default: null },
    dischargedAt: { type: Date, default: null },
    /** Set on activation, from `windowDays`. An undischarged consequence is not permanent. */
    expiresAt: { type: Date, default: null },

    /**
     * What ends it early.
     *
     * Tied to what triggered it, satisfied by doing the work, and never by
     * dismissal -- there is no route that clears one on request.
     */
    dischargeCondition: {
      kind: { type: String, required: true, enum: dischargeKindSchema.options },
      thresholdRate: { type: Number, default: null },
      commitmentId: { type: String, default: null },
      topicsDone: { type: Number, default: null },
    },

    /**
     * Why it fired, in words, written at activation.
     *
     * Required by the surface: a consequence with no visible cause is
     * arbitrary, and arbitrary stakes get ignored rather than met.
     */
    activationReason: { type: String, default: null },

    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'consequences', versionKey: false },
);

/**
 * One active consequence per owner.
 *
 * Named explicitly: `ownerId` is also indexed plainly for scoped reads, and two
 * indexes on the same key would both auto-generate `ownerId_1` and collide at
 * sync time.
 */
consequenceSchema.index(
  { ownerId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'ownerId_activeConsequence',
  },
);

consequenceSchema.index({ ownerId: 1, status: 1 });

export type ConsequenceDocument = InferSchemaType<typeof consequenceSchema>;

export const ConsequenceModel: Model<ConsequenceDocument> =
  (mongoose.models.Consequence as Model<ConsequenceDocument> | undefined) ??
  mongoose.model<ConsequenceDocument>('Consequence', consequenceSchema);
