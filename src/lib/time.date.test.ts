import { describe, expect, it } from 'vitest';

import { addDays, daysBetween, offsetMinutes, toDateKey, weekdayOf, zonedTimeToUtc } from './time';

const IST = 'Asia/Kolkata';
const NY = 'America/New_York';
const UTC = 'UTC';

describe('toDateKey', () => {
  it('uses the local calendar date, not the UTC one', () => {
    // 18:30 UTC is already the next day in IST (+05:30).
    const instant = new Date('2026-09-05T18:30:00.000Z');

    expect(toDateKey(instant, UTC)).toBe('2026-09-05');
    expect(toDateKey(instant, IST)).toBe('2026-09-06');
  });

  it('handles the other direction, where local is behind UTC', () => {
    const instant = new Date('2026-09-05T02:00:00.000Z');

    expect(toDateKey(instant, UTC)).toBe('2026-09-05');
    expect(toDateKey(instant, NY)).toBe('2026-09-04');
  });
});

describe('offsetMinutes', () => {
  it('reads a half-hour offset', () => {
    expect(offsetMinutes(new Date('2026-09-05T00:00:00Z'), IST)).toBe(330);
  });

  it('reads a negative offset', () => {
    expect(offsetMinutes(new Date('2026-01-15T00:00:00Z'), NY)).toBe(-300);
  });

  it('follows DST', () => {
    // Same zone, six months apart: EST then EDT.
    expect(offsetMinutes(new Date('2026-01-15T12:00:00Z'), NY)).toBe(-300);
    expect(offsetMinutes(new Date('2026-07-15T12:00:00Z'), NY)).toBe(-240);
  });

  it('is zero for UTC', () => {
    expect(offsetMinutes(new Date('2026-09-05T00:00:00Z'), UTC)).toBe(0);
  });
});

describe('zonedTimeToUtc', () => {
  it('round-trips through toDateKey', () => {
    const instant = zonedTimeToUtc('2026-09-05', '09:00', IST);

    expect(instant.toISOString()).toBe('2026-09-05T03:30:00.000Z');
    expect(toDateKey(instant, IST)).toBe('2026-09-05');
  });

  it('keeps a late-night local time on the right local date', () => {
    // 23:30 IST is 18:00 UTC the same day...
    const instant = zonedTimeToUtc('2026-09-05', '23:30', IST);
    expect(instant.toISOString()).toBe('2026-09-05T18:00:00.000Z');
    // ...and must still read back as the 5th locally.
    expect(toDateKey(instant, IST)).toBe('2026-09-05');
  });

  it('keeps an early-morning local time on the right local date', () => {
    // 00:30 IST is the PREVIOUS day in UTC.
    const instant = zonedTimeToUtc('2026-09-05', '00:30', IST);

    expect(instant.toISOString()).toBe('2026-09-04T19:00:00.000Z');
    expect(toDateKey(instant, IST)).toBe('2026-09-05');
  });

  it('resolves a time on a DST spring-forward day', () => {
    // 2026-03-08, US DST begins at 02:00 local. 09:00 local is EDT (-04:00).
    const instant = zonedTimeToUtc('2026-03-08', '09:00', NY);

    expect(toDateKey(instant, NY)).toBe('2026-03-08');
    expect(instant.toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });

  it('resolves a time on a DST fall-back day', () => {
    // 2026-11-01, DST ends at 02:00 local. 09:00 local is EST (-05:00).
    const instant = zonedTimeToUtc('2026-11-01', '09:00', NY);

    expect(toDateKey(instant, NY)).toBe('2026-11-01');
    expect(instant.toISOString()).toBe('2026-11-01T14:00:00.000Z');
  });

  it('lands every hour of the day on the intended local date, in both zones', () => {
    for (const zone of [IST, NY, UTC]) {
      for (let hour = 0; hour < 24; hour += 1) {
        const time = `${String(hour).padStart(2, '0')}:00`;
        const instant = zonedTimeToUtc('2026-06-15', time, zone);

        expect(toDateKey(instant, zone)).toBe('2026-06-15');
      }
    }
  });

  it('rejects malformed input rather than guessing', () => {
    expect(() => zonedTimeToUtc('2026-9-5', '09:00', IST)).toThrow(RangeError);
    expect(() => zonedTimeToUtc('2026-09-05', '9:00', IST)).toThrow(RangeError);
    expect(() => zonedTimeToUtc('2026-09-05', '24:00', IST)).toThrow(RangeError);
  });
});

describe('addDays', () => {
  it('moves forward and backward', () => {
    expect(addDays('2026-09-05', 1)).toBe('2026-09-06');
    expect(addDays('2026-09-05', -1)).toBe('2026-09-04');
    expect(addDays('2026-09-05', 14)).toBe('2026-09-19');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('does not drift across a DST boundary, because it never touches a clock', () => {
    // A naive "add 24 hours" implementation loses or gains an hour here.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('daysBetween', () => {
  it('counts calendar days in both directions', () => {
    expect(daysBetween('2026-09-05', '2026-09-19')).toBe(14);
    expect(daysBetween('2026-09-19', '2026-09-05')).toBe(-14);
    expect(daysBetween('2026-09-05', '2026-09-05')).toBe(0);
  });

  it('is unaffected by DST', () => {
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });
});

describe('weekdayOf', () => {
  it('matches the real calendar', () => {
    expect(weekdayOf('2026-09-05')).toBe(6); // Saturday
    expect(weekdayOf('2026-09-06')).toBe(0); // Sunday
    expect(weekdayOf('2026-09-07')).toBe(1); // Monday
  });
});
