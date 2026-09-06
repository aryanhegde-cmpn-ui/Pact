import { describe, expect, it } from 'vitest';

import { describeTarget, parsePractice } from './practice';

/**
 * Every string here is a real cell from the workbook's Practice / Output
 * column. Invented examples would only prove the parser handles the shapes it
 * was written for.
 */

describe('counts of problems', () => {
  it.each([
    ['8–10 representative problems', 8, 10],
    ['5–8 problems', 5, 8],
    ['6–8 foundational problems', 6, 8],
    ['3–4 problems', 3, 4],
  ])('reads the range in %s', (raw, min, max) => {
    expect(parsePractice(raw)).toMatchObject({
      kind: 'problems',
      unit: 'problems',
      targetMin: min,
      targetMax: max,
      needsReview: false,
    });
  });

  it.each(['5 problems', '4 problems', '6 problems'])('reads the single count in %s', (raw) => {
    const target = parsePractice(raw);

    expect(target).toMatchObject({ kind: 'problems', unit: 'problems', needsReview: false });
    // A single count is a range of one, not a missing maximum.
    expect(target.targetMin).toBe(target.targetMax);
  });
});

describe('durations', () => {
  it.each([
    ['45–60 min build', 'build', 45, 60],
    ['60–90 min build', 'build', 60, 90],
    ['90 min build', 'build', 90, 90],
    ['5-min verbal framework', 'verbal', 5, 5],
  ])('reads %s as %s', (raw, kind, min, max) => {
    expect(parsePractice(raw)).toMatchObject({
      kind,
      unit: 'minutes',
      targetMin: min,
      targetMax: max,
      needsReview: false,
    });
  });
});

describe('a kind without a number', () => {
  it.each([
    ['Build delegated interactions', 'build'],
    ['Implement curry + compose', 'build'],
    ['Counter/private-state implementation', 'build'],
    ['Containerize a small app', 'build'],
    ['Explain jank investigation', 'explain'],
    ['Explain your 70% bundle reduction', 'explain'],
    ['Before/after explanation', 'explain'],
    ['Audit one page', 'audit'],
  ])('accepts %s as %s and does not flag it', (raw, kind) => {
    // "What to do" without "how much" is still a real instruction.
    expect(parsePractice(raw)).toMatchObject({ kind, targetMin: null, needsReview: false });
  });
});

describe('what it refuses to guess', () => {
  /**
   * These are the rows that get flagged, and they are the point of the design.
   * Each one is a real instruction that simply is not a countable target.
   */
  it.each([
    'Output questions',
    'Predict execution order',
    'Choose storage for scenarios',
    'Design cache strategy',
    'Optimize a slow list',
    'Choose architecture for 3 cases',
    'Test one machine-coded component',
    'Draw cache layers',
    'Give pros/cons + alternative',
    'Whiteboard + edge cases',
    'Architecture + failure modes',
    'Trace browser-to-server path',
  ])('flags %s rather than inventing a target', (raw) => {
    expect(parsePractice(raw)).toMatchObject({
      kind: 'other',
      unit: null,
      targetMin: null,
      targetMax: null,
      needsReview: true,
    });
  });

  it('flags a duration whose activity it does not recognise', () => {
    // "60-min design drill" has a real number in it. Taking the number while
    // guessing the kind would be exactly the confident-wrong-answer failure.
    const target = parsePractice('60-min design drill');

    expect(target.needsReview).toBe(true);
    expect(target.targetMin).toBeNull();
  });

  it('flags text that reads as two kinds rather than picking one', () => {
    const target = parsePractice('Build it, then explain the trade-offs');

    expect(target.kind).toBe('other');
    expect(target.reviewReason).toMatch(/both/);
  });

  it('flags an empty cell', () => {
    expect(parsePractice('   ')).toMatchObject({ needsReview: true, reviewReason: 'empty cell' });
  });
});

describe('the whole column', () => {
  /**
   * The real distribution, asserted so a future "improvement" to the parser
   * cannot quietly start guessing. If this number falls, the reason has to be
   * a rule someone deliberately added -- not a regex that got greedy.
   */
  const COLUMN = [
    '8–10 representative problems',
    '5–8 problems',
    '5–8 problems',
    '5 problems',
    '4–6 problems',
    '5 problems',
    '5 problems',
    '6–8 problems',
    '4–6 problems',
    '6 problems',
    '3–4 problems',
    '4 problems',
    '6–8 foundational problems',
    'Output questions',
    'Counter/private-state implementation',
    'Explain outputs + prototype lookup',
    'Predict execution order',
    'Implement Promise utilities',
    'Implement curry + compose',
    'Build delegated interactions',
    'Explain jank investigation',
    'Choose storage for scenarios',
    'Audit one page',
    'Design cache strategy',
    'Explain your 70% bundle reduction',
    'Explain a render timeline',
    'Optimize a slow list',
    'Design multi-instance state',
    'Choose architecture for 3 cases',
    'Test one machine-coded component',
    'Build accessible modal',
    '10-min design plan before code',
    '45–60 min build',
    '60 min build',
    '45 min build',
    '60–90 min build',
    '60 min build',
    '90 min build',
    '60–90 min build',
    '45 min build',
    '90 min build',
    '5-min verbal framework',
    'Choose strategy for 3 products',
    'Explain state ownership',
    'Design frontend API layer',
    'Choose protocol for 4 cases',
    'Draw cache layers',
    'Give pros/cons + alternative',
    '60-min design drill',
    '60-min design drill',
    '45-min design drill',
    'Containerize a small app',
    'Explain your existing pipeline',
    'Trace browser-to-server path',
    '5-min story + whiteboard',
    'Whiteboard + complexity',
    'Whiteboard + edge cases',
    'Control-loop explanation',
    'Before/after explanation',
    'Architecture + failure modes',
  ];

  it('covers all 60 rows', () => {
    expect(COLUMN).toHaveLength(60);
  });

  it('flags 21 of them, and every flag is an honest gap', () => {
    const flagged = COLUMN.filter((raw) => parsePractice(raw).needsReview);

    expect(flagged).toHaveLength(21);
  });

  it('never produces a partial numeric target', () => {
    // A min without a max, or a unit without a number, would be a target the
    // UI has to special-case and the plan can silently misread.
    for (const raw of COLUMN) {
      const target = parsePractice(raw);
      expect(target.targetMin === null).toBe(target.targetMax === null);
      expect(target.targetMin === null).toBe(target.unit === null);
    }
  });
});

describe('describeTarget', () => {
  it('shows the raw text when nothing was parsed, rather than a made-up target', () => {
    expect(
      describeTarget(parsePractice('Whiteboard + complexity'), 'Whiteboard + complexity'),
    ).toBe('Whiteboard + complexity');
  });

  it('collapses a range of one', () => {
    expect(describeTarget(parsePractice('5 problems'), '5 problems')).toBe('5 problems');
    expect(describeTarget(parsePractice('90 min build'), '90 min build')).toBe('90 min build');
  });
});
