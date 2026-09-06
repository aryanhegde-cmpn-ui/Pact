import 'server-only';

import mongoose from 'mongoose';

import { hashPassword } from '@/lib/auth/password';
import { UserModel } from '@/lib/db/models/user';
import { normaliseEmail, normaliseUsername, usernameSchema } from '@/lib/schemas/user';

export const SEED_REFUSAL =
  'Refusing to seed: a user already exists.\n' +
  'This app has exactly one user, and overwriting silently would lock you out of\n' +
  'the existing account. Re-run with --force to reset that password:\n' +
  '  npm run seed:user -- --force';

export interface SeedResult {
  created: boolean;
  email: string;
  username: string;
  displayName: string;
  /** True when --force repaired a row written before usernames and roles. */
  repaired: boolean;
}

/**
 * A username derived from the email's local part.
 *
 * Only a fallback. It exists so seeding does not require a second variable to
 * be set, and it is validated like any other username rather than trusted --
 * an address whose local part cannot make a legal username is an error the
 * operator has to resolve, not something to silently mangle.
 */
function defaultUsername(email: string): string {
  return (email.split('@')[0] ?? '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
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
  username?: string;
  displayName?: string;
  force?: boolean;
  now?: Date;
}): Promise<SeedResult> {
  const email = normaliseEmail(options.email);
  const displayName = options.displayName?.trim() || email.split('@')[0] || 'Owner';
  const now = options.now ?? new Date();

  const parsed = usernameSchema.safeParse(options.username?.trim() || defaultUsername(email));
  if (!parsed.success) {
    throw new Error(
      `Cannot seed a user.\n  username: ${parsed.error.issues[0]?.message ?? 'invalid'}\n` +
        'Set SEED_USER_USERNAME to choose one explicitly.',
    );
  }
  const username = parsed.data;

  const existing = await UserModel.countDocuments();

  // The guard is on "any user exists", not "this user exists": on a one-user
  // app, seeding a second address is as much a mistake as overwriting the first.
  if (existing > 0 && !options.force) {
    throw new Error(SEED_REFUSAL);
  }

  const passwordHash = await hashPassword(options.password);

  /**
   * The id is generated here so `ownerId` can be set in the same insert.
   *
   * Every collection is scoped by `ownerId`, and for a primary that is their
   * own id -- so the field cannot be filled in by a second write without
   * leaving a window in which the account owns nothing, including itself.
   */
  const id = new mongoose.Types.ObjectId();

  const result = await UserModel.updateOne(
    { email },
    {
      $set: { passwordHash, displayName },
      $setOnInsert: {
        _id: id,
        username,
        usernameLower: normaliseUsername(username),
        role: 'primary',
        ownerId: String(id),
        createdAt: now,
        lastLoginAt: null,
      },
    },
    { upsert: true },
  );

  const created = (result.upsertedCount ?? 0) > 0;

  /**
   * --force also repairs, not just resets the password.
   *
   * Accounts seeded before usernames and roles existed have no `usernameLower`
   * and a `role` outside the enum, so they cannot sign in by username and fail
   * every capability check. They were written through `updateOne`, which does
   * not validate, so nothing caught it at the time. Backfilling on the one
   * command an operator already reaches for beats a single-use migration.
   */
  let repaired = false;
  if (!created) {
    const existingRow = await UserModel.findOne({ email }).lean();
    if (existingRow) {
      const patch: Record<string, unknown> = {};
      if (!existingRow.usernameLower) {
        patch.username = username;
        patch.usernameLower = normaliseUsername(username);
      }
      if (existingRow.role !== 'primary' && existingRow.role !== 'overseer') {
        patch.role = 'primary';
      }
      if (!existingRow.ownerId) patch.ownerId = String(existingRow._id);

      if (Object.keys(patch).length > 0) {
        await UserModel.updateOne({ _id: existingRow._id }, { $set: patch });
        repaired = true;
      }
    }
  }

  return { created, email, username, displayName, repaired };
}
