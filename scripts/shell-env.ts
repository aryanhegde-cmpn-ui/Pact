/**
 * A snapshot of the environment as the SHELL provided it.
 *
 * Must be imported before `./load-env`, which merges `.env.local` into
 * `process.env` and makes the two indistinguishable afterwards. ES module
 * imports evaluate in declaration order, so importing this first is what makes
 * the snapshot meaningful.
 *
 * This exists so a script can tell "the operator typed this on the command
 * line" from "this was read out of a file" -- a distinction that matters for
 * secrets, because the file round-trip is lossy. `@next/env` runs values
 * through dotenv-expand, which:
 *
 *   pa$$w0rd-with-dollars  ->  pa$-with-dollars
 *   secret-${HOME}-here    ->  secret-/home/you-here
 *   pass#word              ->  pass
 *
 * A password containing any of those is silently a different password when it
 * is read back, and the only symptom is that sign-in stops working.
 */
export const SHELL_ENV: Readonly<Record<string, string | undefined>> = Object.freeze({
  ...process.env,
});

/** Whether the operator supplied this variable, rather than a dotenv file. */
export function providedInShell(name: string): boolean {
  const value = SHELL_ENV[name];

  return typeof value === 'string' && value.trim() !== '';
}
