/**
 * Who exists in the database this environment is pointed at.
 *
 *   npm run users:list
 *
 * The command that answers "which environment am I actually talking to, and
 * who am I in it". Read-only: it never writes, so it takes no --confirm.
 *
 * No hashes, ever. `passwordHash` is `select: false` on the model and is not
 * asked for here either -- a listing that prints one turns a convenience
 * command into a credential leak the moment it is pasted somewhere.
 */
import './load-env';

import mongoose from 'mongoose';

import { UserModel } from '@/lib/db/models/user';
import { connectToDatabase } from '@/lib/db/mongoose';

import { announceTarget } from './target';

function when(value: Date | null | undefined): string {
  return value ? new Date(value).toISOString().replace('T', ' ').slice(0, 16) : 'never';
}

async function main(): Promise<void> {
  announceTarget('users:list');

  await connectToDatabase();

  const users = await UserModel.find(
    {},
    { username: 1, email: 1, role: 1, createdAt: 1, lastLoginAt: 1, ownerId: 1, usernameLower: 1 },
  )
    .sort({ createdAt: 1 })
    .lean();

  if (users.length === 0) {
    console.log('  No users. Run `npm run seed:user` to create the primary.\n');
    await mongoose.disconnect();
    return;
  }

  console.log(`  ${users.length} user${users.length === 1 ? '' : 's'}\n`);

  for (const user of users) {
    console.log(`  ${user.username}  <${user.email}>`);
    console.log(`    role         ${user.role}`);
    console.log(`    id           ${String(user._id)}`);
    console.log(`    ownerId      ${user.ownerId ?? '(none)'}`);
    console.log(`    created      ${when(user.createdAt)}`);
    console.log(`    last login   ${when(user.lastLoginAt)}`);

    /**
     * Both are written by the identity migration, and an account missing
     * either cannot sign in by username and fails every capability check.
     * Reported here because this is the command someone runs when sign-in is
     * broken, and "the migration never ran here" is the answer often enough
     * to be worth one line.
     */
    const problems: string[] = [];
    if (!user.usernameLower) problems.push('no usernameLower -- username sign-in will not match');
    if (!user.ownerId) problems.push('no ownerId -- every scoped query returns nothing');
    if (user.role !== 'primary' && user.role !== 'overseer') {
      problems.push(`role "${String(user.role)}" is outside the enum`);
    }

    for (const problem of problems) console.log(`    NEEDS FIXING ${problem}`);
    console.log('');
  }

  if (users.some((user) => !user.usernameLower || !user.ownerId)) {
    console.log('  Run `npm run db:migrate:identity` against THIS database.\n');
  }

  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
  void mongoose.disconnect();
});
