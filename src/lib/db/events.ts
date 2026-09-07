import 'server-only';

import { EventModel } from '@/lib/db/models/event';
import {
  appendEventInputSchema,
  isOncePerEntity,
  type AppendEventInput,
  type EventType,
} from '@/lib/schemas/event';

/** Mongo's duplicate-key error. */
const DUPLICATE_KEY = 11_000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === DUPLICATE_KEY
  );
}

export interface AppendResult {
  /** False when a once-per-entity event was already present. */
  appended: boolean;
  type: EventType;
}

/**
 * The single write path into the event log.
 *
 * Every mutation in the app goes through here. Nothing else writes to the
 * `events` collection, and the model itself refuses updates and deletes, so
 * "append-only" is enforced by the code rather than remembered by the author.
 *
 * For once-per-entity types (currently DEADLINE_MISSED) a duplicate is not an
 * error: several concurrent serverless invocations can each notice the same
 * missed deadline, and exactly one of them wins the unique index. The losers
 * get `appended: false`, which is the correct outcome, not a failure. Checking
 * for existence first and inserting second would race between the two steps.
 */
export async function appendEvent(input: AppendEventInput): Promise<AppendResult> {
  const parsed = appendEventInputSchema.parse(input);

  try {
    await EventModel.create({
      ts: parsed.ts ?? new Date(),
      type: parsed.type,
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      payload: parsed.payload ?? {},
      source: parsed.source,
      ownerId: parsed.ownerId,
      // Only set on synthetic rows, so the field stays absent on real history
      // and the sparse index the purge uses stays small.
      ...(parsed.source === 'seed' ? { synthetic: true } : {}),
    });

    return { appended: true, type: parsed.type };
  } catch (error) {
    if (isOncePerEntity(parsed.type) && isDuplicateKeyError(error)) {
      return { appended: false, type: parsed.type };
    }
    throw error;
  }
}

/**
 * Appends many events in one round trip.
 *
 * Still the single write path: this lives in the same module as `appendEvent`
 * and nothing outside it touches the collection. The reason it exists is
 * materialisation, which creates a fortnight of occurrences at a time and was
 * paying two round trips per occurrence for its events alone. Against Atlas
 * M0 that is the difference between one request and forty.
 *
 * `ordered: false` so one rejected row does not abandon the rest. Duplicates of
 * a once-per-entity type are still success -- the same reasoning as
 * `appendEvent`, just reported per row rather than by throwing.
 */
export async function appendEvents(inputs: AppendEventInput[]): Promise<{
  appended: number;
  /** Rows a concurrent invocation had already written. Not a failure. */
  duplicates: number;
}> {
  if (inputs.length === 0) return { appended: 0, duplicates: 0 };

  const docs = inputs.map((input) => {
    const parsed = appendEventInputSchema.parse(input);

    return {
      ts: parsed.ts ?? new Date(),
      type: parsed.type,
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      payload: parsed.payload ?? {},
      source: parsed.source,
      ownerId: parsed.ownerId,
      ...(parsed.source === 'seed' ? { synthetic: true } : {}),
    };
  });

  try {
    await EventModel.insertMany(docs, { ordered: false });

    return { appended: docs.length, duplicates: 0 };
  } catch (error) {
    const rejected = writeErrorsOf(error);

    /**
     * Every rejection has to be a duplicate of a once-per-entity type, or this
     * is a real failure and must not be swallowed. A silently dropped event is
     * a hole in the only record that can answer "why does it say that?".
     */
    const notDuplicates = rejected.filter((entry) => entry.code !== DUPLICATE_KEY);
    if (rejected.length === 0 || notDuplicates.length > 0) throw error;

    return { appended: docs.length - rejected.length, duplicates: rejected.length };
  }
}

/** The per-row errors from a partially-rejected `insertMany`. */
function writeErrorsOf(error: unknown): { index: number; code: number }[] {
  const errors = (error as { writeErrors?: unknown }).writeErrors;
  if (!Array.isArray(errors)) return [];

  return errors.map((entry: unknown) => {
    const row = entry as { index?: number; code?: number; err?: { index?: number; code?: number } };

    return { index: row.index ?? row.err?.index ?? -1, code: row.code ?? row.err?.code ?? 0 };
  });
}

/** Reads one entity's history, oldest first. The behaviour engine's input. */
export async function readEntityEvents(
  entityId: string,
  ownerId: string,
): Promise<{ ts: Date; type: EventType; payload: Record<string, unknown>; source: string }[]> {
  // Scoped: an event id is guessable, and the log is the most sensitive read
  // in the system.
  const rows = await EventModel.find({ entityId, ownerId }).sort({ ts: 1 }).lean();

  return rows.map((row) => ({
    ts: row.ts,
    type: row.type as EventType,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    source: row.source,
  }));
}
