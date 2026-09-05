import { formatWallClock } from '@/lib/time';

/** Renders an instant as a short local wall clock, e.g. "Sat 5 Sep, 14:30". */
export function formatDue(iso: string, timeZone: string): string {
  const date = new Date(iso);

  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
  const time = formatWallClock(date, timeZone).slice(11, 16);

  return `${day}, ${time}`;
}

/** "2h 15m overdue" / "45m overdue". Plain, never scolding. */
export function formatOverdue(minutes: number): string {
  if (minutes < 60) return `${minutes}m overdue`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours}h overdue` : `${hours}h ${rest}m overdue`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}d overdue` : `${days}d ${restHours}h overdue`;
}

export function formatEstimate(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
