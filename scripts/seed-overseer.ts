/**
 * Provisions the overseer fixture: a second account with a redeemed invite.
 *
 *   npm run seed:overseer                 make sure it exists
 *   npm run seed:overseer -- --reset      tear it down and rebuild it
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The overseer's pages had no coverage at all, and it was not for want of
 * caring: no spec could REACH them. Every spec signs in as the primary,
 * because the primary is the only account any seed produced. That is the same
 * structural gap that shipped the 600px landing page, and it has now cost
 * three bugs.
 *
 * So it is solved as a fixture problem rather than by writing more specs. This
 * script guarantees the state the overseer specs need, and it goes through the
 * real invite and redemption path -- not by inserting a user with a role field
 * -- so the fixture exercises the flow it depends on.
 *
 * Refuses to run against anything that is not recognisably a scratch database,
 * for the same reason `seed:history` does: it deletes an account.
 * ---------------------------------------------------------------------------
 */
import './load-env';

import mongoose from 'mongoose';

import { createInvite, redeemInvite, revokeRelationship } from '@/lib/auth/relationship';
import { assertSafeToMutate, describeUri } from '@/lib/db/guard-uri';
import { RelationshipModel } from '@/lib/db/models/relationship';
import { UserModel } from '@/lib/db/models/user';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getEnv } from '@/lib/env';

/**
 * Fixed, so the specs can sign in without being told.
 *
 * Not a secret: it only ever exists in a scratch database, and the guard above
 * refuses to run anywhere else.
 */
export const OVERSEER_FIXTURE = {
  username: 'overseer1',
  email: 'overseer@example.test',
  password: 'OverseerPass2026x',
  displayName: 'The Overseer',
} as const;

async function main(): Promise<void> {
  const env = getEnv();
  const reset = process.argv.includes('--reset');

  await connectToDatabase();
  // Deletes an account when resetting, so it is held to the same bar as the
  // history purge: a local run against a production URI has a development
  // NODE_ENV and would otherwise pass.
  assertSafeToMutate(env.MONGODB_URI, 'seed:overseer');

  console.log(`\nProvisioning the overseer fixture on ${describeUri(env.MONGODB_URI)}\n`);

  const primary = await UserModel.findOne({ role: 'primary' }, { _id: 1, username: 1 }).lean();
  if (!primary) throw new Error('No primary user. Run `npm run seed:user` first.');
  const primaryUserId = String(primary._id);

  const existing = await UserModel.findOne({ usernameLower: OVERSEER_FIXTURE.username }).lean();
  const relationship = await RelationshipModel.findOne({
    primaryUserId,
    status: 'active',
  }).lean();

  if (existing && relationship && !reset) {
    console.log('  Already provisioned. Pass --reset to rebuild it.');
    console.log(`  ${OVERSEER_FIXTURE.username} / ${OVERSEER_FIXTURE.password}\n`);
    await mongoose.disconnect();
    return;
  }

  if (reset || existing) {
    // Revoke first: an active relationship refuses a new invite, which is the
    // rule being relied on rather than worked around.
    await revokeRelationship(primaryUserId);
    const removed = await UserModel.deleteOne({ usernameLower: OVERSEER_FIXTURE.username });
    console.log(`  Cleared ${removed.deletedCount ?? 0} existing overseer account.`);
  }

  const invite = await createInvite(primaryUserId);
  console.log(`  Invite minted, expires ${invite.expiresAt.toISOString().slice(0, 10)}.`);

  const { overseerUserId } = await redeemInvite({
    token: invite.token,
    username: OVERSEER_FIXTURE.username,
    email: OVERSEER_FIXTURE.email,
    password: OVERSEER_FIXTURE.password,
    displayName: OVERSEER_FIXTURE.displayName,
  });

  console.log(`  Redeemed. Overseer ${overseerUserId} now watches ${primaryUserId}.`);
  console.log(`\n  ${OVERSEER_FIXTURE.username} / ${OVERSEER_FIXTURE.password}\n`);

  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
  void mongoose.disconnect();
});
