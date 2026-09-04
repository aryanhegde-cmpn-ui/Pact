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
