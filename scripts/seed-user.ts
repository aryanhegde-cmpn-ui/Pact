/**
 * Creates the single user.
 *
 *   SEED_USER_EMAIL=you@example.com SEED_USER_PASSWORD='...' npm run seed:user
 *
 * There is no public signup route (docs/decisions.md, 007), so this is the only
 * way an account comes into existence. Refuses to run when a user already
 * exists unless passed --force, which resets that account's password rather
 * than creating a second one.
 */
import './load-env';

import mongoose from 'mongoose';

import { seedUser } from '@/lib/auth/seed';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getEnv } from '@/lib/env';
import { emailSchema, passwordSchema } from '@/lib/schemas/user';

async function main(): Promise<void> {
  const env = getEnv();

  const email = emailSchema.safeParse(env.SEED_USER_EMAIL ?? '');
  const password = passwordSchema.safeParse(env.SEED_USER_PASSWORD ?? '');

  if (!email.success || !password.success) {
    const problems = [
      email.success ? null : `  SEED_USER_EMAIL: ${email.error.issues[0]?.message ?? 'invalid'}`,
      password.success
        ? null
        : `  SEED_USER_PASSWORD: ${password.error.issues[0]?.message ?? 'invalid'}`,
    ].filter(Boolean);

    throw new Error(`Cannot seed a user.\n${problems.join('\n')}`);
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
  if (!result.created) {
    console.log('Password reset on the existing account.');
  }
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
