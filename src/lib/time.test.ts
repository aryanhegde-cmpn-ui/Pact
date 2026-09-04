import { describe, expect, it } from 'vitest';

import { formatWallClock, utcOffset } from './time';

const instant = new Date('2026-09-04T02:30:00.000Z');

describe('formatWallClock', () => {
  it('renders an instant in the target zone', () => {
    // 02:30 UTC is 08:00 in Kolkata (+05:30).
    expect(formatWallClock(instant, 'Asia/Kolkata')).toBe('2026-09-04T08:00:00');
  });

  it('renders UTC unchanged', () => {
    expect(formatWallClock(instant, 'UTC')).toBe('2026-09-04T02:30:00');
  });
});

describe('utcOffset', () => {
  it('reports a half-hour offset', () => {
    expect(utcOffset(instant, 'Asia/Kolkata')).toBe('+05:30');
  });

  it('normalises UTC to +00:00', () => {
    expect(utcOffset(instant, 'UTC')).toBe('+00:00');
  });
});
