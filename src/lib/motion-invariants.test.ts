import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Motion explains what changed. It never rewards.
 *
 * ---------------------------------------------------------------------------
 * THE TEST, WRITTEN DOWN
 * ---------------------------------------------------------------------------
 * If an animation would feel good to trigger repeatedly, it is a reward and it
 * does not belong here. A completion flourish, a spring on a finished block, a
 * pulse on earning a reward -- all of them are the celebratory animation the
 * anti-feature list bans, arriving as a nice touch rather than as a feature
 * anybody would have argued for.
 *
 * These are source scans for the same reason the dueAt and ownership scanners
 * are: the rule is about the whole codebase, and the dangerous animation is
 * the one added next month in a component nobody thought to test.
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

function stripComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

const FILES = sourceFiles(SRC).map((path) => ({
  rel: relative(SRC, path),
  code: stripComments(readFileSync(path, 'utf8')),
}));

const ANIMATED = FILES.filter(({ code }) => /from 'motion\/react'/.test(code));

describe('motion is loaded as a subset', () => {
  it('uses LazyMotion with domAnimation, not the full bundle', () => {
    /**
     * This is a PWA opened on a phone. `domAnimation` covers transforms,
     * opacity and layout -- everything used here. `domMax` would add drag and
     * layout projection that nothing needs, for most of the library's weight.
     */
    const provider = FILES.find((file) => file.rel === 'components/motion/motion-provider.tsx');

    expect(provider?.code).toMatch(/LazyMotion/);
    expect(provider?.code).toMatch(/domAnimation/);
    expect(provider?.code).not.toMatch(/domMax/);
  });

  it('imports the m components, never the full motion object', () => {
    // `strict` on the provider turns a `motion.div` into a runtime error, but
    // only if one is rendered. This catches it at the import.
    const offenders = ANIMATED.filter(({ code }) =>
      /import\s*\{[^}]*\bmotion\b[^}]*\}\s*from 'motion\/react'/.test(code),
    ).map((file) => file.rel);

    expect(offenders).toEqual([]);
  });

  it('keeps the client boundary at the component, not the page', () => {
    // A page marked `use client` loses server rendering for its whole tree.
    // Motion lives in leaf components that were already client components.
    const pages = ANIMATED.filter((file) => /^app\/.*page\.tsx$/.test(file.rel)).map((f) => f.rel);

    expect(pages).toEqual([]);
  });
});

describe('no springs on anything factual', () => {
  it('uses eased durations only', () => {
    /**
     * A spring overshoots, and overshoot is expressive: it says something
     * about how the app feels about the change. A commitment leaving because
     * it was completed and one leaving because it was abandoned are the same
     * movement, and a bounce on one of them is the reward layer arriving
     * through the easing curve.
     */
    const offenders = ANIMATED.filter(({ code }) =>
      /type:\s*'spring'|stiffness:|damping:|bounce:/.test(code),
    ).map((file) => file.rel);

    expect(offenders).toEqual([]);
  });

  it('defines every duration in one module', () => {
    const inline = ANIMATED.filter(
      (file) =>
        file.rel !== 'components/motion/transitions.ts' && /duration:\s*[\d.]/.test(file.code),
    ).map((file) => file.rel);

    expect(inline).toEqual([]);
  });

  it('keeps state changes under 250ms and mode changes under 350ms', async () => {
    const { STATE_CHANGE, MODE_CHANGE } = await import('@/components/motion/transitions');

    expect(STATE_CHANGE.duration).toBeLessThanOrEqual(0.25);
    expect(MODE_CHANGE.duration).toBeLessThanOrEqual(0.35);
  });
});

describe('nothing celebrates', () => {
  it('has no scale, rotate or repeat anywhere', () => {
    /**
     * The vocabulary of a reward. A ring segment that pulsed on completion
     * would be a badge that happens to be shaped like an arc.
     */
    const offenders = ANIMATED.filter(({ code }) =>
      /\bscale:|\brotate:|\brepeat:|repeatType|confetti/.test(code),
    ).map((file) => file.rel);

    expect(offenders).toEqual([]);
  });

  it('animates nothing on a completion beyond the row leaving', () => {
    /**
     * The row's exit IS the feedback. Anything on top of it -- a flash, a
     * checkmark that draws itself, a colour that fades through green -- is a
     * reward for completing, which is the one reward this app withholds.
     */
    const today = FILES.find((file) => file.rel === 'components/today/today.tsx');

    expect(today?.code).toMatch(/exit=\{\{ opacity: 0, height: 0/);
    expect(today?.code).not.toMatch(/onComplete|whileTap|whileHover/);
  });

  it('has no staggered entrance', () => {
    // Fashionable, and it adds perceived latency to the screen opened most.
    const offenders = ANIMATED.filter(({ code }) =>
      /staggerChildren|delayChildren|delay:\s*[\d.]/.test(code),
    ).map((file) => file.rel);

    expect(offenders).toEqual([]);
  });

  it('has no hover, scroll or parallax effects', () => {
    const offenders = ANIMATED.filter(({ code }) =>
      /whileHover|whileInView|useScroll|useParallax|viewport=\{/.test(code),
    ).map((file) => file.rel);

    expect(offenders).toEqual([]);
  });
});

describe('reduced motion means cuts', () => {
  it('routes every transition through the shared hook', () => {
    // A component importing `motion/react` and setting its own transition is
    // one that will not respect the preference.
    const offenders = ANIMATED.filter(
      (file) =>
        !file.rel.startsWith('components/motion/') &&
        /transition=\{/.test(file.code) &&
        !/useTransition\(/.test(file.code),
    ).map((file) => file.rel);

    expect(offenders).toEqual([]);
  });

  it('returns a zero duration rather than a shorter one', async () => {
    /**
     * Halving the duration is the common mistake and it misreads the setting.
     * Someone who asked for reduced motion is often asking because motion
     * makes them ill; a shorter animation is still animation.
     */
    const { CUT } = await import('@/components/motion/transitions');

    expect(CUT.duration).toBe(0);
  });

  it('consults useReducedMotion, not a media query it reimplements', async () => {
    const source = readFileSync(join(SRC, 'components/motion/transitions.ts'), 'utf8');

    expect(source).toMatch(/useReducedMotion/);
    expect(source).not.toMatch(/matchMedia/);
  });
});
