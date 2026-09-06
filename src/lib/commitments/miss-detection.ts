import 'server-only';

import { isMissed } from '@/lib/behavior/miss';
import { appendEvent } from '@/lib/db/events';
import type { CommitmentStatus } from '@/lib/schemas/commitment';

interface MissCandidate {
  _id: unknown;
  dueAt: Date;
  status: CommitmentStatus;
}

/**
 * Records misses the moment a read notices them.
 *
 * There is no per-minute scheduler, and adding one for this would be
 * disproportionate -- Vercel Hobby allows a single daily cron, and a deadline
 * that passed at 14:03 should not wait until tomorrow to become a fact.
 *
 * So the read does it. Any surface that lists commitments passes what it
 * loaded through here; whichever request first observes the miss appends the
 * event, and the unique partial index on (entityId, DEADLINE_MISSED) makes
 * concurrent observers safe -- the losers get `appended: false`.
 *
 * When the notification tick arrives it will emit these proactively. The
 * derived read keeps working either way, because both paths funnel through
 * `appendEvent` and the same index: whoever gets there first wins, and it does
 * not matter which.
 */
export async function recordObservedMisses(
  commitments: readonly MissCandidate[],
  now: Date,
): Promise<number> {
  const missed = commitments.filter((c) => isMissed({ dueAt: c.dueAt, status: c.status }, now));
  if (missed.length === 0) return 0;

  // Appended in parallel: they are independent rows, and a list view can
  // easily notice a dozen misses at once.
  const results = await Promise.all(
    missed.map((commitment) =>
      appendEvent({
        type: 'DEADLINE_MISSED',
        entityType: 'commitment',
        entityId: String(commitment._id),
        /**
         * The timestamp is the DEADLINE, never the moment of emission.
         *
         * TWO separate things depend on this, and the second is not obvious:
         *
         * 1. Honesty. Emitting at "now" would record misses as happening
         *    whenever the user next opened the app, so the behaviour engine
         *    would read "you missed this at 09:00 on Sunday" for a deadline
         *    that passed on Friday afternoon.
         *
         * 2. UNIQUENESS. The index is unique on (entityId, type, ts). Because
         *    `ts` is the deadline, concurrent observers of the same miss all
         *    produce the same key and collapse to one row, while a genuinely
         *    different deadline produces a different key and records
         *    separately. Timestamp this at emission time instead and every
         *    observer gets a distinct `ts`: the index stops deduplicating and
         *    a single missed deadline is written once per read, forever.
         *
         * Changing this line silently breaks deduplication. See the test
         * "miss events are timestamped at the deadline" below, and the index
         * definition in src/lib/db/models/event.ts.
         */
        ts: commitment.dueAt,
        source: 'system',
        payload: { dueAt: commitment.dueAt.toISOString(), noticedAt: now.toISOString() },
      }),
    ),
  );

  return results.filter((result) => result.appended).length;
}
