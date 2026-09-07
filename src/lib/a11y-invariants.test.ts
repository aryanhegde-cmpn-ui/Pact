import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The parts of accessibility a scan can hold.
 *
 * Not a substitute for the runtime checks in `e2e/keyboard.spec.ts` -- focus
 * order and focus restoration only exist in a browser. These are the rules
 * that get broken silently, by a component written later that looks exactly
 * like the components around it.
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

describe('the focus ring survives', () => {
  it('is defined once, globally, in the attention colour', () => {
    const css = readFileSync(join(SRC, 'styles/globals.css'), 'utf8');

    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--pact-signal\)/);
  });

  it('is never removed by a component', () => {
    /**
     * `outline-none` with `focus:border-signal` reads as a considered
     * replacement and is not one: it drops a 2px ring for a 1px border colour
     * change, on the components where someone is typing. Six inputs had it --
     * the sign-in form among them, which is the first thing a keyboard user
     * meets.
     */
    const offenders = FILES.filter(({ code }) =>
      /outline-none|outline:\s*none/.test(stripComments(code)),
    ).map((file) => file.rel);

    expect(offenders).toEqual([]);
  });
});

describe('the shell is navigable', () => {
  const shell = FILES.find((file) => file.rel === 'app/(shell)/layout.tsx');

  it('offers a skip link before the navigation', () => {
    expect(shell?.code).toContain('<SkipLink />');

    const skip = shell?.code.indexOf('<SkipLink />') ?? -1;
    const nav = shell?.code.indexOf('<SidebarNav') ?? -1;

    // Useless anywhere but first: the point is to get past the nav.
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(nav);
  });

  it('gives the skip link something focusable to land on', () => {
    // Without `tabIndex`, the browser scrolls to the anchor and leaves focus in
    // the nav, so the next Tab goes straight back where it came from.
    expect(shell?.code).toMatch(/id="content"[\s\S]{0,400}tabIndex=\{-1\}/);
  });

  it('mounts one live region for the whole app', () => {
    expect(shell?.code).toContain('<Announcer>');
  });
});

describe('figures that carry meaning carry words', () => {
  it('gives the ring a text alternative', () => {
    /**
     * Three arcs are nothing at all to a screen reader: no text, no role, no
     * value. The number has to be stated somewhere.
     */
    const ring = FILES.find((file) => file.rel === 'components/today/block-ring.tsx');

    expect(ring?.code).toContain('role="img"');
    expect(ring?.code).toMatch(/aria-label=\{`\$\{done\} of \$\{total\}/);
  });

  it('labels the day strip rather than leaving 21 bare marks', () => {
    const progress = FILES.find((file) => file.rel === 'app/(shell)/progress/page.tsx');

    // Hidden from the reader and summarised in words instead -- 21 unlabelled
    // divs are noise, and the rate above them is the same fact in a sentence.
    expect(progress?.code).toContain('aria-hidden="true"');
  });
});

function stripComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}
