import { z } from 'zod';

/**
 * The event log's vocabulary.
 *
 * Exhaustive on purpose: later work extends THIS enum rather than inventing a
 * string at a call site. An event type that exists only as a literal somewhere
 * is invisible to the behaviour engine, which reads the log by type.
 */
export const eventTypeSchema = z.enum([
  'COMMITMENT_CREATED',
  'COMMITMENT_EDITED',
  'COMMITMENT_ABANDONED',
  'DEADLINE_SET',
  'DEADLINE_CHANGED',
  'DEADLINE_MISSED',
  'COMMITMENT_STARTED',
  'COMMITMENT_COMPLETED',
  'SERIES_CREATED',
  'SERIES_EDITED',
  'SERIES_ENDED',
]);
export type EventType = z.infer<typeof eventTypeSchema>;

export const entityTypeSchema = z.enum(['commitment', 'series']);
export type EntityType = z.infer<typeof entityTypeSchema>;

/**
 * Who caused the event.
 *
 * `system` covers anything the app derived without the user acting -- a
 * lazily-detected miss, for instance. Keeping it distinct from `user` means the
 * behaviour engine can tell "you abandoned this" from "the clock ran out",
 * which are very different facts about the same person.
 */
export const eventSourceSchema = z.enum(['user', 'system', 'seed']);
export type EventSource = z.infer<typeof eventSourceSchema>;

export const eventSchema = z.object({
  ts: z.date(),
  type: eventTypeSchema,
  entityType: entityTypeSchema,
  entityId: z.string().min(1),
  /** Type-specific detail. Deliberately loose: events are historical facts and
   *  their payload shape must be free to differ per type and across versions. */
  payload: z.record(z.string(), z.unknown()).default({}),
  source: eventSourceSchema,
});
export type PactEvent = z.infer<typeof eventSchema>;

/** The argument shape for `appendEvent`. `ts` defaults to now at the call site. */
export const appendEventInputSchema = eventSchema.extend({
  ts: z.date().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type AppendEventInput = z.infer<typeof appendEventInputSchema>;

/**
 * Event types that must appear at most once per entity.
 *
 * `DEADLINE_MISSED` is appended lazily, by whichever read first notices the
 * deadline has passed. Several serverless invocations can notice at the same
 * instant, so uniqueness is enforced by an index in the database rather than by
 * checking first and writing second, which races.
 */
export const ONCE_PER_ENTITY: readonly EventType[] = ['DEADLINE_MISSED'];

export function isOncePerEntity(type: EventType): boolean {
  return ONCE_PER_ENTITY.includes(type);
}
