import 'server-only';

import { LoginAttemptModel } from '@/lib/db/models/login-attempt';
import { normaliseEmail } from '@/lib/schemas/user';

/** Failures within the window that trigger a lockout. */
export const MAX_FAILURES = 10;

/** How far back failures are counted. */
export const FAILURE_WINDOW_MS = 60 * 60 * 1000;

/** How long a locked account stays locked. */
export const LOCKOUT_MS = 15 * 60 * 1000;

export interface LockoutState {
  locked: boolean;
  failures: number;
  /** When the lock lifts. Null when not locked. */
  lockedUntil: Date | null;
}

/**
 * Whether this email is currently locked out.
 *
 * `now` is passed in rather than read from the clock so the behaviour is
 * deterministic and testable -- the same rule the behaviour analysis follows.
 */
export async function getLockoutState(email: string, now: Date): Promise<LockoutState> {
  const key = normaliseEmail(email);
  const windowStart = new Date(now.getTime() - FAILURE_WINDOW_MS);

  const recent = await LoginAttemptModel.find({ email: key, attemptedAt: { $gte: windowStart } })
    .sort({ attemptedAt: -1 })
    .limit(MAX_FAILURES)
    .lean();

  if (recent.length < MAX_FAILURES) {
    return { locked: false, failures: recent.length, lockedUntil: null };
  }

  // Locked for LOCKOUT_MS after the failure that crossed the threshold, not
  // after the first one -- otherwise the lock could already have expired by the
  // time it was applied.
  const newest = recent[0]?.attemptedAt;
  if (!newest) {
    return { locked: false, failures: recent.length, lockedUntil: null };
  }

  const lockedUntil = new Date(newest.getTime() + LOCKOUT_MS);
  if (lockedUntil <= now) {
    return { locked: false, failures: recent.length, lockedUntil: null };
  }

  return { locked: true, failures: recent.length, lockedUntil };
}

/**
 * Records a failed attempt.
 *
 * Called for unknown emails as well as wrong passwords. Recording only real
 * accounts would make the collection itself a list of valid addresses, and
 * would let a caller infer existence from response timing.
 */
export async function recordFailedAttempt(email: string, now: Date): Promise<void> {
  await LoginAttemptModel.create({ email: normaliseEmail(email), attemptedAt: now });
}

/** Clears the failure history for an email. Called after a successful sign-in. */
export async function clearFailedAttempts(email: string): Promise<void> {
  await LoginAttemptModel.deleteMany({ email: normaliseEmail(email) });
}
