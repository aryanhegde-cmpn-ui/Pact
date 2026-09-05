import type { RecurrenceRule } from '@/lib/schemas/series';
import { addDays, daysBetween, weekdayOf, type DateKey } from '@/lib/time';

/**
 * Which local dates a rule produces inside a window.
 *
 * Pure: date keys in, date keys out. No clock, no I/O. Rules are evaluated on
 * the local calendar in APP_TIMEZONE because "every Tuesday" is a statement
 * about local days -- converting to an instant happens later, when an
 * occurrence is materialised.
 */
export function occurrenceDatesInRange(
  rule: RecurrenceRule,
  seriesStart: DateKey,
  seriesEnd: DateKey | null,
  rangeStart: DateKey,
  rangeEnd: DateKey,
): DateKey[] {
  // Clamp the window to the series' own lifetime.
  const from = rangeStart > seriesStart ? rangeStart : seriesStart;
  const to = seriesEnd && seriesEnd < rangeEnd ? seriesEnd : rangeEnd;

  if (from > to) return [];

  const dates: DateKey[] = [];

  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
    if (matchesRule(rule, seriesStart, cursor)) {
      dates.push(cursor);
    }
  }

  return dates;
}

/** Whether one local date is an occurrence of the rule. */
export function matchesRule(rule: RecurrenceRule, seriesStart: DateKey, date: DateKey): boolean {
  if (date < seriesStart) return false;

  const elapsed = daysBetween(seriesStart, date);

  switch (rule.frequency) {
    case 'daily':
      return elapsed % rule.interval === 0;

    case 'weekly': {
      if (!rule.byWeekday.includes(weekdayOf(date))) return false;

      // Interval counts WEEKS from the series' first week, measured from that
      // week's Sunday. Counting from the start date itself would make a
      // fortnightly series drift whenever the start date and the selected
      // weekday fall in different weeks.
      const startOfFirstWeek = addDays(seriesStart, -weekdayOf(seriesStart));
      const startOfThisWeek = addDays(date, -weekdayOf(date));
      const weeksElapsed = daysBetween(startOfFirstWeek, startOfThisWeek) / 7;

      return weeksElapsed % rule.interval === 0;
    }

    case 'monthly': {
      const [startYear, startMonth, startDay] = seriesStart.split('-').map(Number) as [
        number,
        number,
        number,
      ];
      const [year, month, day] = date.split('-').map(Number) as [number, number, number];

      const monthsElapsed = (year - startYear) * 12 + (month - startMonth);
      if (monthsElapsed < 0 || monthsElapsed % rule.interval !== 0) return false;

      if (day === startDay) return true;

      // A series starting on the 31st has no 31st in November. Fire on the
      // last day of the month instead of skipping it -- skipping silently
      // drops occurrences the user expected, which is worse than a day's drift.
      const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return startDay > lastDayOfMonth && day === lastDayOfMonth;
    }

    default:
      return false;
  }
}
