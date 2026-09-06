import type { NotificationType } from '@/lib/schemas/notification';
import { STALENESS_CAP_MINUTES } from '@/lib/schemas/notification';
import { addDays, toDateKey, zonedTimeToUtc } from '@/lib/time';

/**
 * Delivery rules, as pure functions.
 *
 * No I/O, no clock reads -- `now` is always an argument, so quiet-hours
 * behaviour at 23:59 is a test rather than something you find out at 23:59.
 */

export interface QuietHours {
  /** Local wall clock, `HH:MM`, in APP_TIMEZONE. */
  start: string;
  end: string;
}

/**
 * Whether a local wall-clock instant falls inside the quiet window.
 *
 * The window normally wraps midnight (00:00-07:00 does not, but 22:00-07:00
 * does), so this cannot be a simple `start <= t < end` comparison. Both shapes
 * are handled.
 */
export function isWithinQuietHours(instant: Date, quiet: QuietHours, timeZone: string): boolean {
  const local = localMinutes(instant, timeZone);
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);

  if (start === end) return false; // Zero-width window: quiet hours disabled.

  return start < end
    ? local >= start && local < end
    : // Wraps midnight: inside if after the start OR before the end.
      local >= start || local < end;
}

/**
 * Moves an instant out of quiet hours, to the moment the window ends.
 *
 * Deferred rather than dropped. A notification about a deadline is still worth
 * having at 07:00; discarding it silently means the one night something
 * actually mattered is the night nothing was said.
 */
export function deferPastQuietHours(instant: Date, quiet: QuietHours, timeZone: string): Date {
  if (!isWithinQuietHours(instant, quiet, timeZone)) return instant;

  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  const local = localMinutes(instant, timeZone);

  // When the window wraps midnight and we are in its tail (after midnight,
  // before the end), the window ends TODAY. Otherwise it ends tomorrow.
  const endsToday = start < end || local < end;
  const dateKey = toDateKey(instant, timeZone);

  return zonedTimeToUtc(endsToday ? dateKey : addDays(dateKey, 1), quiet.end, timeZone);
}

/**
 * Whether a notification is too old to be worth delivering.
 *
 * Scheduled-in-the-future is never stale; a notification that has not come due
 * yet is simply pending.
 */
export function isStale(scheduledFor: Date, now: Date): boolean {
  const minutesLate = (now.getTime() - scheduledFor.getTime()) / 60_000;

  return minutesLate > STALENESS_CAP_MINUTES;
}

export type DeliveryDecision =
  { action: 'send' } | { action: 'skip'; reason: 'stale' | 'resolved' } | { action: 'hold' };

/**
 * What to do with one pending notification at `now`.
 *
 * ACCOUNTABILITY_CHECK is exempt from the staleness cap while its commitment is
 * still unresolved. The cap exists to stop a backlog of expired reminders, and
 * an unanswered accountability prompt has not expired -- the question "did you
 * do it?" is exactly as live a week later, and suppressing it would mean the
 * commitments avoided longest are the ones asked about least.
 */
export function decideDelivery(
  notification: { type: NotificationType; scheduledFor: Date },
  context: { commitmentResolved: boolean },
  now: Date,
): DeliveryDecision {
  if (notification.scheduledFor > now) return { action: 'hold' };

  if (context.commitmentResolved) return { action: 'skip', reason: 'resolved' };

  const exemptFromStaleness = notification.type === 'ACCOUNTABILITY_CHECK';
  if (!exemptFromStaleness && isStale(notification.scheduledFor, now)) {
    return { action: 'skip', reason: 'stale' };
  }

  return { action: 'send' };
}

function toMinutes(wallClock: string): number {
  const [hours = '0', minutes = '0'] = wallClock.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** Minutes since local midnight, in `timeZone`. */
function localMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');

  // Intl renders midnight as 24 in some locales.
  return (hour % 24) * 60 + minute;
}
