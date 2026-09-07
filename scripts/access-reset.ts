/**
 * Regains access to an account, in one command.
 *
 *   npm run access:reset                                 print the target and the users
 *   npm run access:reset -- --username aryanhegde --confirm
 *
 * ---------------------------------------------------------------------------
 * THE COMMAND THAT EXISTS SO NOBODY HAS TO ASK FOR HELP.
 * ---------------------------------------------------------------------------
 * There is no reset-by-email flow (docs/decisions.md, 007): one user, no email
 * provider, and a token chain that is not worth its cost. That is a reasonable
 * trade only while there is some other way back in, and there was not -- the
 * previous route was `change:password`, which prompts interactively, never
 * says which database it is connected to, and reports success either way.
 *
 * This one names its target first, lists who is actually in that database,
 * refuses to act without `--confirm`, generates the password itself, prints it
 * exactly once, and clears the lockout rows that a run of failed attempts will
 * have left behind.
 *
 * It deliberately does NOT call `assertSafeToMutate`. That guard exists to keep
 * development commands off production data; this is a production recovery tool
 * and refusing to run there would defeat it. `--confirm`, after a printed
 * target, is the check that fits.
 * ---------------------------------------------------------------------------
 */
import './load-env';

import { randomBytes } from 'node:crypto';

import mongoose from 'mongoose';

import { hashPassword } from '@/lib/auth/password';
import { lockoutKeyForUnknown, lockoutKeyForUser } from '@/lib/auth/throttle';
import { LoginAttemptModel } from '@/lib/db/models/login-attempt';
import { UserModel } from '@/lib/db/models/user';
import { connectToDatabase } from '@/lib/db/mongoose';
import { normaliseUsername } from '@/lib/schemas/user';

import { announceTarget, readArg, requireConfirm } from './target';

/**
 * base64url only: `A-Za-z0-9_-`.
 *
 * No `$`, `#`, quote or backtick, so it survives being pasted into a shell, a
 * password manager, or -- against advice -- an env file that dotenv-expand
 * will read.
 */
function generatePassword(): string {
  return randomBytes(24).toString('base64url');
}

async function main(): Promise<void> {
  announceTarget('access:reset');

  await connectToDatabase();

  const users = await UserModel.find({}, { username: 1, email: 1, role: 1, lastLoginAt: 1 })
    .sort({ createdAt: 1 })
    .lean();

  if (users.length === 0) {
    throw new Error('No users in this database. Either the target is wrong or nothing is seeded.');
  }

  console.log('  Accounts here:');
  for (const user of users) {
    console.log(`    ${user.username.padEnd(16)} ${user.role.padEnd(9)} <${user.email}>`);
  }
  console.log('');

  const requested = readArg('username');
  if (!requested) {
    throw new Error(
      'Name the account to reset:\n' + '  npm run access:reset -- --username <username> --confirm',
    );
  }

  const user = await UserModel.findOne({ usernameLower: normaliseUsername(requested) }).lean();
  if (!user) {
    throw new Error(
      `No user "${requested}" in ${describeUsers(users)}.\n` +
        'Check the list above -- the same person often has different usernames in\n' +
        'different databases, and that alone will make sign-in fail.',
    );
  }

  console.log(`  About to reset the password for ${user.username} <${user.email}>.`);
  requireConfirm('access:reset');

  const password = generatePassword();
  await UserModel.updateOne(
    { _id: user._id },
    { $set: { passwordHash: await hashPassword(password) } },
  );

  /**
   * Lockouts are cleared too, or the new password meets a locked account.
   *
   * Both namespaces: a resolved account counts under `user:<id>`, but attempts
   * made BEFORE the identity migration -- or with a username this database
   * does not have -- resolved to nobody and counted under a hash of whatever
   * was typed. Somebody locked out of production has usually produced both.
   */
  const keys = [
    lockoutKeyForUser(String(user._id)),
    lockoutKeyForUnknown(user.username),
    lockoutKeyForUnknown(user.email),
  ];
  const cleared = await LoginAttemptModel.deleteMany({ key: { $in: keys } });

  /**
   * Attempts against identifiers this database does not have are REPORTED, not
   * deleted.
   *
   * They are the single most useful signal when sign-in "just fails": an
   * `unknown:` row means the username or email typed resolved to nobody here,
   * which is a different problem from a wrong password and produces the same
   * deliberately generic error on screen. Deleting them would also destroy the
   * only evidence of someone else guessing.
   */
  const strays = await LoginAttemptModel.countDocuments({ key: { $regex: '^unknown:' } });

  console.log('');
  console.log(`  Password reset for ${user.username}. Sign in with the username or the email.`);
  console.log(`  Cleared ${cleared.deletedCount ?? 0} lockout row(s) for this account.`);
  if (strays > 0) {
    console.log('');
    console.log(`  Note: ${strays} failed attempt(s) here were against an identifier that does`);
    console.log('  not exist in this database -- a username from another environment, most');
    console.log('  likely. They are left in place as evidence. Sign in as:');
    console.log(`      ${user.username}   or   ${user.email}`);
  }
  console.log('  Existing sessions stay valid: the JWT is not tied to the hash.');
  console.log('');
  console.log('  Password (shown once, never written to a file):');
  console.log('');
  console.log(`      ${password}`);
  console.log('');
  console.log('  Put it in your password manager now. Only the hash is kept.');
  console.log('');

  await mongoose.disconnect();
}

function describeUsers(users: { username: string }[]): string {
  return `this database (${users.map((user) => user.username).join(', ')})`;
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
  void mongoose.disconnect();
});
