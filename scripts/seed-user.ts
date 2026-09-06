/**
 * Creates the single user.
 *
 *   npm run seed:user                                  generates a password
 *   SEED_USER_PASSWORD='...' npm run seed:user         uses the one you supply
 *
 * There is no public signup route (docs/decisions.md, 007), so this is the only
 * way an account comes into existence. Refuses to run when a user already
 * exists unless passed --force, which resets that account's password rather
 * than creating a second one.
 *
 * THE PASSWORD IS NEVER WRITTEN TO A FILE. It is printed once, here, and then
 * only its hash exists. See docs/decisions.md, 013.
 */
import { providedInShell, SHELL_ENV } from './shell-env';
import './load-env';

import { randomBytes } from 'node:crypto';

import mongoose from 'mongoose';

import { seedUser } from '@/lib/auth/seed';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getEnv } from '@/lib/env';
import { emailSchema, passwordSchema } from '@/lib/schemas/user';

/**
 * A password with no character dotenv-expand can misread.
 *
 * base64url is `A-Za-z0-9_-` only: no `$`, no `#`, no quote, no backtick. That
 * is belt and braces now that the value is never persisted, but a generated
 * secret that cannot survive being pasted somewhere is a bad generated secret.
 */
function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

async function main(): Promise<void> {
  const env = getEnv();

  const email = emailSchema.safeParse(env.SEED_USER_EMAIL ?? '');
  if (!email.success) {
    throw new Error(
      `Cannot seed a user.\n  SEED_USER_EMAIL: ${email.error.issues[0]?.message ?? 'invalid'}`,
    );
  }

  /**
   * Only a shell-provided password is honoured.
   *
   * A value sitting in `.env.local` is deliberately ignored: it has been
   * through dotenv-expand, so it may no longer be the string that was written,
   * and hashing a mangled password produces an account nobody can sign in to
   * with the password they think they set.
   */
  const supplied = providedInShell('SEED_USER_PASSWORD');
  const generated = supplied ? null : generatePassword();
  const raw = supplied ? (SHELL_ENV.SEED_USER_PASSWORD ?? '') : (generated as string);

  const password = passwordSchema.safeParse(raw);
  if (!password.success) {
    throw new Error(
      `Cannot seed a user.\n  SEED_USER_PASSWORD: ${password.error.issues[0]?.message ?? 'invalid'}`,
    );
  }

  // Said out loud, because silently ignoring a value the operator can see in a
  // file is worse than not reading it at all.
  if (!supplied && process.env.SEED_USER_PASSWORD) {
    console.log(
      'Ignoring SEED_USER_PASSWORD from .env.local -- dotenv expansion can alter it.\n' +
        'Generating a fresh password instead. Pass it in the shell to choose your own.\n',
    );
  }

  await connectToDatabase();

  const result = await seedUser({
    email: email.data,
    password: password.data,
    displayName: process.env.SEED_USER_NAME,
    force: process.argv.includes('--force'),
  });

  console.log(
    `${result.created ? 'Created' : 'Updated'} user ${result.email} (${result.displayName}).`,
  );
  if (!result.created) console.log('Password reset on the existing account.');

  if (generated) {
    console.log('');
    console.log('  Password (shown once, not stored anywhere):');
    console.log('');
    console.log(`      ${generated}`);
    console.log('');
    console.log('  Put it in a password manager now. Only its hash is kept, so');
    console.log('  losing it means running this again with --force.');
    console.log('  Do NOT paste it into .env.local: dotenv expansion rewrites');
    console.log('  values containing $, ${...} or #, and the only symptom is');
    console.log('  that sign-in silently stops working.');
    console.log('');
  }
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
