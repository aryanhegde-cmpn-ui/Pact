import 'server-only';

import { hashPassword } from '@/lib/auth/password';
import { UserModel } from '@/lib/db/models/user';
import { normaliseEmail } from '@/lib/schemas/user';

export const SEED_REFUSAL =
  'Refusing to seed: a user already exists.\n' +
  'This app has exactly one user, and overwriting silently would lock you out of\n' +
  'the existing account. Re-run with --force to reset that password:\n' +
  '  npm run seed:user -- --force';

export interface SeedResult {
  created: boolean;
  email: string;
  displayName: string;
}

/**
 * Creates the single user, or resets its password when `force` is set.
 *
 * Separated from `scripts/seed-user.ts` so the refusal rule is testable without
 * running the script as a subprocess.
 */
export async function seedUser(options: {
  email: string;
  password: string;
  displayName?: string;
  force?: boolean;
  now?: Date;
}): Promise<SeedResult> {
  const email = normaliseEmail(options.email);
  const displayName = options.displayName?.trim() || email.split('@')[0] || 'Owner';
  const now = options.now ?? new Date();

  const existing = await UserModel.countDocuments();

  // The guard is on "any user exists", not "this user exists": on a one-user
  // app, seeding a second address is as much a mistake as overwriting the first.
  if (existing > 0 && !options.force) {
    throw new Error(SEED_REFUSAL);
  }

  const passwordHash = await hashPassword(options.password);

  const result = await UserModel.updateOne(
    { email },
    {
      $set: { passwordHash, displayName },
      $setOnInsert: { role: 'owner', createdAt: now, lastLoginAt: null },
    },
    { upsert: true },
  );

  return { created: (result.upsertedCount ?? 0) > 0, email, displayName };
}
