/**
 * Issues a fresh set of recovery codes for an account.
 *
 *   npm run recovery:generate                                 print the target and the users
 *   npm run recovery:generate -- --username aryanhegde --confirm
 *
 * ---------------------------------------------------------------------------
 * THE ONE TIME THE CODES EXIST IN PLAINTEXT.
 * ---------------------------------------------------------------------------
 * They are printed once, to stdout, and written nowhere. Only argon2 digests
 * reach the database, there is no route that reads them back, and a second run
 * produces a different set -- which invalidates this one.
 *
 * Needed as a script as well as a settings page because of the ordering: an
 * account that predates recovery codes has none, and signing in to generate
 * them assumes you can sign in. This is how an existing account gets its first
 * set.
 * ---------------------------------------------------------------------------
 */
import './load-env';

import mongoose from 'mongoose';

import { generateRecoveryCodes } from '@/lib/auth/account-recovery';
import { UserModel } from '@/lib/db/models/user';
import { connectToDatabase } from '@/lib/db/mongoose';
import { formatRecoveryCode } from '@/lib/schemas/account-recovery';
import { normaliseUsername } from '@/lib/schemas/user';

import { announceTarget, readArg, requireConfirm } from './target';

async function main(): Promise<void> {
  announceTarget('recovery:generate');

  await connectToDatabase();

  const users = await UserModel.find({}, { username: 1, email: 1, role: 1, recoveryCodeSetId: 1 })
    .sort({ createdAt: 1 })
    .lean();

  if (users.length === 0) {
    throw new Error('No users in this database. Either the target is wrong or nothing is seeded.');
  }

  console.log('  Accounts here:');
  for (const user of users) {
    console.log(
      `    ${user.username.padEnd(16)} ${user.role.padEnd(9)} ${
        user.recoveryCodeSetId ? 'has codes' : 'NO CODES'
      }`,
    );
  }
  console.log('');

  const requested = readArg('username');
  if (!requested) {
    throw new Error(
      'Name the account:\n  npm run recovery:generate -- --username <username> --confirm',
    );
  }

  const user = await UserModel.findOne({ usernameLower: normaliseUsername(requested) }).lean();
  if (!user) {
    throw new Error(`No user "${requested}" in this database. Check the list above.`);
  }

  if (user.recoveryCodeSetId) {
    console.log(`  ${user.username} already has a set. Generating REPLACES it: every code`);
    console.log('  written down from the previous set stops working.');
    console.log('');
  }

  console.log(`  About to issue ten recovery codes for ${user.username} <${user.email}>.`);
  requireConfirm('recovery:generate');

  const { codes } = await generateRecoveryCodes(String(user._id));

  console.log('');
  console.log(`  Ten codes for ${user.username}. Shown once, stored only as hashes:`);
  console.log('');
  for (const code of codes) console.log(`      ${formatRecoveryCode(code)}`);
  console.log('');
  console.log('  Save them in your password manager now. Each works exactly once, and');
  console.log('  any previous set is now dead.');
  console.log('');

  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
  void mongoose.disconnect();
});
