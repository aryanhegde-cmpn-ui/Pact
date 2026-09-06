/**
 * Changes a user's username.
 *
 *   npm run change:username -- --user aryan --to aryan-h
 *
 * Not exposed in the UI, deliberately. A username is how an account is
 * addressed, and letting it change from the app invites the impersonation
 * problem: someone releases a name, someone else takes it, and every reference
 * that was not a hard id now points at a different person.
 */
import './shell-env';
import './load-env';

import mongoose from 'mongoose';

import { UserModel } from '@/lib/db/models/user';
import { connectToDatabase } from '@/lib/db/mongoose';
import { normaliseUsername, usernameSchema } from '@/lib/schemas/user';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1];

  return process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
}

async function main(): Promise<void> {
  const current = readArg('user');
  const next = readArg('to');

  if (!current || !next) {
    throw new Error('Usage: npm run change:username -- --user <current> --to <new>');
  }

  const parsed = usernameSchema.parse(next);
  await connectToDatabase();

  const user = await UserModel.findOne({ usernameLower: normaliseUsername(current) }).lean();
  if (!user) throw new Error(`No user with username "${current}".`);

  const clash = await UserModel.findOne({ usernameLower: parsed }).lean();
  if (clash && String(clash._id) !== String(user._id)) {
    throw new Error(`"${parsed}" is already taken.`);
  }

  await UserModel.updateOne(
    { _id: user._id },
    { $set: { username: parsed, usernameLower: parsed } },
  );

  console.log(`Renamed ${user.username} to ${parsed}.`);
  console.log('Existing sessions stay valid: the JWT carries the user id, not the name.');
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
