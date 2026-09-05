import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Structural enforcement of the two rules this data model exists to protect.
 *
 * These are source-scanning tests rather than behavioural ones on purpose. The
 * constraint is "no OTHER module may do this", and that is a property of the
 * whole codebase -- a behavioural test can only ever prove the modules it
 * happens to call still behave. If someone adds a write in a new file next
 * month, only a scan catches it.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }

  return out;
}

/** Strips comments so a rule discussed in prose is not mistaken for a violation. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const FILES = sourceFiles(SRC).map((path) => {
  const raw = readFileSync(path, 'utf8');

  return {
    path,
    rel: relative(SRC, path),
    code: stripComments(raw),
    /**
     * A client component cannot reach the database, so a `dueAt` in one is a
     * request payload or a form field -- never a write. Scanning them yields
     * only false positives.
     */
    isClient: /^['"]use client['"]/m.test(raw),
  };
});

describe('dueAt write lockdown', () => {
  /** The only modules allowed to put a value into `dueAt`. */
  const ALLOWED = [
    // The single permitted writer.
    'lib/commitments/deadline.ts',
    // Creation, where dueAt and originalDueAt are born together.
    'lib/commitments/service.ts',
    'lib/commitments/materialise.ts',
    // Declarations, not writes.
    'lib/db/models/commitment.ts',
    'lib/schemas/commitment.ts',
  ];

  it('has exactly one function permitted to write dueAt', () => {
    const source = readFileSync(join(SRC, 'lib/commitments/deadline.ts'), 'utf8');

    expect(source).toContain('export async function changeDeadline');
    expect(source).toMatch(/\$set:\s*\{\s*dueAt/);
  });

  it('is not written anywhere else in the codebase', () => {
    // A write looks like `dueAt:` inside a $set, or an assignment to `.dueAt`.
    const offenders = FILES.filter(({ rel, code, isClient }) => {
      if (ALLOWED.includes(rel) || isClient) return false;

      const inSet = /\$set:\s*\{[^}]*\bdueAt\b/s.test(code);
      // `[^=]` so an equality check is not mistaken for an assignment.
      const assigned = /\.dueAt\s*=[^=]/.test(code);
      const inUpdateOne = /updateOne\([^)]*\bdueAt\b/s.test(code);

      return inSet || assigned || inUpdateOne;
    });

    expect(offenders.map((o) => o.rel)).toEqual([]);
  });

  it('keeps the generic update schema free of dueAt, and strict', () => {
    const source = readFileSync(join(SRC, 'lib/schemas/commitment.ts'), 'utf8');
    const update = source.slice(source.indexOf('export const updateCommitmentSchema'));
    const body = update.slice(0, update.indexOf('export type UpdateCommitmentInput'));

    expect(body).not.toMatch(/^\s*dueAt:/m);
    // `.strict()` is what turns an unexpected dueAt into an error rather than a
    // silently dropped key.
    expect(body).toContain('.strict()');
  });
});

describe('originalDueAt immutability', () => {
  it('is declared immutable on the model', () => {
    const source = readFileSync(join(SRC, 'lib/db/models/commitment.ts'), 'utf8');

    expect(source).toMatch(/originalDueAt:\s*\{[^}]*immutable:\s*true/s);
  });

  it('is guarded against raw $set updates too', () => {
    const source = readFileSync(join(SRC, 'lib/db/models/commitment.ts'), 'utf8');

    expect(source).toContain('guardOriginalDueAt');
  });

  it('is only ever written at creation', () => {
    const CREATION_SITES = ['lib/commitments/service.ts', 'lib/commitments/materialise.ts'];

    const offenders = FILES.filter(({ rel, code, isClient }) => {
      if (CREATION_SITES.includes(rel) || isClient) return false;
      if (rel === 'lib/db/models/commitment.ts' || rel === 'lib/schemas/commitment.ts')
        return false;

      return (
        /\$set:\s*\{[^}]*\boriginalDueAt\b/s.test(code) || /\.originalDueAt\s*=[^=]/.test(code)
      );
    });

    expect(offenders.map((o) => o.rel)).toEqual([]);
  });
});

describe('event log is append-only', () => {
  it('exposes appendEvent as the only write path', () => {
    const source = readFileSync(join(SRC, 'lib/db/events.ts'), 'utf8');

    expect(source).toContain('export async function appendEvent');
  });

  it('has no update or delete call against EventModel anywhere', () => {
    const MUTATIONS = [
      'updateOne',
      'updateMany',
      'findOneAndUpdate',
      'findOneAndReplace',
      'replaceOne',
      'deleteOne',
      'deleteMany',
      'findOneAndDelete',
      'findByIdAndUpdate',
      'findByIdAndDelete',
      'remove',
    ];

    const offenders: string[] = [];

    for (const { rel, code } of FILES) {
      // The model file itself names these when registering the blocking hooks.
      if (rel === 'lib/db/models/event.ts') continue;

      for (const mutation of MUTATIONS) {
        if (new RegExp(`EventModel\\s*\\.\\s*${mutation}\\b`).test(code)) {
          offenders.push(`${rel}: EventModel.${mutation}`);
        }
      }

      // Reaching past the model to the raw driver would sidestep the hooks,
      // which is the same violation wearing a disguise.
      if (/EventModel\s*\.\s*collection\b/.test(code)) {
        offenders.push(`${rel}: EventModel.collection (bypasses the append-only hooks)`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('blocks every mutation at the model level, not just by convention', () => {
    const source = readFileSync(join(SRC, 'lib/db/models/event.ts'), 'utf8');

    for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany']) {
      expect(source).toContain(`'${op}'`);
    }
    // And a re-save, which is an update wearing a different hat.
    expect(source).toContain('rejectResave');
  });

  it('enforces one DEADLINE_MISSED per entity with a unique index', () => {
    const source = readFileSync(join(SRC, 'lib/db/models/event.ts'), 'utf8');

    expect(source).toMatch(/unique:\s*true/);
    expect(source).toContain('partialFilterExpression');
    expect(source).toContain('DEADLINE_MISSED');
  });
});

describe('derived values are not stored', () => {
  it('has no denormalised behavioural columns on the commitment model', () => {
    const source = readFileSync(join(SRC, 'lib/db/models/commitment.ts'), 'utf8');
    const schemaBody = stripComments(source);

    for (const banned of [
      'postponementCount',
      'isMissed',
      'isStale',
      'actualMinutes',
      'completionRate',
      'missedCount',
    ]) {
      expect(schemaBody).not.toMatch(new RegExp(`\\b${banned}\\s*:`));
    }
  });

  it('says so in the model, because the temptation comes back', () => {
    const source = readFileSync(join(SRC, 'lib/db/models/commitment.ts'), 'utf8');

    expect(source).toContain('DELIBERATELY ABSENT');
  });
});
