import type { DateKey } from '@/lib/time';

/**
 * The greeting.
 *
 * ---------------------------------------------------------------------------
 * DETERMINISTIC, AND IT DOES NOT REPEAT WITHIN A WEEK.
 * ---------------------------------------------------------------------------
 * Selected from the date, the time bucket and the block state -- never from a
 * random number. A line that reshuffles on every render reads as a slot
 * machine, and a slot machine is a reward schedule: it teaches the user to
 * reload the page, which is engagement with the tool rather than execution of
 * the work.
 *
 * The seven-day rule is the other half. A pool of four lines picked at random
 * repeats within three days about half the time, and a greeting you have
 * already read this week stops being read at all.
 *
 * These are not motivational quotes and there is no generator. They are short,
 * factual, occasionally dry, and every one of them is about the plan rather
 * than about the person. "You've got this" would be a different app.
 * ---------------------------------------------------------------------------
 *
 * TO ADD A LINE: put it in the pool below. Nothing else changes -- no
 * component imports a string, and the selection is the only logic.
 */

/**
 * When, in the user's local day.
 *
 * The boundaries are the workbook's, not round numbers: the study window is
 * 07:00-10:00, the office day starts at 10:30, and the evening slot is capped
 * at 30-60 minutes. A bucket that ignored those would greet someone mid-block
 * as if they had the evening.
 */
export type TimeBucket =
  'before-window' | 'window' | 'window-closing' | 'workday' | 'evening' | 'wind-down' | 'late';

/** How much of the plan is done. Blocks only -- other work does not count. */
export type BlockState = 'none' | 'partial' | 'all';

export interface GreetingContext {
  /** Local date, for both the bucket boundaries and the no-repeat window. */
  date: DateKey;
  /** Minutes since local midnight. */
  minutes: number;
  blocksDone: number;
  blocksTotal: number;
}

export function bucketFor(minutes: number): TimeBucket {
  if (minutes < 7 * 60) return 'before-window';
  if (minutes < 10 * 60) return 'window';
  if (minutes < 11 * 60) return 'window-closing';
  if (minutes < 19 * 60) return 'workday';
  if (minutes < 22 * 60) return 'evening';
  if (minutes < 23 * 60 + 30) return 'wind-down';

  return 'late';
}

export function blockStateFor(done: number, total: number): BlockState {
  if (total > 0 && done >= total) return 'all';
  if (done > 0) return 'partial';

  return 'none';
}

/** A pool key: the bucket, narrowed by block state where the copy differs. */
type PoolKey =
  | 'before-window'
  | 'window:none'
  | 'window:partial'
  | 'window:all'
  | 'window-closing:all'
  | 'window-closing:incomplete'
  | 'workday'
  | 'evening:incomplete'
  | 'evening:all'
  | 'wind-down'
  | 'late';

/**
 * The lines.
 *
 * Add to a pool freely; the selection handles any length. A pool of one is
 * fine and simply repeats, which is correct for a state that has exactly one
 * true thing to say about it.
 */
export const GREETINGS: Record<PoolKey, readonly string[]> = {
  'before-window': [
    "Nothing's due yet. Enjoy it.",
    'Seven o’clock is coming either way.',
    'Up before the blocks. Good.',
  ],

  'window:none': [
    'Block 1. Now would be the time.',
    'Three hours. That’s the whole plan for today.',
    'The window is open.',
    'This is the part that counts.',
  ],
  'window:partial': [
    'One down. Two to go.',
    'Block 1 cleared. Keep moving.',
    'Halfway through the window.',
  ],
  'window:all': ['All three before ten. That’s a good day already.'],

  'window-closing:all': ['Blocks cleared. Go earn a living.'],
  'window-closing:incomplete': [
    'The window’s closed. Two blocks unclaimed.',
    'That’s the morning gone.',
  ],

  workday: [
    'You’re at work. Pact can wait.',
    'Nothing here needs you until tonight.',
    'Collect something worth putting on the resume.',
  ],

  'evening:incomplete': [
    'Evening. Finish or revise, nothing new.',
    'Thirty minutes, not three hours.',
  ],
  'evening:all': ['Day’s closed. Leave it alone.'],

  'wind-down': ['Sleep is part of the plan.', 'Whatever’s left will still be there at seven.'],
  late: ['You said 11:30.', 'This isn’t study time.'],
};

export function poolKeyFor(bucket: TimeBucket, state: BlockState): PoolKey {
  switch (bucket) {
    case 'window':
      return `window:${state}` as PoolKey;
    case 'window-closing':
      return state === 'all' ? 'window-closing:all' : 'window-closing:incomplete';
    case 'evening':
      return state === 'all' ? 'evening:all' : 'evening:incomplete';
    default:
      return bucket;
  }
}

/**
 * Days since a fixed epoch. The rotation index.
 *
 * Using the date rather than a counter means the choice is a pure function of
 * when you looked, so two devices on the same morning show the same line and
 * neither of them changes it by reloading.
 */
function dayNumber(date: DateKey): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];

  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * A small stable hash of the pool key.
 *
 * Two pools of the same length would otherwise advance in lockstep and always
 * show their first line on the same days, which makes the whole set feel
 * smaller than it is. Offsetting each pool by its own name decorrelates them.
 */
function keyOffset(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 100_003;

  return hash;
}

export interface Greeting {
  line: string;
  bucket: TimeBucket;
  blockState: BlockState;
  poolKey: PoolKey;
}

/**
 * Picks the line.
 *
 * A rotation, not a shuffle: consecutive days step through the pool in order,
 * which is what guarantees no repeat inside `pool.length` days. Where a pool is
 * shorter than seven the repeat is unavoidable and the honest answer is a
 * bigger pool, not a cleverer picker -- `poolsShorterThanAWeek` says which.
 */
export function greetingFor(context: GreetingContext): Greeting {
  const bucket = bucketFor(context.minutes);
  const blockState = blockStateFor(context.blocksDone, context.blocksTotal);
  const poolKey = poolKeyFor(bucket, blockState);
  const pool = GREETINGS[poolKey];

  const index = (dayNumber(context.date) + keyOffset(poolKey)) % pool.length;

  return { line: pool[index] ?? pool[0] ?? '', bucket, blockState, poolKey };
}

/**
 * Pools that cannot avoid repeating inside a week.
 *
 * Exported so a test names them rather than silently tolerating them. Some are
 * deliberate: "All three before ten" is the only true thing to say about that
 * state, and padding it out with variants would be writing copy for the sake
 * of a rule.
 */
export function poolsShorterThanAWeek(): PoolKey[] {
  return (Object.keys(GREETINGS) as PoolKey[]).filter((key) => GREETINGS[key].length < 7);
}

/**
 * The date line above the greeting.
 *
 * Formatted in UTC on purpose: the date key has ALREADY been resolved to the
 * local day in `APP_TIMEZONE`, so re-interpreting it in a timezone would shift
 * it back and show yesterday's date to anyone west of UTC.
 */
export function dateLine(date: DateKey): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
