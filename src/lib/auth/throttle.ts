import 'server-only';

import { createHash } from 'node:crypto';

import { LoginAttemptModel } from '@/lib/db/models/login-attempt';

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
 * The key a lockout counter is stored under.
 *
 * THIS IS THE SECURITY-CRITICAL PART.
 *
 * Keying on the submitted string is wrong. Once one account can be reached by
 * both a username and an email, "aryan" and "aryan@example.com" maintain
 * separate counters, and an attacker alternating between them gets twice the
 * attempt budget against one account. Add a third identifier later and it is
 * three times. The counter has to key on the thing being attacked, which is
 * the ACCOUNT, not the string used to name it.
 *
 * So: a resolved user gets `user:<id>`, regardless of which identifier was
 * typed.
 *
 * Identifiers that resolve to nobody still need a counter, or enumeration is
 * unlimited and free. They get `unknown:<hash>` — hashed so the collection is
 * not a list of guessed usernames and email addresses, which is exactly the
 * data an attacker was trying to obtain.
 *
 * The two namespaces cannot collide: `user:` ids and `unknown:` hashes are
 * disjoint by construction.
 */
export function lockoutKeyForUser(userId: string): string {
  return `user:${userId}`;
}

export function lockoutKeyForUnknown(identifier: string): string {
  const normalised = identifier.trim().toLowerCase();
  const digest = createHash('sha256').update(normalised).digest('hex').slice(0, 32);

  return `unknown:${digest}`;
}

/**
 * Whether this key is currently locked out.
 *
 * `now` is passed in rather than read from the clock so the behaviour is
 * deterministic and testable.
 */
export async function getLockoutState(key: string, now: Date): Promise<LockoutState> {
  const windowStart = new Date(now.getTime() - FAILURE_WINDOW_MS);

  const recent = await LoginAttemptModel.find({ key, attemptedAt: { $gte: windowStart } })
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
 * Records a failed attempt against a key.
 *
 * Called for unknown identifiers as well as wrong passwords. Recording only
 * real accounts would make the collection itself a list of valid identifiers,
 * and would let a caller infer existence from response timing.
 */
export async function recordFailedAttempt(key: string, now: Date): Promise<void> {
  await LoginAttemptModel.create({ key, attemptedAt: now });
}

/** Clears the failure history for a key. Called after a successful sign-in. */
export async function clearFailedAttempts(key: string): Promise<void> {
  await LoginAttemptModel.deleteMany({ key });
}
