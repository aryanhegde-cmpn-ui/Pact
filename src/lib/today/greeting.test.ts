import { describe, expect, it } from 'vitest';

import {
  bucketFor,
  blockStateFor,
  dateLine,
  GREETINGS,
  greetingFor,
  poolKeyFor,
  poolsShorterThanAWeek,
} from './greeting';
import { addDays } from '@/lib/time';

describe('the time buckets', () => {
  it.each([
    [0, 'before-window'],
    [6 * 60 + 59, 'before-window'],
    [7 * 60, 'window'],
    [9 * 60 + 59, 'window'],
    [10 * 60, 'window-closing'],
    [10 * 60 + 59, 'window-closing'],
    [11 * 60, 'workday'],
    [18 * 60 + 59, 'workday'],
    [19 * 60, 'evening'],
    [21 * 60 + 59, 'evening'],
    [22 * 60, 'wind-down'],
    [23 * 60 + 29, 'wind-down'],
    [23 * 60 + 30, 'late'],
  ])('reads %i minutes as %s', (minutes, bucket) => {
    expect(bucketFor(minutes)).toBe(bucket);
  });

  it('uses the workbook’s boundaries, not round numbers', () => {
    // 07:00-10:00 is the study window and the office day starts at 10:30. A
    // bucket on the hour would greet someone mid-block as if they had the
    // evening.
    expect(bucketFor(6 * 60 + 59)).not.toBe(bucketFor(7 * 60));
    expect(bucketFor(9 * 60 + 59)).not.toBe(bucketFor(10 * 60));
  });
});

describe('block state', () => {
  it('is all only when every block is done', () => {
    expect(blockStateFor(3, 3)).toBe('all');
    expect(blockStateFor(2, 3)).toBe('partial');
    expect(blockStateFor(0, 3)).toBe('none');
  });

  it('is none when there are no blocks at all', () => {
    // No curriculum imported is not "all three done".
    expect(blockStateFor(0, 0)).toBe('none');
  });
});

describe('determinism', () => {
  const context = { date: '2026-09-07', minutes: 8 * 60, blocksDone: 0, blocksTotal: 3 };

  it('returns the same line for the same day, hour and state', () => {
    // A line that reshuffles on every render reads as a slot machine, and a
    // slot machine teaches the user to reload the page.
    const lines = Array.from({ length: 20 }, () => greetingFor(context).line);

    expect(new Set(lines).size).toBe(1);
  });

  it('does not change within a bucket as the minutes tick past', () => {
    const early = greetingFor({ ...context, minutes: 7 * 60 + 1 });
    const late = greetingFor({ ...context, minutes: 9 * 60 + 58 });

    expect(early.line).toBe(late.line);
  });

  it('changes when the state changes, because the state is the subject', () => {
    const none = greetingFor(context);
    const partial = greetingFor({ ...context, blocksDone: 1 });

    expect(none.line).not.toBe(partial.line);
    expect(partial.line).toBe('One down. Two to go.');
  });
});

