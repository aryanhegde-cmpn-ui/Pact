/**
 * Migration: usernames, roles and ownership.
 *
 *   npm run db:migrate:identity
 *
 * Backfills, in order:
 *
 *   1. A username for every existing user, derived from their email.
 *   2. `role: 'primary'` where the old `owner`/`member` values were.
 *   3. `ownerId` on every scoped collection, pointing at the primary.
 *   4. `key` on login_attempts, which used to store a bare email.
 *
 * Idempotent, and a no-op once converged. Ownership is the important part: a
 * row with no `ownerId` matches no scoped query, so it becomes invisible
 * rather than leaking -- which is the right way round, but still means the
 * data is effectively gone until this runs.
 */
import './shell-env';
import './load-env';

import mongoose from 'mongoose';

import { describeUri } from '@/lib/db/guard-uri';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getEnv } from '@/lib/env';
import { normaliseUsername, RESERVED_USERNAMES } from '@/lib/schemas/user';

/** A username from an email local part, made legal and unreserved. */
function usernameFromEmail(email: string, taken: Set<string>): string {
  const base = normaliseUsername(email.split('@')[0] ?? 'user')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 20);

  let candidate = base.length >= 3 ? base : `user-${base}`.slice(0, 20);
  if (RESERVED_USERNAMES.includes(candidate)) candidate = `${candidate}-1`.slice(0, 20);

  let suffix = 1;
  while (taken.has(candidate)) {
    const trimmed = candidate.slice(0, 20 - String(suffix).length - 1);
    candidate = `${trimmed}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

async function main(): Promise<void> {
  const env = getEnv();
  await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error('Not connected.');

  console.log(`Target: ${describeUri(env.MONGODB_URI)}\n`);

  // ---- 1 & 2: usernames and roles ----------------------------------------
  const users = await db.collection('users').find({}).toArray();
  const taken = new Set(
    users.map((u) => u.usernameLower).filter((v): v is string => typeof v === 'string'),
  );

  let named = 0;
  let reroled = 0;

  for (const user of users) {
    const set: Record<string, unknown> = {};

    if (!user.username || !user.usernameLower) {
      const username = usernameFromEmail(String(user.email ?? 'user'), taken);
      taken.add(username);
      set.username = username;
      set.usernameLower = username;
      named += 1;
    }

    // 'owner' and 'member' predate the primary/overseer split.
    if (user.role !== 'primary' && user.role !== 'overseer') {
      set.role = 'primary';
      reroled += 1;
    }

    // A primary owns their own data.
    if (!user.ownerId) set.ownerId = String(user._id);

    if (Object.keys(set).length > 0) {
      await db.collection('users').updateOne({ _id: user._id }, { $set: set });
    }
  }

  console.log(`  users        ${named} named, ${reroled} re-roled`);

  // ---- 3: ownership -------------------------------------------------------
  const primaries = await db.collection('users').find({ role: 'primary' }).toArray();
  if (primaries.length === 0) {
    console.log('\n  No primary user; nothing to attribute ownership to.');
    return;
  }
  if (primaries.length > 1) {
    // Refusing beats guessing: attributing one person's history to another is
    // not something a later migration can undo.
    throw new Error(
      `Found ${primaries.length} primary users. This backfill cannot decide which owns the ` +
        'existing data. Attribute it by hand.',
    );
  }

  const ownerId = String(primaries[0]!._id);
  console.log(`\n  Attributing existing data to ${primaries[0]!.username ?? ownerId}\n`);

  for (const name of ['commitments', 'series', 'events', 'notifications', 'push_subscriptions']) {
    const result = await db
      .collection(name)
      .updateMany({ ownerId: { $exists: false } }, { $set: { ownerId } });
    console.log(`  ${name.padEnd(20)} ${result.modifiedCount ?? 0} rows`);
  }

  // Settings moved from a fixed 'singleton' key to one row per owner.
  const settings = await db
    .collection('settings')
    .updateMany({ ownerId: { $exists: false } }, { $set: { ownerId }, $unset: { key: '' } });
  console.log(`  ${'settings'.padEnd(20)} ${settings.modifiedCount ?? 0} rows`);

  // ---- 4: login attempts --------------------------------------------------
  /**
   * The counter used to key on a bare email. Old rows cannot be re-keyed
   * safely -- an email no longer identifies the counter -- and they expire on
   * their own via the TTL index, so they are dropped rather than translated.
   */
  const stale = await db.collection('login_attempts').deleteMany({ key: { $exists: false } });
  console.log(`  ${'login_attempts'.padEnd(20)} ${stale.deletedCount ?? 0} stale rows removed`);

  console.log('\nMigrated.');
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
