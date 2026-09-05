/**
 * Time helpers.
 *
 * Storage is UTC everywhere. These functions exist only to render an instant in
 * the operator's zone -- see the timezone convention in CLAUDE.md.
 */

/** `2026-09-04T13:45:07` as seen in `timeZone`. No zone suffix: it is a wall clock. */
export function formatWallClock(date: Date, timeZone: string): string {
  // `sv-SE` is the shortest route to ISO-shaped output from Intl.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(' ', 'T');
}

/** The zone's UTC offset at `date`, e.g. `+05:30`. */
export function utcOffset(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(date);

  const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  // Intl renders UTC itself as bare "GMT" rather than "GMT+00:00".
  return name === 'GMT' ? '+00:00' : name.replace('GMT', '');
}

/**
 * A calendar date in `APP_TIMEZONE`, as `YYYY-MM-DD`.
 *
 * Recurrence works in calendar days, not instants: "every Tuesday" is a
 * statement about local dates, and the UTC instant it lands on shifts with the
 * offset. Storing an occurrence's identity as a date key rather than a `Date`
 * is what keeps `(seriesId, occurrenceDate)` unique across a zone change --
 * two instants can be the same local day, and a `Date`-keyed index would let
 * both through.
 */
export type DateKey = string;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isDateKey(value: string): boolean {
  return DATE_KEY.test(value);
}

/** The calendar date `instant` falls on, as seen in `timeZone`. */
export function toDateKey(instant: Date, timeZone: string): DateKey {
  // `en-CA` yields YYYY-MM-DD directly.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** The zone's offset from UTC at `instant`, in minutes east of Greenwich. */
export function offsetMinutes(instant: Date, timeZone: string): number {
  const offset = utcOffset(instant, timeZone); // "+05:30"
  const sign = offset.startsWith('-') ? -1 : 1;
  const [hours = '0', minutes = '0'] = offset.slice(1).split(':');

  return sign * (Number(hours) * 60 + Number(minutes));
}

/**
 * The UTC instant at which the wall clock in `timeZone` reads
 * `dateKey` `timeOfDay`.
 *
 * Two passes, because the offset depends on the answer: the first guess uses
 * the offset at the naive instant, which is wrong when that guess lands on the
 * other side of a DST transition. Re-reading the offset at the corrected
 * instant fixes it. `Asia/Kolkata` has no DST, but this must not be the kind of
 * helper that only works in one zone.
 */
export function zonedTimeToUtc(dateKey: DateKey, timeOfDay: string, timeZone: string): Date {
  if (!DATE_KEY.test(dateKey)) throw new RangeError(`Not a date key: ${dateKey}`);
  if (!TIME_OF_DAY.test(timeOfDay)) throw new RangeError(`Not a time of day: ${timeOfDay}`);

  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  const [hour, minute] = timeOfDay.split(':').map(Number) as [number, number];

  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const firstPass = naive - offsetMinutes(new Date(naive), timeZone) * 60_000;
  const secondPass = naive - offsetMinutes(new Date(firstPass), timeZone) * 60_000;

  return new Date(secondPass);
}

/** `dateKey` shifted by whole calendar days. Never touches a clock. */
export function addDays(dateKey: DateKey, days: number): DateKey {
  if (!DATE_KEY.test(dateKey)) throw new RangeError(`Not a date key: ${dateKey}`);

  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  return shifted.toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: DateKey, to: DateKey): number {
  const parse = (key: DateKey): number => {
    const [y, m, d] = key.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };

  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** Day of the week for a date key: 0 = Sunday, matching `Date.getUTCDay()`. */
export function weekdayOf(dateKey: DateKey): number {
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];

  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
