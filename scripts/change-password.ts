/**
 * Changes an existing user's password.
 *
 *   npm run change:password -- --email you@example.com
 *
 * Prompts for the new password without echoing it, so it never lands in shell
 * history. There is no reset-by-email flow, and docs/decisions.md (007) records
 * why: one user, no email provider, and a token chain that is not worth its
 * cost yet.
 */
import { createInterface } from 'node:readline';

import './load-env';

import mongoose from 'mongoose';

import { hashPassword } from '@/lib/auth/password';
import { UserModel } from '@/lib/db/models/user';
import { connectToDatabase } from '@/lib/db/mongoose';
import { emailSchema, normaliseEmail, passwordSchema } from '@/lib/schemas/user';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1];
  return process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
}

/** Reads a line with echo suppressed, so the password stays off the screen. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const rl = createInterface({ input, output: process.stdout, terminal: true });

    if (!input.isTTY) {
      rl.close();
      reject(new Error('Not a TTY. Run this interactively so the password is not echoed.'));
      return;
    }

    process.stdout.write(question);
    const wasRaw = input.isRaw ?? false;
    input.setRawMode(true);

    let value = '';
    const onData = (chunk: Buffer): void => {
      for (const byte of chunk) {
        // Enter
        if (byte === 0x0d || byte === 0x0a) {
          input.setRawMode(wasRaw);
          input.off('data', onData);
          rl.close();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        // Ctrl+C
        if (byte === 0x03) {
          input.setRawMode(wasRaw);
          input.off('data', onData);
          rl.close();
          process.stdout.write('\n');
          reject(new Error('Cancelled.'));
          return;
        }
        // Backspace / delete
        if (byte === 0x7f || byte === 0x08) {
          value = value.slice(0, -1);
          continue;
        }
        value += String.fromCharCode(byte);
      }
    };

    input.on('data', onData);
  });
}

async function main(): Promise<void> {
  const email = emailSchema.safeParse(readArg('email') ?? '');
  if (!email.success) {
    throw new Error(
      'Pass the account to change:\n  npm run change:password -- --email you@example.com',
    );
  }

  await connectToDatabase();

  const user = await UserModel.findOne({ email: normaliseEmail(email.data) }).lean();
  if (!user) {
    throw new Error(`No user with email ${email.data}.`);
  }

  const first = await promptHidden(`New password for ${email.data}: `);
  const parsed = passwordSchema.safeParse(first);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Password rejected.');
  }

  const second = await promptHidden('Confirm: ');
  if (first !== second) {
    throw new Error('Passwords did not match. Nothing changed.');
  }

  await UserModel.updateOne(
    { _id: user._id },
    { $set: { passwordHash: await hashPassword(parsed.data) } },
  );

  console.log(`\nPassword changed for ${email.data}.`);
  console.log('Existing sessions stay valid -- the JWT is not tied to the hash.');
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
