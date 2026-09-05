import 'server-only';

import mongoose, { type InferSchemaType, type Model } from 'mongoose';

import { entityTypeSchema, eventSourceSchema, eventTypeSchema } from '@/lib/schemas/event';

/**
 * The event log. Append-only, and structurally so.
 *
 * CLAUDE.md: "Events are append-only. Never update an event. Never delete one.
 * A correction is a new event." The hooks below make that a runtime error
 * rather than a rule someone has to remember, because the log's whole value is
 * that it can be trusted to answer "why does it say that?" -- and a log that
 * can be edited answers nothing.
 *
 * `appendEvent()` in src/lib/db/events.ts is the only write path.
 */
const eventSchema = new mongoose.Schema(
  {
    ts: { type: Date, required: true, default: () => new Date() },
    type: { type: String, required: true, enum: eventTypeSchema.options },
    entityType: { type: String, required: true, enum: entityTypeSchema.options },
    entityId: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    source: { type: String, required: true, enum: eventSourceSchema.options },
  },
  { collection: 'events', versionKey: false },
);

// Reading the log for one entity, newest first, is the common query.
eventSchema.index({ entityId: 1, ts: -1 });
// The behaviour engine reads by type across a time window.
eventSchema.index({ type: 1, ts: -1 });

/**
 * At most one DEADLINE_MISSED per commitment.
 *
 * A partial index rather than a plain compound one, because every other event
 * type may legitimately repeat -- a deadline can be changed many times.
 *
 * This is what makes lazy miss detection safe: concurrent serverless
 * invocations all notice the same miss and all try to append. The second write
 * fails with a duplicate-key error, which `appendEvent` treats as success.
 * Checking first and writing second would race.
 */
eventSchema.index(
  { entityId: 1, type: 1 },
  { unique: true, partialFilterExpression: { type: 'DEADLINE_MISSED' } },
);

const APPEND_ONLY =
  'The event log is append-only. A correction is a new event, never an edit. ' +
  'See CLAUDE.md, "Event log rule".';

// Every mutation Mongoose can route through a document or query hook.
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const) {
  eventSchema.pre(op, function reject() {
    throw new Error(`${APPEND_ONLY} (blocked: ${op})`);
  });
}

// `doc.save()` on an already-persisted document is an update in disguise.
// Async rather than callback style: Mongoose's `pre(method, options, fn)`
// overload otherwise captures the second argument and mistypes it.
eventSchema.pre('save', async function rejectResave() {
  if (!this.isNew) {
    throw new Error(`${APPEND_ONLY} (blocked: save on an existing document)`);
  }
});

export type EventDocument = InferSchemaType<typeof eventSchema>;

export const EventModel: Model<EventDocument> =
  (mongoose.models.Event as Model<EventDocument> | undefined) ??
  mongoose.model<EventDocument>('Event', eventSchema);
