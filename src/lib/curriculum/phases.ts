import type { DateKey } from '@/lib/time';

/**
 * Turning the workbook's phase rows into real dates and real focus lists.
 *
 * Pure: no I/O, no clock. The anchor date is passed in.
 *
 * The sheet writes phase 1 as "Sep 7-Sep 30" and the rest as bare month names
 * -- "October", "November". A month name is not a date range until someone
 * says which year, and "January" is the year after the others. Getting that
 * wrong would put the last phase eleven months in the past, and every drift
 * reading after it would say the plan was finished before it started.
 */

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

/** Matches "Sep", "September", case-insensitively. Returns a 0-based month. */
function monthIndex(word: string): number | null {
  const lower = word.trim().toLowerCase();
  const index = MONTHS.findIndex((name) => name.startsWith(lower) && lower.length >= 3);

  return index === -1 ? null : index;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dateKey(year: number, month: number, day: number): DateKey {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/** Last day of a month, leap years included. Day 0 of the next month. */
function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

interface ParsedRange {
  startMonth: number;
  startDay: number | null;
  endMonth: number;
  endDay: number | null;
}

/**
 * Reads one Dates cell into months and optional days, with no year yet.
 *
 * Returns null when the cell is not a shape it understands, so an unreadable
 * phase is a loud import failure rather than a phase silently starting today.
 */
export function parseDatesCell(cell: string): ParsedRange | null {
  const text = cell.trim();

  // "Sep 7-Sep 30", "Sep 7 - September 30". En dash, em dash or hyphen.
  const range = /^([A-Za-z]+)\s+(\d{1,2})\s*[–—-]\s*([A-Za-z]+)\s+(\d{1,2})$/.exec(text);
  if (range) {
    const startMonth = monthIndex(range[1] ?? '');
    const endMonth = monthIndex(range[3] ?? '');
    if (startMonth === null || endMonth === null) return null;

    return {
      startMonth,
      startDay: Number(range[2]),
      endMonth,
      endDay: Number(range[4]),
    };
  }

  // "October" -- the whole month.
  const whole = monthIndex(text);
  if (whole !== null) return { startMonth: whole, startDay: null, endMonth: whole, endDay: null };

  return null;
}

export interface PhaseDates {
  startDate: DateKey;
  endDate: DateKey;
}

/**
 * Assigns years to a list of phase cells, in order.
 *
 * The rule is simply that phases move forward. Each phase starts in the same
 * year as the previous one unless its month is earlier, in which case the year
 * rolls over -- which is how "January" lands in 2027 rather than 2026 without
 * anybody hardcoding it.
 *
 * Throws on an unreadable cell. An import that quietly skipped a phase would
 * leave the drift calculation with a gap in the schedule and no sign of one.
 */
export function normalisePhaseDates(cells: string[], anchorYear: number): PhaseDates[] {
  const out: PhaseDates[] = [];
  let year = anchorYear;
  let previousMonth = -1;

  for (const [index, cell] of cells.entries()) {
    const parsed = parseDatesCell(cell);
    if (!parsed) {
      throw new Error(
        `Phase ${index + 1}: cannot read the dates "${cell}".\n` +
          'Expected a month name ("October") or a range ("Sep 7-Sep 30").',
      );
    }

    if (parsed.startMonth < previousMonth) year += 1;
    previousMonth = parsed.startMonth;

    // A range that ends before it starts wraps into the next year too.
    const endYear = parsed.endMonth < parsed.startMonth ? year + 1 : year;

    out.push({
      startDate: dateKey(year, parsed.startMonth, parsed.startDay ?? 1),
      endDate: dateKey(
        endYear,
        parsed.endMonth,
        parsed.endDay ?? lastDay(endYear, parsed.endMonth),
      ),
    });
  }

  return out;
}

export interface DerivedFocus {
  focusCategories: string[];
  focusModules: string[];
  revisionOnly: boolean;
  revisionBias: boolean;
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Works out which parts of the curriculum a phase's prose is pointing at.
 *
 * Matched against the category and module names that actually exist in the
 * imported curriculum -- never against an invented vocabulary. If the sheet's
 * focus text says "Browser / performance", that resolves because there is a
 * module called Browser and a category called Performance; if it said
 * something with no counterpart in the data, it resolves to nothing and the
 * suggestion falls back to the block's own order.
 *
 * A phase whose focus matches nothing is not an error. It means the phase is
 * about something the curriculum sheet does not itemise -- "Applications +
 * interviews" is a real phase and has no topics of its own.
 */
export function deriveFocus(
  phase: { primaryFocus: string; secondaryFocus: string; rule: string },
  vocabulary: { categories: string[]; modules: string[] },
): DerivedFocus {
  const text = `${phase.primaryFocus} ${phase.secondaryFocus}`;
  const matches = (name: string) => new RegExp(`\\b${escape(name)}\\b`, 'i').test(text);

  return {
    focusCategories: vocabulary.categories.filter(matches),
    focusModules: vocabulary.modules.filter(matches),
    // "Study only gaps that appear": new material is not on the menu at all.
    revisionOnly: /\bonly\b[^.]*\bgaps?\b/i.test(phase.rule),
    revisionBias: /\brevisi(on|ng)\b|\brevise\b/i.test(`${text} ${phase.rule}`),
  };
}
