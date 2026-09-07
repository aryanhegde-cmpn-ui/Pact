import 'server-only';

import { appendEvent } from '@/lib/db/events';
import { VacationModel } from '@/lib/db/models/vacation';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getEnv } from '@/lib/env';
import { toDateKey, type DateKey } from '@/lib/time';

/**
 * Vacation mode.
 *
 * ---------------------------------------------------------------------------
 * IT PAUSES EXPECTATIONS, NOT THE APP.
 * ---------------------------------------------------------------------------
 * Block commitments still materialise and can still be completed. What stops
 * is evaluation: no consequence activates, no adherence threshold is tested,
 * and no accountability notification fires.
 *
 * And it does not erase anything. Days spent on vacation leave the adherence
 * DENOMINATOR rather than entering it as misses -- counting them as kept would
 * flatter the record, counting them as missed would make the pressure valve
 * cost something, and a pressure valve that costs something is one nobody
 * pulls. "I am behind, so I will abandon the whole thing" is the failure this
 * exists to prevent.
 *
 * The primary controls it, deliberately. A vacation an overseer can veto is one
 * you route around by not opening the app, and an accountability tool nobody
 * opens reports nothing at all.
 * ---------------------------------------------------------------------------
 */

const DUPLICATE_KEY = 11_000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === DUPLICATE_KEY
  );
}

export interface VacationState {
  on: boolean;
  since: string | null;
  note: string;
}

export async function getVacationState(
  ownerId: string,
  now: Date = new Date(),
): Promise<VacationState> {
  await connectToDatabase();

  const open = await VacationModel.findOne({ ownerId, endedAt: null }).lean();
  void now;

  return {
    on: open !== null,
    since: open?.startedAt.toISOString() ?? null,
    note: open?.note ?? '',
  };
}

/**
 * Turns it on or off.
 *
 * Idempotent in both directions: asking for a state you are already in is a
 * double tap or a retried request, not an error, and definitely not a second
 * period in the history.
 */
export async function setVacation(
  input: { on: boolean; note?: string },
  ownerId: string,
  now: Date = new Date(),
): Promise<VacationState> {
  await connectToDatabase();

  const open = await VacationModel.findOne({ ownerId, endedAt: null }).lean();

  if (input.on) {
    if (open) return getVacationState(ownerId, now);

    try {
      const created = await VacationModel.create({
        ownerId,
        startedAt: now,
        endedAt: null,
        note: input.note ?? '',
      });

      await appendEvent({
        type: 'VACATION_STARTED',
        entityType: 'vacation',
        entityId: String(created._id),
        ownerId,
        ts: now,
        source: 'user',
        // The note is the primary's own and stays out of the log, like every
        // other free text -- the overseer's read model is built from events.
        payload: {},
      });
    } catch (error) {
      // Another tab won the unique index. That is success.
      if (!isDuplicateKeyError(error)) throw error;
    }

    return getVacationState(ownerId, now);
  }

  if (!open) return getVacationState(ownerId, now);

  const closed = await VacationModel.updateOne(
    { ownerId, _id: open._id, endedAt: null },
    { $set: { endedAt: now } },
  );

  // The conditional update makes this idempotent under concurrent requests:
  // exactly one closes the period, and only that one logs.
  if ((closed.modifiedCount ?? 0) > 0) {
    await appendEvent({
      type: 'VACATION_ENDED',
      entityType: 'vacation',
      entityId: String(open._id),
      ownerId,
      ts: now,
      source: 'user',
      payload: {
        startedAt: open.startedAt.toISOString(),
        days: Math.max(1, Math.round((now.getTime() - open.startedAt.getTime()) / 86_400_000)),
      },
    });
  }

  return getVacationState(ownerId, now);
}

/**
 * Local dates that fell inside any vacation period.
 *
 * Read from the periods rather than from a flag, which is the reason vacations
 * are stored as periods at all: the adherence figure for last month has to know
 * which days in it were paused, and a boolean on the user can only say whether
 * vacation is on right now.
 *
 * A day counts as paused if the vacation overlapped it at all. Half a day off
 * is a day the expectations were not in force.
 */
export async function vacationDaysBetween(
  ownerId: string,
  from: DateKey,
  to: DateKey,
): Promise<Set<DateKey>> {
  await connectToDatabase();

  const timeZone = getEnv().APP_TIMEZONE;
  const windowStart = new Date(`${from}T00:00:00.000Z`);
  // Widened by a day either side: the stored instants are UTC and the window is
  // local dates, so a period ending just after local midnight still covers it.
  const windowEnd = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 2 * 86_400_000);

  const periods = await VacationModel.find({
    ownerId,
    startedAt: { $lt: windowEnd },
    $or: [{ endedAt: null }, { endedAt: { $gte: windowStart } }],
  }).lean();

  const days = new Set<DateKey>();

  for (const period of periods) {
    const start = period.startedAt.getTime();
    const end = (period.endedAt ?? windowEnd).getTime();

    for (let at = start; at <= end; at += 86_400_000 / 4) {
      const key = toDateKey(new Date(at), timeZone);
      if (key >= from && key <= to) days.add(key);
    }
    // The last instant, so a period ending mid-day still marks that day.
    const endKey = toDateKey(new Date(end), timeZone);
    if (endKey >= from && endKey <= to) days.add(endKey);
  }

  return days;
}
