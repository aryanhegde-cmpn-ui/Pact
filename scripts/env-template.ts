/**
 * Writes the two environment templates from the Zod schema.
 *
 *   npm run env:template
 *
 * `.env.production.example`  committed, no values, every variable the schema
 *                            knows about, grouped and described.
 * `.env.production.upload`   gitignored, pre-filled with everything that is
 *                            not a secret and PLACEHOLDER for everything that
 *                            is, ready to be completed and uploaded.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT `.env.production.local`, WHICH IS THE OBVIOUS NAME
 * ---------------------------------------------------------------------------
 * Because Next LOADS it. Its precedence for a production run is
 * `.env.production.local` > `.env.local` > `.env.production` > `.env`, so a
 * file of REPLACE_ME placeholders sitting in the repository root silently
 * overrides the working `.env.local` for every `npm run build` and
 * `npm run start` on this machine.
 *
 * That is not hypothetical: writing it broke local sign-in immediately, with
 * "AUTH_SECRET: must be at least 16 characters" -- a template for configuring
 * production, breaking development, by existing.
 *
 * `.upload` is not in Next's list, so the file is inert until it is uploaded.
 * ---------------------------------------------------------------------------
 *
 * Generated rather than hand-written so the list cannot drift from what a
 * deploy will actually accept -- a template missing a variable is worse than
 * no template, because it looks complete. `src/lib/env.test.ts` fails if the
 * committed example and the schema disagree.
 */
import './load-env';

import { writeFileSync } from 'node:fs';

import { envRequirements, type EnvRequirement } from '@/lib/env';

const PLACEHOLDER = 'REPLACE_ME';

/**
 * Values safe to carry from this machine into a template.
 *
 * Non-secret and environment-independent: a timezone, a contact address, and
 * the PUBLIC half of the VAPID keypair, which is shipped to browsers anyway.
 * Nothing marked `secret` is ever read here, whatever is in the shell.
 */
function prefill(entry: EnvRequirement): string {
  if (entry.secret) return PLACEHOLDER;

  const current = process.env[entry.name];

  return current && current.trim() !== '' ? current : '';
}

function groups(entries: EnvRequirement[]): string[] {
  return [...new Set(entries.map((entry) => entry.group))];
}

function header(lines: string[]): string {
  return lines.map((line) => (line ? `# ${line}` : '#')).join('\n');
}

function build(entries: EnvRequirement[], withValues: boolean): string {
  const out: string[] = [
    header(
      withValues
        ? [
            'Production environment, filled in locally.',
            '',
            'GITIGNORED, and named .upload rather than .local ON PURPOSE:',
            'Next loads .env.production.local ahead of .env.local, so a file of',
            'placeholders under that name breaks every local production run.',
            '',
            'Fill in every REPLACE_ME, then import it:',
            '  vercel env pull .env.vercel.local     # see what is already set',
            '  vercel env add <NAME> production      # one at a time, pasted at the prompt',
            '',
            'Or paste each value into Vercel > Settings > Environment Variables,',
            'selecting the Production environment, then redeploy.',
            '',
            'Never commit this file. Never paste it into a chat or an issue.',
          ]
        : [
            'Every variable this app reads, generated from the Zod schema in',
            'src/lib/env.ts by `npm run env:template`.',
            '',
            'VALUES ARE DELIBERATELY ABSENT. Copy this to .env.production.local',
            '(gitignored) and fill it in, or set them in the Vercel dashboard.',
            '',
            'required  the app refuses to start without it',
            'optional  the app runs without it, with the feature off',
            'secret    treat like a password: never commit, never paste in a ticket',
            '',
            'The SEED_USER_* variables are deliberately absent: they are read by',
            '`npm run seed:user` on a laptop and by nothing in the running app.',
            'A deployment carrying a plaintext password is the one thing to avoid.',
          ],
    ),
    '',
  ];

  for (const group of groups(entries)) {
    out.push(`# ---- ${group} ${'-'.repeat(Math.max(0, 60 - group.length))}`);
    out.push('');

    for (const entry of entries.filter((row) => row.group === group)) {
      const flags = [entry.required ? 'required' : 'optional', entry.secret ? 'secret' : null]
        .filter(Boolean)
        .join(', ');

      out.push(`# ${entry.description}`);
      out.push(`# (${flags})`);

      // AUTH_URL is the one variable whose correct production value is "unset",
      // so it is emitted commented out in both files rather than as a blank
      // that invites filling in.
      const value = withValues ? prefill(entry) : '';
      out.push(entry.name === 'AUTH_URL' ? `# ${entry.name}=` : `${entry.name}=${value}`);
      out.push('');
    }
  }

  if (withValues) {
    out.push(
      header([
        'The two VAPID values are one keypair. Take both from the same run of',
        '`npm run vapid:generate`, or copy both from .env.local. A public key',
        'that does not match the private one produces subscriptions the server',
        'can never send to, and no error anywhere.',
      ]),
      '',
    );
  }

  return out.join('\n');
}

/**
 * The seeding variables are excluded from both PRODUCTION templates.
 *
 * They are read by `npm run seed:user` on a laptop and by nothing in the
 * running app. Listing them in a file whose whole purpose is "paste these into
 * Vercel" is an invitation to put a plaintext password in a deployment, which
 * is the one thing this app must never carry. They are still described in
 * `.env.example` and in the manual.
 */
const LOCAL_ONLY_GROUP = 'Seeding (local only)';

const entries = envRequirements().filter((entry) => entry.group !== LOCAL_ONLY_GROUP);

writeFileSync('.env.production.example', build(entries, false));
writeFileSync('.env.production.upload', build(entries, true));

console.log('');
console.log('  Wrote .env.production.example  (committed, no values)');
console.log('  Wrote .env.production.upload   (gitignored, fill in the REPLACE_ME lines)');
console.log('');
console.log('  Named .upload, not .local: Next loads .env.production.local ahead of');
console.log('  .env.local, so placeholders under that name break local runs.');
console.log('');
console.log(
  `  ${entries.filter((entry) => entry.required).length} required, ${entries.length} total.`,
);
console.log('');
