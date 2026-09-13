import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The rules that keep a recovery token from becoming a session.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SCANNER.
 * ---------------------------------------------------------------------------
 * "The token permits exactly one action" is not a property of the reset route.
 * It is a property of the whole codebase: it holds only while no OTHER module
 * reads the token collection, and the realistic way it stops holding is a
 * convenience added next month -- a "resume recovery" endpoint, a middleware
 * that accepts it as a bearer credential, a helper that signs somebody in
 * because they had one.
 *
 * None of those would fail a behavioural test of the reset route. All of them
 * fail here.
 * ---------------------------------------------------------------------------
 */
const SRC = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }

  return out;
}

const FILES = sourceFiles(SRC).map((path) => ({
  rel: relative(SRC, path),
  code: readFileSync(path, 'utf8'),
}));

/**
 * The only module with any business touching the token collection.
 *
 * Not even the reset route: it calls the service, which owns every read and
 * every conditional claim. One module that can see the tokens is a smaller
 * surface than two, and it is where the expiry and purpose checks live.
 */
const TOKEN_READERS = ['lib/auth/account-recovery.ts'];

describe('the recovery token is not a session', () => {
  it('is read by the service and the reset route, and nothing else', () => {
    const readers = FILES.filter(({ code }) => code.includes('recovery-token')).map(
      (file) => file.rel,
    );

    expect(readers.sort()).toEqual([...TOKEN_READERS].sort());
  });

  it('never reaches the session layer', () => {
    /**
     * `currentActor()` resolves who the caller is. A recovery token appearing
     * anywhere in that path would mean holding one authenticates you, which is
     * exactly what it must not do.
     */
    const guard = FILES.find((file) => file.rel === 'lib/api/guard.ts');
    const authConfig = FILES.find((file) => file.rel === 'lib/auth/config.ts');
    const proxy = FILES.find((file) => file.rel === 'proxy.ts');

    for (const file of [guard, authConfig, proxy]) {
      expect(file?.code).not.toMatch(/RecoveryToken|recovery-token|recoveryToken/);
    }
  });

  it('is never put in a cookie', () => {
    // In the body, deliberately. A cookie is attached by the browser to every
    // request to the origin, which is the definition of ambient authority.
    const service = FILES.find((file) => file.rel === 'lib/auth/account-recovery.ts');

    expect(service?.code).not.toMatch(/cookies\(\)|Set-Cookie|setCookie/);
  });

  it('carries a purpose the reset path checks', () => {
    const service = FILES.find((file) => file.rel === 'lib/auth/account-recovery.ts');

    // An enum of one. The next purpose has to be named rather than assumed.
    expect(service?.code).toContain('purpose: RECOVERY_TOKEN_PURPOSE');
    expect(service?.code).toMatch(/purpose:\s*RECOVERY_TOKEN_PURPOSE,\s*\n\s*consumedAt: null/);
  });
});

describe('codes are never readable after generation', () => {
  it('has no route that returns a stored code', () => {
    /**
     * They exist in plaintext in exactly two responses -- the generate call and
     * the invite redemption -- and in neither case were they read back from
     * anywhere. A "show me my codes again" route would hand the account's
     * recovery credential to whoever is already signed in on a borrowed laptop,
     * which is the situation the codes exist to survive.
     */
    const routes = FILES.filter((file) => /^app\/api\/.*route\.ts$/.test(file.rel));
    const readers = routes
      .filter(({ code }) => /RecoveryCodeModel|recovery-code/.test(code))
      .map((file) => file.rel);

    expect(readers).toEqual([]);
  });

  it('selects the hash explicitly wherever it is compared', () => {
    // `select: false` on the model is what stops a hash reaching a response
    // body by way of someone spreading a document into JSON.
    const model = FILES.find((file) => file.rel === 'lib/db/models/recovery-code.ts');

    expect(model?.code).toMatch(/codeHash:\s*\{[^}]*select:\s*false/);
  });

  it('logs counts, never codes', () => {
    const service = FILES.find((file) => file.rel === 'lib/auth/account-recovery.ts');

    // The event log is rendered in a timeline and read by the behaviour
    // engine. A credential that reaches either has escaped.
    expect(service?.code).not.toMatch(/payload:\s*\{[^}]*\bcodes?\b\s*[,}]/);
    expect(service?.code).not.toMatch(/console\.(log|info|warn|error)\([^)]*code/);
  });
});

describe('the recovery routes share the sign-in lockout', () => {
  it('keys on the resolved user, never on the submitted string', () => {
    const service = FILES.find((file) => file.rel === 'lib/auth/account-recovery.ts');

    /**
     * A separate counter would make the lockout decorative: ten guesses at the
     * password, ten more at a code, ten more at the password once the first
     * lock lifted. These are the same two helpers `authorizeCredentials` uses.
     */
    expect(service?.code).toContain('lockoutKeyForUser(');
    expect(service?.code).toContain('lockoutKeyForUnknown(');
    expect(service?.code).toContain('getLockoutState(');
    expect(service?.code).toContain('recordFailedAttempt(');
  });

  it('defines no counter of its own', () => {
    const service = FILES.find((file) => file.rel === 'lib/auth/account-recovery.ts');

    expect(service?.code).not.toMatch(/MAX_.*ATTEMPTS|RECOVERY_LOCKOUT|attemptWindow/);
  });
});

describe('one definition of "signed in"', () => {
  /**
   * ---------------------------------------------------------------------------
   * THE BUG THIS EXISTS BECAUSE OF.
   * ---------------------------------------------------------------------------
   * `auth()` answers "is this JWT signed and unexpired". `currentActor()`
   * answers "may this person act", which is a different question the moment a
   * password reset can invalidate a session.
   *
   * The landing page trusted `auth()`. A holder of an invalidated session was
   * redirected to the dashboard, the dashboard refused them and redirected
   * back, and the browser gave up with ERR_TOO_MANY_REDIRECTS -- an infinite
   * bounce with no way to reach the form that would have fixed it. The push
   * routes had the quieter version of the same bug: they kept working for a
   * session every guarded route rejected.
   * ---------------------------------------------------------------------------
   */
  const ALLOWED_TO_CALL_AUTH = [
    // The one implementation. Everything else asks it.
    'lib/api/guard.ts',
    // Reads the session's display fields, having asked `currentActor()` first.
    'app/(shell)/layout.tsx',
    // Reports on the session itself, and must survive Auth.js throwing.
    'app/api/health/detail/route.ts',
    // Auth.js's own plumbing.
    'lib/auth/index.ts',
  ];

  it('is asked of currentActor, not of the raw session', () => {
    const callers = FILES.filter(
      ({ rel, code }) =>
        /^(app|lib|proxy)/.test(rel) &&
        /\bawait auth\(\)/.test(code) &&
        !ALLOWED_TO_CALL_AUTH.includes(rel),
    ).map((file) => file.rel);

    expect(callers).toEqual([]);
  });

  it('has no stale exception', () => {
    // An allowance for a file that no longer calls it hides the next one.
    const paths = new Set(FILES.map((file) => file.rel));
    for (const allowed of ALLOWED_TO_CALL_AUTH) {
      expect(paths.has(allowed), allowed).toBe(true);
    }
  });
});
