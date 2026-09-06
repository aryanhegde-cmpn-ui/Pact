import 'server-only';

import { verifyPassword } from '@/lib/auth/password';
import {
  clearFailedAttempts,
  getLockoutState,
  lockoutKeyForUnknown,
  lockoutKeyForUser,
  recordFailedAttempt,
} from '@/lib/auth/throttle';
import { UserModel } from '@/lib/db/models/user';
import { connectToDatabase } from '@/lib/db/mongoose';
import { credentialsSchema, looksLikeEmail, normaliseUsername } from '@/lib/schemas/user';

/**
 * Credential verification, deliberately independent of Auth.js.
 *
 * Keeping this out of the module that calls `NextAuth()` means the security
 * behaviour can be tested directly, without pulling the framework (and
 * `next/server`) into a plain Node test process.
 */

/**
 * One message for every failure mode.
 *
 * Unknown username, unknown email, wrong password and locked-out account are
 * indistinguishable on purpose: a caller must not be able to use sign-in to
 * discover which usernames or addresses have accounts. Do not add a "your
 * account is locked" variant, however much friendlier it reads -- it turns the
 * endpoint into an oracle.
 */
export const GENERIC_AUTH_ERROR = 'Username or password is incorrect.';

export interface AuthorizedUser {
  id: string;
  email: string;
  username: string;
  name: string;
  role: string;
  /** The primary whose data this session may touch. */
  ownerId: string;
}

/**
 * Returns the session user on success, or null for every kind of failure.
 *
 * `now` is injected so lockout behaviour is deterministic under test.
 */
export async function authorizeCredentials(
  raw: unknown,
  now: Date = new Date(),
): Promise<AuthorizedUser | null> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  const identifier = parsed.data.identifier.trim();
  await connectToDatabase();

  /**
   * Resolve the identifier BEFORE checking the lockout.
   *
   * The counter keys on the account, not the string, so it cannot be looked up
   * until we know which account is being attacked. `looksLikeEmail` only
   * chooses which field to query -- it never changes the outcome, so an
   * unknown email and an unknown username are indistinguishable to the caller.
   */
  const user = looksLikeEmail(identifier)
    ? await UserModel.findOne({ email: identifier.toLowerCase() }).select('+passwordHash').lean()
    : await UserModel.findOne({ usernameLower: normaliseUsername(identifier) })
        .select('+passwordHash')
        .lean();

  const key = user ? lockoutKeyForUser(String(user._id)) : lockoutKeyForUnknown(identifier);

  // Checked before the password so a locked account cannot be brute-forced by
  // continuing to guess, and so lockout costs an attacker the same either way.
  const lockout = await getLockoutState(key, now);
  if (lockout.locked) {
    return null;
  }

  if (!user) {
    // Recorded even though there is no account: skipping it would make an
    // unknown identifier measurably cheaper than a wrong password, and would
    // leave enumeration unbounded.
    await recordFailedAttempt(key, now);
    return null;
  }

  const valid = await verifyPassword(user.passwordHash, parsed.data.password);
  if (!valid) {
    await recordFailedAttempt(key, now);
    return null;
  }

  await clearFailedAttempts(key);
  await UserModel.updateOne({ _id: user._id }, { $set: { lastLoginAt: now } });

  return {
    id: String(user._id),
    email: user.email,
    username: user.username,
    name: user.displayName,
    role: user.role,
    // A primary owns their own data; an overseer is scoped to the primary who
    // invited them.
    ownerId: user.ownerId ?? String(user._id),
  };
}
