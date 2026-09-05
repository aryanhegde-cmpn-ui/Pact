import { OPEN_STATUSES, type CommitmentStatus } from '@/lib/schemas/commitment';

/**
 * Miss detection, as a pure function over one commitment.
 *
 * No I/O, no database, no `fetch`, and `now` is an argument rather than a read
 * of the clock -- the convention every module under src/lib/behavior follows,
 * so the analysis stays deterministic and testable.
 *
 * There is no `isMissed` column, and there must never be one. A commitment
 * becomes missed by the passage of time, with nothing writing to it; a stored
 * flag would be wrong the moment the deadline passed and stay wrong until
 * something happened to touch the row.
 */
export interface MissInput {
  dueAt: Date;
  status: CommitmentStatus;
}

/** True when the deadline has passed and the commitment is still open. */
export function isMissed(commitment: MissInput, now: Date): boolean {
  if (!OPEN_STATUSES.includes(commitment.status)) return false;

  return now.getTime() > commitment.dueAt.getTime();
}

/**
 * How long a commitment has been overdue, in whole minutes. Zero when not missed.
 *
 * Computed rather than stored for the same reason as `isMissed`: it changes
 * with the clock, not with a write.
 */
export function minutesOverdue(commitment: MissInput, now: Date): number {
  if (!isMissed(commitment, now)) return 0;

  return Math.floor((now.getTime() - commitment.dueAt.getTime()) / 60_000);
}
