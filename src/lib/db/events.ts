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
    });

    return { appended: true, type: parsed.type };
  } catch (error) {
    if (isOncePerEntity(parsed.type) && isDuplicateKeyError(error)) {
      return { appended: false, type: parsed.type };
    }
    throw error;
  }
}

/** Reads one entity's history, oldest first. The behaviour engine's input. */
export async function readEntityEvents(
  entityId: string,
): Promise<{ ts: Date; type: EventType; payload: Record<string, unknown>; source: string }[]> {
  const rows = await EventModel.find({ entityId }).sort({ ts: 1 }).lean();

  return rows.map((row) => ({
    ts: row.ts,
    type: row.type as EventType,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    source: row.source,
  }));
}
