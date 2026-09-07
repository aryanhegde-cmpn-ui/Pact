/**
 * Provisions the recovery fixture: an account already past the thresholds.
 *
 *   npm run seed:recovery                 make sure it exists
 *   npm run seed:recovery -- --reset      tear it down and rebuild it
 *
 * ---------------------------------------------------------------------------
 * WHY A THIRD ACCOUNT
 * ---------------------------------------------------------------------------
 * Recovery mode replaces the dashboard outright, which makes it the one screen
 * that cannot be tested on the account every other spec uses: pushing the
 * primary over the thresholds would replace the dashboard for `today.spec.ts`,
 * the motion suite and the responsive sweep at the same time.
 *
 * It was recorded as uncoverable for exactly that reason. It is not
 * uncoverable, it is a fixture problem -- the same one the overseer's pages
 * had -- so it gets the same answer: an account of its own, seeded into the
 * state the screen exists for, with its own storage state.
 *
 * The rows are `synthetic: true` and the account is deleted on `--reset`, so
 * this refuses to run anywhere but a scratch database.
 * ---------------------------------------------------------------------------
 */
import './load-env';

import mongoose from 'mongoose';

import { hashPassword } from '@/lib/auth/password';
import { assertSafeToMutate, describeUri } from '@/lib/db/guard-uri';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { UserModel } from '@/lib/db/models/user';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getEnv } from '@/lib/env';
import { RECOVERY_THRESHOLDS } from '@/lib/schemas/recovery';

/**
 * Fixed, so the specs can sign in without being told. Not a secret: it only
 * ever exists in a scratch database, and the guard refuses anywhere else.
 */
export const RECOVERY_FIXTURE = {
  username: 'behind1',
  email: 'behind@example.test',
  password: 'BehindPass2026x',
  displayName: 'Behind',
} as const;

/**
 * Comfortably over, not exactly on it.
 *
 * A fixture sitting on the boundary flips to green the moment somebody changes
 * a `>` to a `>=`, and the failure looks like a broken page rather than a
 * changed rule.
 */
const OVERDUE_COUNT = RECOVERY_THRESHOLDS.overdue + 5;

async function main(): Promise<void> {
  const env = getEnv();
  const reset = process.argv.includes('--reset');

  await connectToDatabase();
  assertSafeToMutate(env.MONGODB_URI, 'seed:recovery');

  console.log(`\nProvisioning the recovery fixture on ${describeUri(env.MONGODB_URI)}\n`);

  const existing = await UserModel.findOne({ usernameLower: RECOVERY_FIXTURE.username }).lean();

  if (existing && !reset) {
    console.log('  Already provisioned. Pass --reset to rebuild it.');
    console.log(`  ${RECOVERY_FIXTURE.username} / ${RECOVERY_FIXTURE.password}\n`);
    await mongoose.disconnect();
    return;
  }

  if (existing) {
    const ownerId = String(existing._id);
    const removed = await CommitmentModel.deleteMany({ ownerId, synthetic: true });
    await UserModel.deleteOne({ _id: existing._id });
    console.log(`  Cleared the account and ${removed.deletedCount ?? 0} synthetic commitments.`);
  }

  /**
   * The id is generated here so `ownerId` goes in the same insert. Every
   * scoped collection filters on it, and a second write to fill it in leaves a
   * window where the account owns nothing, including itself.
   */
  const id = new mongoose.Types.ObjectId();
  const ownerId = String(id);

  await UserModel.create({
    _id: id,
    email: RECOVERY_FIXTURE.email,
    username: RECOVERY_FIXTURE.username,
    usernameLower: RECOVERY_FIXTURE.username,
    passwordHash: await hashPassword(RECOVERY_FIXTURE.password),
    displayName: RECOVERY_FIXTURE.displayName,
    role: 'primary',
    ownerId,
    createdAt: new Date(),
    lastLoginAt: null,
  });

  const now = Date.now();
  const rows = Array.from({ length: OVERDUE_COUNT }, (_, index) => {
    // Spread across three weeks, so the oldest is old enough to look like a
    // backlog rather than one bad afternoon.
    const dueAt = new Date(now - (index + 2) * 18 * 60 * 60 * 1000);

    return {
      ownerId,
      title: `Overdue fixture ${index + 1}`,
      outcome: `The recovery fixture has an unanswered deadline (${index + 1})`,
      dueAt,
      originalDueAt: dueAt,
      estimateMinutes: 30,
      priority: 'maintenance',
      status: 'pending',
      synthetic: true,
    };
  });

  await CommitmentModel.insertMany(rows);

  console.log(`  Created ${rows.length} overdue commitments, all unanswered.`);
  console.log(`  Thresholds: > ${RECOVERY_THRESHOLDS.overdue} overdue,`);
  console.log(`  > ${RECOVERY_THRESHOLDS.needsReckoning} unanswered.`);
  console.log(`\n  ${RECOVERY_FIXTURE.username} / ${RECOVERY_FIXTURE.password}\n`);

  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
  void mongoose.disconnect();
});
