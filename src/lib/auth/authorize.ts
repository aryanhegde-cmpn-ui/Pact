import 'server-only';

import { verifyPassword } from '@/lib/auth/password';
import { clearFailedAttempts, getLockoutState, recordFailedAttempt } from '@/lib/auth/throttle';
import { UserModel } from '@/lib/db/models/user';
import { connectToDatabase } from '@/lib/db/mongoose';
import { credentialsSchema, normaliseEmail } from '@/lib/schemas/user';

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
 * Wrong password, unknown email and locked-out account are indistinguishable on
 * purpose: a caller must not be able to use sign-in to discover which addresses
 * have accounts. Do not add a "your account is locked" variant, however much
 * friendlier it reads -- it turns the endpoint into an oracle.
 */
export const GENERIC_AUTH_ERROR = 'Email or password is incorrect.';

export interface AuthorizedUser {
  id: string;
  email: string;
  name: string;
  role: string;
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

  const email = normaliseEmail(parsed.data.email);
  await connectToDatabase();

  // Checked before the password so a locked account cannot be brute-forced by
  // continuing to guess.
  const lockout = await getLockoutState(email, now);
  if (lockout.locked) {
    return null;
  }

  const user = await UserModel.findOne({ email }).select('+passwordHash').lean();

  if (!user) {
    // Recorded even though there is no account: skipping it would make an
    // unknown email measurably cheaper than a wrong password.
    await recordFailedAttempt(email, now);
    return null;
  }

  const valid = await verifyPassword(user.passwordHash, parsed.data.password);
  if (!valid) {
    await recordFailedAttempt(email, now);
    return null;
  }

  await clearFailedAttempts(email);
  await UserModel.updateOne({ _id: user._id }, { $set: { lastLoginAt: now } });

  return {
    id: String(user._id),
    email: user.email,
    name: user.displayName,
    role: user.role,
  };
}
