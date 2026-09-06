import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The validation-bypass scanner.
 *
 * Same shape as the `dueAt` writer scanner and the ownership scanner, both of
 * which have caught real bugs, and added for the same reason: something got
 * into this database that its own schema forbids.
 *
 * `seedUser` wrote `role: 'owner'` through `updateOne`. The field is
 * `enum: ['primary', 'overseer']`. Mongo accepted it, because Mongoose does
 * not run validators on updates unless asked, and the result was an account
 * that failed every capability check and could not sign in by username. No
 * error was raised anywhere.
 *
 * `registerUpdateValidation()` closes the ordinary case by setting
 * `runValidators` globally. This scans for the three things a global option
 * cannot reach:
 *
 *   1. Raw driver access, which bypasses Mongoose and its schemas entirely.
 *   2. `bulkWrite`, which does not run update validators at all.
 *   3. A call that explicitly turns validation off.
 *
 * A source scan rather than a behavioural test because the claim is about the
 * whole codebase. The dangerous write is always the one in the file nobody
 * thought to test.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;

    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }

  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const FILES = [join(ROOT, 'src'), join(ROOT, 'scripts')].flatMap(sourceFiles).map((path) => ({
  rel: relative(ROOT, path),
  code: stripComments(readFileSync(path, 'utf8')),
}));

/**
 * Files allowed to reach past Mongoose, each with the reason.
 *
 * Deliberately short and all operator scripts. A growing list means the rule is
 * wrong or the code is. Nothing serving a request is on it: a route that writes
 * through the raw driver is writing rows its own schema would reject.
 */
const RAW_DRIVER_ALLOWED: Record<string, string> = {
  'scripts/seed-history.ts':
    'Purges synthetic rows. The event log has no delete path in src/ on purpose, and an append-only guarantee with an exception inside the application is not a guarantee.',
  'scripts/migrate-identity.ts':
    'A one-off migration that rewrites documents INTO the current schema. It cannot go through models whose schema the rows do not yet satisfy.',
  'scripts/migrate-miss-index.ts': 'Drops and rebuilds an index. Indexes are not documents.',
  'src/app/api/health/route.ts': 'Runs an admin ping. Touches no collection.',
};

describe('nothing writes past the schema', () => {
  it('reaches the raw driver only from annotated operator scripts', () => {
    const offences = FILES.filter(
      ({ rel, code }) => /\.collection\s*\(/.test(code) && !(rel in RAW_DRIVER_ALLOWED),
    ).map(({ rel }) => rel);

    expect(offences).toEqual([]);
  });

  it('lists no stale exception', () => {
    // An exemption for a file that no longer reaches the driver hides the next
    // one that does.
    const reaching = new Set(
      FILES.filter(({ code }) => /\.collection\s*\(|connection\.db/.test(code)).map((f) => f.rel),
    );

    for (const allowed of Object.keys(RAW_DRIVER_ALLOWED)) {
      expect(reaching.has(allowed)).toBe(true);
    }
  });

  it('uses no bulkWrite', () => {
    /**
     * `bulkWrite` runs no update validators, and there is no option to make it.
     * `insertMany` does validate, and is what the batched materialiser uses --
     * so there has been no reason to reach for it.
     */
    const offences = FILES.filter(({ code }) => /\.bulkWrite\s*\(/.test(code)).map((f) => f.rel);

    expect(offences).toEqual([]);
  });

  it('never turns validation off', () => {
    const offences = FILES.filter(({ code }) =>
      /runValidators\s*:\s*false|validateBeforeSave\s*:\s*false|strict\s*:\s*false/.test(code),
    ).map((f) => f.rel);

    expect(offences).toEqual([]);
  });

  it('scans a meaningful number of files', () => {
    // A scanner whose file list silently became empty passes everything.
    expect(FILES.length).toBeGreaterThan(80);
  });

  it('catches a planted violation', () => {
    // The scanner's own rules, applied to text it has never seen. Without this
    // a regex that stopped matching anything would look like a clean codebase.
    const planted = [
      { rel: 'src/lib/somewhere.ts', code: 'await db.collection("users").updateOne({}, {});' },
      { rel: 'src/lib/other.ts', code: 'await Model.bulkWrite([{ updateOne: {} }]);' },
      { rel: 'src/lib/third.ts', code: 'await Model.updateOne({}, {}, { runValidators: false });' },
    ];

    expect(planted.filter(({ code }) => /\.collection\s*\(/.test(code))).toHaveLength(1);
    expect(planted.filter(({ code }) => /\.bulkWrite\s*\(/.test(code))).toHaveLength(1);
    expect(planted.filter(({ code }) => /runValidators\s*:\s*false/.test(code))).toHaveLength(1);
  });
});

describe('the global is actually set', () => {
  it('turns on runValidators and setDefaultsOnInsert together', async () => {
    const mongoose = (await import('mongoose')).default;
    const { registerUpdateValidation, updateValidationIsOn } =
      await import('./db/validate-updates');

    registerUpdateValidation();

    expect(updateValidationIsOn()).toBe(true);
    // An upsert that creates a document without its schema defaults produces a
    // row no `save()` could have produced.
    expect(mongoose.get('setDefaultsOnInsert')).toBe(true);
  });

  it('is applied before anything can query', async () => {
    // Not in a route, not in a service: in `connectToDatabase`, which every
    // query path already awaits. A model compiled at import time cannot be
    // reached by a plugin registered later, so the global is the only thing
    // that covers all of them.
    const source = readFileSync(join(ROOT, 'src/lib/db/mongoose.ts'), 'utf8');

    expect(source).toMatch(/registerUpdateValidation\(\)/);
  });
});
