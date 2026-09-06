import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The playlist rule, enforced structurally.
 *
 * ---------------------------------------------------------------------------
 * A PLAYLIST IS A POOL. IT HAS NO COMPLETION FIGURE.
 * ---------------------------------------------------------------------------
 * The workbook says so in two places, unprompted. The curriculum sheet's own
 * second line reads "Playlist links are resource pools, not courses to finish
 * end-to-end", and the resource sheet repeats it per row: "Daily; don't finish
 * as a course", "Pick relevant videos only", "Pick weak topics only",
 * "Reference, not daily core".
 *
 * The failure this prevents is specific. A percentage over a playlist turns
 * "watch the two videos on the thing you are weak at" into "get through 214
 * videos", and then rewards the second. That is the substitution of engagement
 * with the tool for execution of the work -- the same failure the anti-feature
 * list exists to prevent, arriving by a different door and looking like a
 * useful feature on the way in.
 *
 * A source scan rather than a behavioural test because the claim is about the
 * WHOLE codebase: the dangerous version is the one somebody adds next month in
 * a file nobody thought to test.
 * ---------------------------------------------------------------------------
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const FILES = sourceFiles(ROOT).map((path) => ({
  rel: relative(ROOT, path),
  code: stripComments(readFileSync(path, 'utf8')),
}));

/** Things that are pools rather than things you finish. */
const POOL = 'resource|resources|playlist|playlists|video|videos|course|courses|library';

/**
 * Words that turn a pool into a score.
 *
 * `count` and `total` are deliberately absent: "13 resources" is a fact about
 * a shelf, not a claim about progress through it.
 */
const SCORE =
  'percent|percentage|completion|completed|complete|remaining|progress|watched|seen|finished|ratio|streak';

describe('nothing computes progress over a pool', () => {
  it('has no identifier naming a pool and a score together', () => {
    const forwards = new RegExp(`\\b(?:${POOL})(?:${SCORE})\\w*`, 'gi');
    const backwards = new RegExp(`\\b(?:${SCORE})(?:${POOL})\\w*`, 'gi');

    const offences = FILES.flatMap(({ rel, code }) =>
      [...code.matchAll(forwards), ...code.matchAll(backwards)].map(
        (match) => `${rel}: ${match[0]}`,
      ),
    );

    expect(offences).toEqual([]);
  });

  it('never divides by the size of a pool', () => {
    // The other way to write the same thing: `done / resources.length`.
    const division = new RegExp(`[/*]\\s*\\(?\\s*\\w*(?:${POOL})\\w*\\s*\\.\\s*length`, 'gi');

    const offences = FILES.flatMap(({ rel, code }) =>
      [...code.matchAll(division)].map((match) => `${rel}: ${match[0].trim()}`),
    );

    expect(offences).toEqual([]);
  });
});

describe('the Resource model carries no progress', () => {
  const model = readFileSync(join(ROOT, 'lib/db/models/resource.ts'), 'utf8');

  it('declares only descriptive fields', () => {
    // Whatever else changes, adding a field here is how the rule would be
    // broken first -- a column is what makes a percentage cheap to compute.
    const fields = [...model.matchAll(/^\s{4}(\w+):\s*\{/gm)].map((match) => match[1]);

    expect(fields).toEqual(['ownerId', 'name', 'type', 'use', 'link', 'howToUse', 'order']);
  });

  it('has no status, and no timestamps that would imply one', () => {
    for (const forbidden of ['status', 'completedAt', 'watchedAt', 'progress', 'lastViewedAt']) {
      expect(model).not.toMatch(new RegExp(`\\b${forbidden}\\s*:`));
    }
  });
});

describe('progress belongs to a topic, which is a thing you can finish', () => {
  const model = readFileSync(join(ROOT, 'lib/db/models/topic-progress.ts'), 'utf8');

  it('is keyed on a curriculum topic, never on a resource', () => {
    expect(model).toMatch(/stableKey/);
    expect(model).not.toMatch(/resourceId|resourceName|playlist/i);
  });
});

describe('the workbook’s own instruction survives the import', () => {
  it('keeps "how to use" as text rather than turning it into a rule', () => {
    // "Daily; don't finish as a course" is guidance for a person. Parsing it
    // into a target would be the app deciding it knows what the instruction
    // meant -- and the instruction says not to measure this at all.
    const service = readFileSync(join(ROOT, 'lib/curriculum/service.ts'), 'utf8');

    expect(service).toMatch(/howToUse: row\.howToUse/);
  });
});
