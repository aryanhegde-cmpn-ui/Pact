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
        // The event's timestamp is the DEADLINE, not the moment a read
        // happened to notice. Otherwise the log would record misses as
        // occurring whenever the user next opened the app, and the behaviour
        // engine would read "you missed this at 09:00 on Sunday" for a
        // deadline that passed on Friday afternoon.
        ts: commitment.dueAt,
        source: 'system',
        payload: { dueAt: commitment.dueAt.toISOString(), noticedAt: now.toISOString() },
      }),
    ),
  );

  return results.filter((result) => result.appended).length;
}
