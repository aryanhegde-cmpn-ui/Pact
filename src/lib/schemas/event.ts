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
  /** A miss was answered: why it happened. */
  'RECKONING_SUBMITTED',
  /** What was chosen to change as a result. */
  'RECOVERY_ACTION_SELECTED',
  /** Work actually begun, from a recovery start-session. */
  'SESSION_SCHEDULED',
  'SERIES_CREATED',
  'SERIES_EDITED',
  'SERIES_ENDED',
  /** The workbook was imported. Records what changed, so a plan has provenance. */
  'CURRICULUM_IMPORTED',
  /** A topic moved between not-started, in-progress, done and needs-revision. */
  'TOPIC_PROGRESS_CHANGED',
  /** The day's suggested topic was swapped for another. A suggestion, never a lock. */
  'PLAN_TOPIC_OVERRIDDEN',
  /**
   * A phase's dates were moved, deliberately, with a reason.
   *
   * The ONLY way the schedule changes. Falling behind does not move it: see
   * `src/lib/behavior/drift.ts`, which computes the gap and writes nothing.
   */
  'PLAN_REPLANNED',
  /**
   * The backlog crossed the point where the dashboard stops helping.
   *
   * Recorded so an episode is visible in the history afterwards. Whether
   * recovery is currently ON is derived from the counts, never from these.
   */
  'RECOVERY_MODE_ENTERED',
  'RECOVERY_MODE_EXITED',
  // --- Focus sessions -----------------------------------------------------
  'SESSION_STARTED',
  'SESSION_ENDED',
  /**
   * Work happened and the thing is not finished.
   *
   * NOT a failure, anywhere: not in copy, not in adherence, not in any metric.
   * It is the honest report that an estimate was wrong, and an app that
   * penalises it teaches the user to stop reporting it -- at which point every
   * estimate in the history is fiction.
   */
  'PROGRESS_LOGGED',
  'TASK_BLOCKED',
  /** A research budget ran out and a decision was made about it. Once per session. */
  'RESEARCH_BUDGET_SPENT',
]);
export type EventType = z.infer<typeof eventTypeSchema>;

export const entityTypeSchema = z.enum([
  'commitment',
  'series',
  /** A curriculum topic, identified by its stable key rather than a row id. */
  'topic',
  /** The plan as a whole: imports and re-plans, which belong to no single row. */
  'plan',
  /** An episode of recovery mode, which belongs to no single commitment. */
  'recovery',
  /** One sitting of work. Its own entity, so its history survives the commitment's. */
  'session',
]);
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
  /** The primary this event belongs to. Every read filters on it. */
  ownerId: z.string().min(1),
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
 *
 * `RECKONING_SUBMITTED` is here for a different reason: a double submission,
 * from an impatient tap or a retried request, must not record the same miss
 * being answered twice. Both are keyed on (entityId, type, ts), and for both
 * `ts` is the MISSED DEADLINE rather than the moment of writing -- which is
 * what makes the key mean "this deadline", so a commitment missed, reckoned,
 * rescheduled and missed again correctly produces a second record.
 */
export const ONCE_PER_ENTITY: readonly EventType[] = ['DEADLINE_MISSED', 'RECKONING_SUBMITTED'];

export function isOncePerEntity(type: EventType): boolean {
  return ONCE_PER_ENTITY.includes(type);
}
