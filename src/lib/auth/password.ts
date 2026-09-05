import 'server-only';

import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id via `@node-rs/argon2`, which ships prebuilt binaries.
 *
 * Deliberately NOT the `argon2` package: that one compiles natively at install
 * time and fails on Vercel's build image. See CLAUDE.md.
 *
 * Parameters are the library defaults (19 MiB, t=2, p=1), which match the
 * OWASP recommendation and stay inside the memory a Hobby function has.
 */
export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext);
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns `false` rather than throwing on a malformed hash: a corrupt row must
 * read as "wrong password" to the caller, never as a distinguishable error that
 * would tell an attacker the account exists.
 */
export async function verifyPassword(storedHash: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext);
  } catch {
    return false;
  }
}
