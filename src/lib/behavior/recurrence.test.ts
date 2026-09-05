import { describe, expect, it } from 'vitest';

import { matchesRule, occurrenceDatesInRange } from './recurrence';
import type { RecurrenceRule } from '@/lib/schemas/series';

const daily = (interval = 1): RecurrenceRule => ({
  frequency: 'daily',
  interval,
  byWeekday: [],
  timeOfDay: '09:00',
  estimateMinutes: 30,
});

const weekly = (byWeekday: number[], interval = 1): RecurrenceRule => ({
  frequency: 'weekly',
  interval,
  byWeekday,
  timeOfDay: '09:00',
  estimateMinutes: 30,
});

const monthly = (interval = 1): RecurrenceRule => ({
  frequency: 'monthly',
  interval,
  byWeekday: [],
  timeOfDay: '09:00',
  estimateMinutes: 30,
});

describe('daily', () => {
  it('produces every day in the window', () => {
    const dates = occurrenceDatesInRange(daily(), '2026-09-01', null, '2026-09-03', '2026-09-06');

    expect(dates).toEqual(['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
  });

  it('honours an interval', () => {
    const dates = occurrenceDatesInRange(daily(3), '2026-09-01', null, '2026-09-01', '2026-09-10');

    expect(dates).toEqual(['2026-09-01', '2026-09-04', '2026-09-07', '2026-09-10']);
  });

  it('never produces a date before the series starts', () => {
    const dates = occurrenceDatesInRange(daily(), '2026-09-05', null, '2026-09-01', '2026-09-06');

    expect(dates).toEqual(['2026-09-05', '2026-09-06']);
  });

  it('stops at the series end date', () => {
    const dates = occurrenceDatesInRange(
      daily(),
      '2026-09-01',
      '2026-09-03',
      '2026-09-01',
      '2026-09-10',
    );

    expect(dates).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
  });

  it('crosses a month boundary', () => {
    const dates = occurrenceDatesInRange(daily(), '2026-09-29', null, '2026-09-29', '2026-10-02');

    expect(dates).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  });
});

describe('weekly', () => {
  it('fires only on the chosen weekdays', () => {
    // 2026-09-07 is a Monday.
    const dates = occurrenceDatesInRange(
      weekly([1, 3]), // Monday, Wednesday
      '2026-09-07',
      null,
      '2026-09-07',
      '2026-09-20',
    );

    expect(dates).toEqual(['2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16']);
  });

  it('handles fortnightly without drifting', () => {
    // Every other Monday from 2026-09-07.
    const dates = occurrenceDatesInRange(
      weekly([1], 2),
      '2026-09-07',
      null,
      '2026-09-07',
      '2026-10-19',
    );

    expect(dates).toEqual(['2026-09-07', '2026-09-21', '2026-10-05', '2026-10-19']);
  });

  it('keeps a fortnightly rhythm when the start date is not the chosen weekday', () => {
    // Series starts Wednesday 2026-09-09 but fires on Mondays. The interval is
    // counted in whole weeks, so the first Monday is in the START week's cycle.
    const dates = occurrenceDatesInRange(
      weekly([1], 2),
      '2026-09-09',
      null,
      '2026-09-09',
      '2026-10-06',
    );

    // Every occurrence must be 14 days apart -- no 7-day gap from drift.
    for (let i = 1; i < dates.length; i += 1) {
      const previous = new Date(`${dates[i - 1]}T00:00:00Z`).getTime();
      const current = new Date(`${dates[i]}T00:00:00Z`).getTime();
      expect((current - previous) / 86_400_000).toBe(14);
    }
  });
});

describe('monthly', () => {
  it('fires on the same day each month', () => {
    const dates = occurrenceDatesInRange(monthly(), '2026-01-15', null, '2026-01-01', '2026-04-30');

    expect(dates).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
  });

  it('falls back to the last day when the month is too short', () => {
    // A series on the 31st has no 31st in February, April, June...
    const dates = occurrenceDatesInRange(monthly(), '2026-01-31', null, '2026-01-01', '2026-04-30');

    // Skipping them silently would drop occurrences the user expected.
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('handles February in a leap year', () => {
    const dates = occurrenceDatesInRange(monthly(), '2028-01-31', null, '2028-02-01', '2028-02-29');

    expect(dates).toEqual(['2028-02-29']);
  });
});

describe('matchesRule', () => {
  it('is false before the series start', () => {
    expect(matchesRule(daily(), '2026-09-05', '2026-09-04')).toBe(false);
  });

  it('agrees with the range generator', () => {
    const rule = weekly([2, 4]);
    const dates = occurrenceDatesInRange(rule, '2026-09-01', null, '2026-09-01', '2026-09-30');

    for (const date of dates) {
      expect(matchesRule(rule, '2026-09-01', date)).toBe(true);
    }
  });
});

describe('empty windows', () => {
  it('returns nothing when the range ends before the series starts', () => {
    expect(occurrenceDatesInRange(daily(), '2026-09-10', null, '2026-09-01', '2026-09-05')).toEqual(
      [],
    );
  });

  it('returns nothing when the range begins after the series ended', () => {
    expect(
      occurrenceDatesInRange(daily(), '2026-09-01', '2026-09-05', '2026-09-10', '2026-09-20'),
    ).toEqual([]);
  });
});
