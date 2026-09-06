import type { BlockId } from '@/lib/schemas/curriculum';
import { weekdayOf, type DateKey } from '@/lib/time';

/**
 * The workbook's weekly rhythm, verbatim.
 *
 * Pure data plus pure functions over it: no I/O, no clock. The date is passed
 * in.
 *
 * This table is what makes a day's suggestion something other than "the next
 * unfinished row". Monday's frontend block is machine coding and Thursday's is
 * React and testing, and a generator that ignored that would produce a plan
 * the user has to override every single morning -- at which point the
 * suggestion is worse than nothing, because it is friction that also pretends
 * to be help.
 */

export interface RhythmRow {
  /** 0 = Sunday, matching `weekdayOf`. */
  weekday: number;
  label: string;
  /** The sheet's cells, verbatim. Shown in the UI as the day's slant. */
  dsa: string;
  frontend: string;
  systemDesign: string;
  output: string;
}

/** Rows in the sheet's order, keyed by weekday rather than by position. */
export const WEEKLY_RHYTHM: readonly RhythmRow[] = [
  {
    weekday: 1,
    label: 'Mon',
    dsa: 'New',
    frontend: 'Machine coding',
    systemDesign: 'New concept',
    output: 'Build',
  },
  {
    weekday: 2,
    label: 'Tue',
    dsa: 'New',
    frontend: 'JS / browser',
    systemDesign: 'New concept',
    output: 'Notes + code',
  },
  {
    weekday: 3,
    label: 'Wed',
    dsa: 'New',
    frontend: 'Machine coding',
    systemDesign: 'Case study',
    output: 'Build',
  },
  {
    weekday: 4,
    label: 'Thu',
    dsa: 'New',
    frontend: 'React / testing',
    systemDesign: 'New concept',
    output: 'Tests',
  },
  {
    weekday: 5,
    label: 'Fri',
    dsa: 'New',
    frontend: 'Machine coding',
    systemDesign: 'Case study',
    output: 'Build',
  },
  {
    weekday: 6,
    label: 'Sat',
    dsa: 'Timed mixed set',
    frontend: 'Longer build / mock',
    systemDesign: '45–60 min design',
    output: 'Mock interview',
  },
  {
    weekday: 0,
    label: 'Sun',
    dsa: 'Revision',
    frontend: 'Weak-area review',
    systemDesign: 'Review',
    output: 'Plan next week',
  },
];

export function rhythmFor(dateKey: DateKey): RhythmRow {
  const weekday = weekdayOf(dateKey);
  const row = WEEKLY_RHYTHM.find((entry) => entry.weekday === weekday);

  // The table covers all seven days; this is here so the type is honest.
  if (!row) throw new Error(`No rhythm row for weekday ${weekday}.`);

  return row;
}

/** The cell that governs a given block on a given day. */
export function slantFor(dateKey: DateKey, blockId: BlockId): string {
  const row = rhythmFor(dateKey);

  switch (blockId) {
    case 'block-1':
      return row.dsa;
    case 'block-2':
      return row.frontend;
    case 'block-3':
      return row.systemDesign;
    default:
      // The evening rows have no slant: the sheet gives them no weekly column,
      // and inventing one would be the generator deciding what the evening is
      // for.
      return '';
  }
}

/**
 * Whether the day's slant is about going back over material.
 *
 * Sunday says Revision / Weak-area review / Review across all three blocks,
 * which is the day `needs-revision` topics are meant to be picked up. Read
 * from the cell text rather than from `weekday === 0`, so moving the rhythm
 * moves the behaviour with it.
 */
export function isRevisionSlant(slant: string): boolean {
  return /\brevision\b|\brevise\b|\breview\b|\bweak\b/i.test(slant);
}
