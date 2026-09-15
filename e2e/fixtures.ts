/**
 * Fixture identities, shared between a setup project and the specs that borrow
 * from it.
 *
 * A plain module rather than an export from `overseer.setup.ts`, because
 * Playwright refuses to let one test file import another -- and it is right to:
 * importing a setup file would run its `setup(...)` registrations inside the
 * importing project.
 *
 * The credentials are fixture credentials for a scratch database. Every script
 * that writes them refuses to run against anything else.
 */
export const OVERSEER_STORAGE = 'test-results/.auth/overseer.json';
export const OVERSEER_USERNAME = 'overseer1';
export const OVERSEER_PASSWORD = 'OverseerPass2026x';

/**
 * A deadline that is still TODAY in the app's timezone.
 *
 * ---------------------------------------------------------------------------
 * "NOW PLUS FOUR HOURS" IS NOT TODAY AFTER EIGHT IN THE EVENING.
 * ---------------------------------------------------------------------------
 * Several specs created a commitment four to six hours out and then asserted it
 * appeared on Today. That works all afternoon and fails every evening: the
 * deadline lands after midnight, `alsoToday` correctly excludes it, and the
 * failure reads as "the row is missing" rather than "the fixture is wrong".
 *
 * Late enough in the day to be in the future, early enough to be before
 * midnight, in `APP_TIMEZONE` rather than the runner's zone -- the two are the
 * same on this machine and will not be on CI.
 * ---------------------------------------------------------------------------
 */
export function dueLaterToday(timeZone = 'Asia/Kolkata'): string {
  const now = new Date();

  // Today's date as the app sees it, then 23:55 on that date.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  // The offset the zone is at right now, so the wall-clock time can be turned
  // back into an instant without pulling in a date library.
  const offsetMinutes = zoneOffsetMinutes(now, timeZone);
  const local = Date.parse(`${parts}T23:55:00.000Z`) - offsetMinutes * 60_000;

  // If it is already past 23:55 there, one minute out is the best available --
  // still today, still in the future.
  return new Date(Math.max(local, now.getTime() + 60_000)).toISOString();
}

function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  const get = (type: string): number =>
    Number(formatted.find((part) => part.type === type)?.value ?? '0');

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );

  return Math.round((asUtc - at.getTime()) / 60_000);
}
