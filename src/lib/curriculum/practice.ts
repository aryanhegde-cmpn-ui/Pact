import type { PracticeTarget, TargetKind, TargetUnit } from '@/lib/schemas/curriculum';

/**
 * Reads the workbook's "Practice / Output" column.
 *
 * ---------------------------------------------------------------------------
 * THIS PARSE IS NOT RELIABLE, AND IS BUILT NOT TO PRETEND OTHERWISE.
 * ---------------------------------------------------------------------------
 * The column is prose written by a person for a person: "8-10 representative
 * problems", "45-60 min build", "Whiteboard + edge cases", "Give pros/cons +
 * alternative". The first two have a real target in them. The last two do not,
 * and no amount of pattern matching will change that.
 *
 * So the rules below are narrow and few, and anything they do not match comes
 * back as `other` with `needsReview: true`. That row then appears in a list in
 * the app to be corrected by hand.
 *
 * The alternative -- guessing -- is worse in a specific way. A target invented
 * from "Choose storage for scenarios" becomes a number the plan measures
 * progress against, and every downstream reading of that number is wrong while
 * looking exactly like a number somebody set. An obvious gap gets fixed; a
 * confident wrong answer does not.
 *
 * Pure: no I/O, no clock. `practiceRaw` is never rewritten by this -- the
 * verbatim text is stored alongside whatever was understood from it.
 */

/**
 * Words that identify a kind, in the order they are tested.
 *
 * `problems` is absent: it is only ever recognised together with a number,
 * because "problems" without a count is not a target.
 */
const KIND_WORDS: { kind: Exclude<TargetKind, 'problems' | 'other'>; pattern: RegExp }[] = [
  { kind: 'build', pattern: /\b(build|implement|containerize|containerise)\w*\b/i },
  { kind: 'audit', pattern: /\baudit\w*\b/i },
  { kind: 'explain', pattern: /\bexplain\w*\b|\bexplanation\b/i },
  { kind: 'verbal', pattern: /\bverbal\b|\baloud\b|\bstory\b/i },
];

/** "8-10 problems", "5-8 representative problems". En dash and hyphen both. */
const PROBLEM_RANGE = /(\d+)\s*[–—-]\s*(\d+)\s+(?:\w+\s+)?problems?\b/i;
/** "5 problems", "6-8 foundational problems" is caught by the range first. */
const PROBLEM_COUNT = /(\d+)\s+(?:\w+\s+)?problems?\b/i;

/** "45-60 min", "60-90 min". */
const MINUTE_RANGE = /(\d+)\s*[–—-]\s*(\d+)\s*[-\s]*min\b/i;
/** "60 min", "5-min", "10-min". */
const MINUTE_COUNT = /(\d+)\s*[-\s]*min\b/i;

function empty(reviewReason: string): PracticeTarget {
  return {
    kind: 'other',
    unit: null,
    targetMin: null,
    targetMax: null,
    needsReview: true,
    reviewReason,
  };
}

/**
 * Parses one cell.
 *
 * Order matters: a problem count settles both the kind and the unit at once,
 * so it is tested before the kind words. "8-10 representative problems" is a
 * problems target whether or not it also happens to contain the word "build".
 */
export function parsePractice(raw: string): PracticeTarget {
  const text = raw.trim();
  if (text === '') return empty('empty cell');

  const problemRange = PROBLEM_RANGE.exec(text);
  if (problemRange) {
    return numeric('problems', 'problems', problemRange[1], problemRange[2]);
  }

  const problemCount = PROBLEM_COUNT.exec(text);
  if (problemCount) {
    return numeric('problems', 'problems', problemCount[1], problemCount[1]);
  }

  /**
   * Two kinds at once is a coin toss, so it is flagged rather than decided.
   *
   * There is exactly one instruction in a cell, and if the text supports two
   * readings the person who wrote it is the one who knows which.
   */
  const kinds = KIND_WORDS.filter(({ pattern }) => pattern.test(text)).map(({ kind }) => kind);
  if (kinds.length > 1) {
    return empty(`reads as both ${kinds.join(' and ')}`);
  }

  const kind = kinds[0];
  if (!kind) return empty('no recognised target');

  const minuteRange = MINUTE_RANGE.exec(text);
  if (minuteRange) return numeric(kind, 'minutes', minuteRange[1], minuteRange[2]);

  const minuteCount = MINUTE_COUNT.exec(text);
  if (minuteCount) return numeric(kind, 'minutes', minuteCount[1], minuteCount[1]);

  // A kind with no number is still a real answer: "Explain jank investigation"
  // says what to do, just not how much of it.
  return {
    kind,
    unit: null,
    targetMin: null,
    targetMax: null,
    needsReview: false,
    reviewReason: null,
  };
}

function numeric(
  kind: TargetKind,
  unit: TargetUnit,
  min: string | undefined,
  max: string | undefined,
): PracticeTarget {
  const targetMin = Number(min);
  const targetMax = Number(max);

  // A malformed number would otherwise become NaN and travel silently.
  if (!Number.isInteger(targetMin) || !Number.isInteger(targetMax) || targetMin < 1) {
    return empty('unreadable number');
  }

  return {
    kind,
    unit,
    // Written the way it was read, even when the sheet has them backwards.
    targetMin,
    targetMax: Math.max(targetMin, targetMax),
    needsReview: false,
    reviewReason: null,
  };
}

/**
 * A one-line summary for the UI.
 *
 * Never invents a target. A row with nothing parsed reads as the raw text,
 * which is the honest rendering of "we did not understand this".
 */
export function describeTarget(target: PracticeTarget, raw: string): string {
  if (target.needsReview || target.unit === null || target.targetMin === null) return raw;

  const range =
    target.targetMax !== null && target.targetMax !== target.targetMin
      ? `${target.targetMin}-${target.targetMax}`
      : String(target.targetMin);

  return target.unit === 'minutes' ? `${range} min ${target.kind}` : `${range} problems`;
}
