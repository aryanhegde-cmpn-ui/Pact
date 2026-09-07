import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The token namespaces must not overlap.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Tailwind's `text-*` utility is overloaded: it takes both a font size and a
 * colour, and it resolves against the font-size scale FIRST. So a colour named
 * `base` alongside a type step named `base` makes `text-base` silently mean
 * 16px, and any colour intent written that way is dropped without a warning,
 * without a build error, and without anything on screen looking obviously
 * wrong until it does.
 *
 * That is not hypothetical. It shipped: `hover:text-base` on the Start button
 * set a font size and left signal-coloured text on a signal-coloured ground.
 * Invisible, and only in the hover state.
 *
 * Renaming `base` to `ground` fixed that instance. This fixes the CLASS -- a
 * future colour called `lg`, or a type step called `edge`, fails here rather
 * than in a hover state nobody screenshots.
 * ---------------------------------------------------------------------------
 */

const GLOBALS = readFileSync(
  fileURLToPath(new URL('../styles/globals.css', import.meta.url)),
  'utf8',
);
const TOKENS = readFileSync(
  fileURLToPath(new URL('../styles/tokens.css', import.meta.url)),
  'utf8',
);

/** Names declared under a Tailwind namespace in the `@theme inline` block. */
function namespace(prefix: string): string[] {
  const pattern = new RegExp(`^\\s*--${prefix}-([a-z0-9-]+):`, 'gm');

  return [...GLOBALS.matchAll(pattern)].map((match) => match[1] ?? '');
}

describe('no colour can be read as a font size', () => {
  const colours = namespace('color');
  const sizes = namespace('text');

  it('finds both namespaces, so the test is not vacuously true', () => {
    expect(colours.length).toBeGreaterThanOrEqual(5);
    expect(sizes.length).toBeGreaterThanOrEqual(7);
  });

  it('shares no name between the palette and the type scale', () => {
    const shared = colours.filter((name) => sizes.includes(name));

    expect(shared, `text-${shared[0]} would resolve as a font size, not a colour`).toEqual([]);
  });

  it('keeps the palette at five', () => {
    // Constraint is the point: with no spare colours there is nowhere to put
    // decoration. A sixth is a design decision, not an accident.
    expect(colours.sort()).toEqual(['edge', 'ground', 'signal', 'surface', 'text']);
  });
});

describe('every token is defined once, in tokens.css', () => {
  it('maps the theme to custom properties rather than to literals', () => {
    // `@theme inline` so the utilities reference the properties instead of
    // copying their values -- one place a token is defined.
    const literals = [...GLOBALS.matchAll(/^\s*--(?:color|text)-[a-z0-9-]+:\s*(#[0-9a-f]+)/gim)];

    expect(literals.map((match) => match[0].trim())).toEqual([]);
  });

  it('has no hex outside tokens.css', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../styles/globals.css', import.meta.url)),
      'utf8',
    );

    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(TOKENS).toMatch(/#0b0d10/);
  });
});
