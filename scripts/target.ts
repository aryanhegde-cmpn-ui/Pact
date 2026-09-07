/**
 * Says which database a script is about to act on, before it acts.
 *
 * ---------------------------------------------------------------------------
 * A SCRIPT THAT DOES NOT NAME ITS TARGET IS A SCRIPT YOU CANNOT TRUST.
 * ---------------------------------------------------------------------------
 * `change:password` reported "Password changed for ..." while connected to
 * whichever database `MONGODB_URI` happened to resolve to. Every one of these
 * scripts reads that variable from the shell first and `.env.local` second, so
 * an exported override from an earlier command in the same terminal silently
 * redirects the next one. The command succeeded, the password did change, and
 * it changed in the wrong database -- with nothing on screen to say so.
 *
 * The fix is not a bigger warning. It is that every mutating script prints its
 * target, in the same shape, before doing anything: host, database, and
 * whether that is treated as production.
 *
 * `src/lib/script-target.test.ts` fails on a mutating script that does not.
 * ---------------------------------------------------------------------------
 */
import { assessUri } from '@/lib/db/guard-uri';

/**
 * Prints the target and returns its description.
 *
 * Credentials never appear: `describeUri` keeps host and database only, and
 * this output is meant to be pasted into an issue.
 */
export function announceTarget(command: string): string {
  const uri = process.env.MONGODB_URI ?? '';
  const verdict = assessUri(uri);

  console.log('');
  console.log(`  ${command}`);
  console.log(`  Target:      ${verdict.describe}`);
  console.log(`  Treated as:  ${verdict.safe ? 'SCRATCH (safe to mutate)' : 'PRODUCTION'}`);
  console.log(`  Because:     ${verdict.reason}`);
  console.log('');

  return verdict.describe;
}

/**
 * Refuses to continue without `--confirm`.
 *
 * Separate from the connection-string guard on purpose. The guard answers "may
 * this command touch production at all"; this answers "did a human mean to run
 * it". A recovery tool has to be allowed to touch production -- that is what
 * it is for -- so the confirmation is the only thing standing between a
 * mistyped command and a changed password.
 */
export function requireConfirm(command: string): void {
  if (process.argv.includes('--confirm')) return;

  // The suggestion repeats the arguments already given, so the second attempt
  // is one paste rather than a re-derivation of what was typed the first time.
  const args = process.argv.slice(2).filter((argument) => argument !== '--');

  throw new Error(
    `Refusing to run ${command} without --confirm.\n\n` +
      'Read the target printed above. If it is the database you meant, run:\n' +
      `  npm run ${command} -- ${[...args, '--confirm'].join(' ')}`,
  );
}

/** `--name value` or `--name=value`. */
export function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1];

  return process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
}
