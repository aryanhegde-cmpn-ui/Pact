import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RECOVERY_GATED_PATHS, RECOVERY_REACHABLE_PATHS } from '@/lib/commitments/recovery-gate';

/**
 * What the interface is not allowed to grow.
 *
 * The anti-feature list in CLAUDE.md is a product rule, and product rules that
 * live only in a document get relitigated by whoever is building the next
 * screen at 2am. This is the same enforcement the dueAt, ownership and
 * validation scanners use, applied to the one part of the app where a reward
 * layer would arrive looking like a nice touch.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function files(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...files(full, match));
    else if (match.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }

  return out;
}

const COMPONENTS = [join(ROOT, 'components'), join(ROOT, 'app')]
  .flatMap((dir) => files(dir, /\.tsx?$/))
  .map((path) => ({ rel: relative(ROOT, path), code: readFileSync(path, 'utf8') }));

describe('no reward layer', () => {
  it('renders no XP, level, badge or leaderboard', () => {
    /**
     * Every one of these rewards ENGAGEMENT WITH THE TOOL rather than
     * execution of the work. They make tidying the backlog feel like progress,
     * which papers over the exact gap this app exists to show.
     */
    const banned = /\b(xp|badge|badges|leaderboard|level up|levelled up|achievement)\b/i;

    const offences = COMPONENTS.filter(({ code }) => banned.test(stripComments(code))).map(
      (file) => file.rel,
    );

    expect(offences).toEqual([]);
  });

  it('has no confetti or celebratory animation', () => {
    const offences = COMPONENTS.filter(({ code }) =>
      /confetti|celebrat|fireworks|\bconfetti\b/i.test(stripComments(code)),
    ).map((file) => file.rel);

    expect(offences).toEqual([]);
  });

  it('never renders a consecutive streak as a headline', () => {
    /**
     * A consecutive count has a cliff: miss one day at forty and it reads
     * zero, which is a lie about adherence and the documented trigger for
     * abandoning the app. docs/product.md permits it as a SECONDARY stat only.
     *
     * The rule is enforced structurally: the word "streak" appears nowhere,
     * and the one consecutive figure that exists is called `currentRun` and is
     * rendered at `text-xs` beneath the rate.
     */
    const offences = COMPONENTS.filter(({ code }) => /\bstreak\b/i.test(stripComments(code))).map(
      (file) => file.rel,
    );

    expect(offences).toEqual([]);
  });

  it('shows the consecutive run only below the rate, and only small', () => {
    const progress = readFileSync(join(ROOT, 'app/(shell)/progress/page.tsx'), 'utf8');

    const rateAt = progress.indexOf('of the last');
    const runAt = progress.indexOf('Current unbroken run');

    expect(rateAt).toBeGreaterThan(-1);
    expect(runAt).toBeGreaterThan(rateAt);
    // Rendered at the smallest step in the scale. A headline it is not.
    expect(progress.slice(runAt - 200, runAt)).toContain('text-xs');
  });
});

describe('the accent is reserved for state', () => {
  it('is used at most twice on Today', () => {
    /**
     * One accent, meaning "this needs you". Two uses: the unanswered-miss rule
     * and the Start button. A third would make it decoration, and decoration
     * that looks like an alert is worse than no alert.
     */
    const today = readFileSync(join(ROOT, 'components/today/today.tsx'), 'utf8');
    const uses = stripComments(today).match(/\b(text|border|bg)-signal\b/g) ?? [];

    // The miss block accounts for two (rule + text); the Start button lives in
    // its own component. Anything beyond the miss annotation is a regression.
    expect(uses.length).toBeLessThanOrEqual(3);
  });

  it('draws done blocks in the foreground colour, never a reward hue', () => {
    // A green for "complete" would be a reward colour, and completing is the
    // one thing this app is allowed to withhold a reward for.
    const ring = readFileSync(join(ROOT, 'components/today/block-ring.tsx'), 'utf8');

    expect(ring).toContain('stroke-text');
    // Comments stripped: this file's own prose explains why there is no green.
    expect(stripComments(ring)).not.toMatch(/green|emerald|success/i);
  });
});

describe('no emoji as structural chrome', () => {
  it('renders none in any component', () => {
    /**
     * The source specifications lean heavily on emoji. At this density they
     * read as clutter, and an emoji used as a section marker is a glyph doing
     * a job that size and weight already do.
     */
    const offences = COMPONENTS.filter(({ code }) =>
      /\p{Extended_Pictographic}/u.test(stripComments(code)),
    ).map((file) => file.rel);

    expect(offences).toEqual([]);
  });
});

describe('no all-caps eyebrow labels', () => {
  it('sets section labels in lower case', () => {
    // `uppercase` above every section is the SaaS default and turns each label
    // into a shout. The one place it survives is the postponement groups,
    // which are an index rather than a page of sections.
    const todaySurfaces = COMPONENTS.filter(
      ({ rel }) =>
        rel.startsWith('components/today/') ||
        rel.includes('app/(shell)/tomorrow') ||
        rel.includes('app/(shell)/week') ||
        rel.includes('app/(shell)/progress'),
    );

    const offences = todaySurfaces
      .filter(({ code }) => /\buppercase\b/.test(stripComments(code)))
      .map((file) => file.rel);

    expect(offences).toEqual([]);
  });
});

describe('recovery mode gates the planning surfaces', () => {
  it('gates study and postponements, and nothing else', () => {
    expect([...RECOVERY_GATED_PATHS]).toEqual(['/study', '/postponements']);
  });

  it('leaves settings reachable', () => {
    /**
     * Locking someone out of settings during a restrictive state is how they
     * get stuck in it: no way to change quiet hours, no way to end an overseer
     * arrangement, no way out except finishing work they are already failing
     * to finish. A restrictive state with no escape hatch is a trap.
     */
    expect([...RECOVERY_REACHABLE_PATHS]).toContain('/settings');
    expect([...RECOVERY_GATED_PATHS]).not.toContain('/settings');
  });

  it('calls the gate from every gated page', () => {
    const gated = [
      'app/(shell)/study/page.tsx',
      'app/(shell)/study/curriculum/page.tsx',
      'app/(shell)/study/review/page.tsx',
      'app/(shell)/study/phases/page.tsx',
      'app/(shell)/postponements/page.tsx',
      'app/(shell)/tomorrow/page.tsx',
      'app/(shell)/week/page.tsx',
    ];

    for (const path of gated) {
      expect(readFileSync(join(ROOT, path), 'utf8')).toContain('gateDuringRecovery');
    }
  });

  it('replaces the dashboard rather than annotating it', () => {
    const dashboard = readFileSync(join(ROOT, 'app/(shell)/dashboard/page.tsx'), 'utf8');

    // An early return, before the day is even queried. A banner above the
    // normal view would leave the long overdue list right underneath it.
    expect(dashboard).toMatch(/if \(recovery\.active\) return <RecoveryMode/);
  });
});

function stripComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}