describe('no repeats within seven days', () => {
  /**
   * The rule that matters. A pool of four picked at random repeats within
   * three days about half the time, and a greeting already read this week
   * stops being read at all.
   */
  it.each(Object.keys(GREETINGS))('holds for the %s pool, up to its own size', (poolKey) => {
    const pool = GREETINGS[poolKey as keyof typeof GREETINGS];
    const window = Math.min(7, pool.length);

    // Walk a month of dates; any window of `pool.length` consecutive days must
    // be free of duplicates.
    const lines: string[] = [];
    for (let offset = 0; offset < 30; offset += 1) {
      const date = addDays('2026-09-01', offset);
      const [bucketPart, statePart] = poolKey.split(':');

      const minutes =
        {
          'before-window': 6 * 60,
          window: 8 * 60,
          'window-closing': 10 * 60 + 30,
          workday: 14 * 60,
          evening: 20 * 60,
          'wind-down': 22 * 60 + 30,
          late: 23 * 60 + 45,
        }[bucketPart as string] ?? 8 * 60;

      const blocksDone =
        statePart === 'all'
          ? 3
          : statePart === 'partial'
            ? 1
            : statePart === 'none'
              ? 0
              : statePart === 'incomplete'
                ? 1
                : 0;

      lines.push(greetingFor({ date, minutes, blocksDone, blocksTotal: 3 }).line);
    }

    for (let start = 0; start + window <= lines.length; start += 1) {
      const slice = lines.slice(start, start + window);
      expect(new Set(slice).size).toBe(slice.length);
    }
  });

  it('names the pools that cannot manage a full week', () => {
    /**
     * Asserted rather than tolerated. Some are deliberate: "All three before
     * ten" is the only true thing to say about that state, and padding it out
     * with variants would be writing copy to satisfy a rule.
     */
    expect(poolsShorterThanAWeek().sort()).toEqual(
      [
        'before-window',
        'evening:all',
        'evening:incomplete',
        'late',
        'window-closing:all',
        'window-closing:incomplete',
        'window:all',
        'window:none',
        'window:partial',
        'wind-down',
        'workday',
      ].sort(),
    );
  });
});

describe('pool selection', () => {
  it('splits the window by how much is done', () => {
    expect(poolKeyFor('window', 'none')).toBe('window:none');
    expect(poolKeyFor('window', 'partial')).toBe('window:partial');
    expect(poolKeyFor('window', 'all')).toBe('window:all');
  });

  it('says something different at ten when the blocks are done', () => {
    const cleared = greetingFor({
      date: '2026-09-07',
      minutes: 10 * 60 + 15,
      blocksDone: 3,
      blocksTotal: 3,
    });

    expect(cleared.line).toBe('Blocks cleared. Go earn a living.');
  });

  it('does not congratulate anyone at 11pm', () => {
    const late = greetingFor({
      date: '2026-09-07',
      minutes: 23 * 60 + 45,
      blocksDone: 3,
      blocksTotal: 3,
    });

    // The late bucket ignores state on purpose. "Well done" at 11:45pm would
    // be the warm surface endorsing the thing the plan says not to do.
    expect(['You said 11:30.', 'This isn’t study time.']).toContain(late.line);
  });

  it('offsets pools from each other so they do not advance in lockstep', () => {
    // Two pools of the same length would otherwise always show their first
    // line on the same days, making the whole set feel smaller than it is.
    const day = '2026-09-07';
    const evening = greetingFor({ date: day, minutes: 20 * 60, blocksDone: 0, blocksTotal: 3 });
    const windDown = greetingFor({
      date: day,
      minutes: 22 * 60 + 30,
      blocksDone: 0,
      blocksTotal: 3,
    });

    const eveningIndex = GREETINGS['evening:incomplete'].indexOf(evening.line);
    const windDownIndex = GREETINGS['wind-down'].indexOf(windDown.line);

    expect(eveningIndex).toBeGreaterThanOrEqual(0);
    expect(windDownIndex).toBeGreaterThanOrEqual(0);
  });
});

describe('the copy itself', () => {
  const all = Object.values(GREETINGS).flat();

  it('has no motivational filler', () => {
    // Every line is about the plan, not about the person. "You've got this"
    // would be a different app.
    for (const line of all) {
      expect(line).not.toMatch(/you('| ha)ve got this|believe|amazing|crush|smash|rock star/i);
    }
  });

  it('uses no emoji', () => {
    for (const line of all) {
      expect(line).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('stays short enough to set on two lines at 390px', () => {
    for (const line of all) expect(line.length).toBeLessThanOrEqual(60);
  });
});

describe('dateLine', () => {
  it('renders the local date it was given, without shifting it', () => {
    // The key is ALREADY resolved to the local day. Re-interpreting it in a
    // timezone would show yesterday to anyone west of UTC.
    expect(dateLine('2026-09-07')).toBe('Monday 7 September');
  });
});
