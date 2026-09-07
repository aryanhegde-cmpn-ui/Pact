import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

/**
 * Auth.js reaches for `next/server`, which does not resolve in the Vitest node
 * environment. The guard imports it for `currentActor`; nothing here needs a
 * session, so it is stubbed rather than stood up.
 */
vi.mock('@/lib/auth', () => ({ auth: async () => null }));

const { translateError } = await import('@/lib/api/guard');

/**
 * No route may return a bare 500 from an escaped exception.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `POST /api/relationship/invite` returned 500. Two separate causes, both of
 * this shape:
 *
 *   1. `can()` threw a TypeError on a role outside the enum, from OUTSIDE the
 *      handler's try/catch, so nothing translated it.
 *   2. `RelationshipError` -- raised deliberately, carrying a 409 and a message
 *      written to be read -- was not in the translator, so it fell through to
 *      the 500 branch. Four other classes were in the same state.
 *
 * A 500 with a stack trace tells the user nothing they can act on and tells an
 * attacker where the code lives. A 409 saying "an overseer is already active,
 * revoke them first" is the same failure, answered.
 * ---------------------------------------------------------------------------
 */

const LIB = fileURLToPath(new URL('.', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
  }

  return out;
}

/** Every error class the application defines, discovered rather than listed. */
const DECLARED = sourceFiles(LIB).flatMap((path) =>
  [...readFileSync(path, 'utf8').matchAll(/export class (\w*Error)\s+extends\s+(\w+)/g)].map(
    (match) => ({ name: match[1] ?? '', base: match[2] ?? '', file: relative(LIB, path) }),
  ),
);

/**
 * The one class that does not extend `PactError`, with its reason.
 *
 * `src/lib/env.ts` is imported by everything and deliberately depends on
 * nothing, so it does not reach into `src/lib/api`. It has its own branch in
 * the translator and its own status: a missing variable is 503, not 400 --
 * the request was fine, the server is not.
 */
const EXEMPT = new Set([
  'EnvironmentError',
  // The base class itself, which is the thing everything else extends.
  'PactError',
]);

describe('every application error reaches the translator', () => {
  it('finds them, so the scan is not vacuously empty', () => {
    expect(DECLARED.length).toBeGreaterThanOrEqual(6);
  });

  it('extends PactError, so the translator finds it by instanceof', () => {
    /**
     * STRUCTURAL, not textual. The first fix matched on
     * `error.constructor.name` against a list; it passed every test here and
     * still returned 500 in the production build, because the minifier mangles
     * class names. `instanceof` survives minification.
     *
     * This is what keeps it honest: adding an error class that extends `Error`
     * directly is a red test rather than a 500 in production three weeks
     * later.
     */
    const wrong = DECLARED.filter(
      ({ name, base }) => !EXEMPT.has(name) && base !== 'PactError',
    ).map(({ name, base, file }) => `${name} extends ${base} (${file})`);

    expect(wrong).toEqual([]);
  });

  it('carries its status through the translator', async () => {
    const { PactError } = await import('@/lib/api/errors');
    const response = translateError(new PactError('Already active.', 409));

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe('Already active.');
  });
});

describe('translateError', () => {
  it('maps the real RelationshipError to 409, which is the bug that started this', async () => {
    // `POST /api/relationship/invite` returned 500 when an overseer was
    // already active: the message existed, carried a 409, and never reached
    // the translator.
    const { RelationshipError } = await import('@/lib/auth/relationship');
    const response = translateError(
      new RelationshipError('An overseer is already active. Revoke them first.', 409),
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toMatch(/Revoke them first/);
  });

  it('maps schema validation to 400, with the fields that failed', async () => {
    // Reachable now that `runValidators` is on globally: an update carrying a
    // value outside an enum throws instead of being written silently.
    const error = Object.assign(new Error('Validation failed'), {
      name: 'ValidationError',
      errors: { role: { message: '`owner` is not a valid enum value for path `role`.' } },
    });

    const response = translateError(error);
    const body = (await response.json()) as { error: string; details: { field: string }[] };

    expect(response.status).toBe(400);
    expect(body.details.map((detail) => detail.field)).toEqual(['role']);
  });

  it('maps a duplicate key to 409', () => {
    // Uniqueness enforced by an index is a conflict at the route boundary, not
    // a server fault -- and in this codebase it is usually the design working.
    const error = Object.assign(new Error('E11000 duplicate key'), { code: 11_000 });

    expect(translateError(error).status).toBe(409);
  });

  it('maps a bad request body to 422 with the offending field', async () => {
    const { z } = await import('zod');
    const parsed = z.object({ name: z.string() }).safeParse({ name: 7 });

    const response = translateError(parsed.error);
    const body = (await response.json()) as { details: { field: string }[] };

    expect(response.status).toBe(422);
    expect(body.details[0]?.field).toBe('name');
  });

  it('returns a correlation id, and no stack trace, for anything unexpected', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = translateError(new TypeError('Cannot read properties of undefined'));
    const body = (await response.json()) as { error: string; details?: { correlationId: string } };

    expect(response.status).toBe(500);
    expect(body.error).toBe('Something went wrong.');
    // The id is the link between "it broke" and the stack trace, without the
    // stack trace being in the response.
    expect(body.details?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toMatch(/at .*\.ts:/);
    expect(spy).toHaveBeenCalledOnce();

    spy.mockRestore();
  });

  it('logs the same id it returns', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = translateError(new Error('boom'));
    const body = (await response.json()) as { details?: { correlationId: string } };

    expect(spy.mock.calls[0]?.[0]).toContain(body.details?.correlationId ?? 'MISSING');

    spy.mockRestore();
  });
});
