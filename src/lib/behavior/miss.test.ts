import { describe, expect, it } from 'vitest';

import { isMissed, minutesOverdue } from './miss';
import { toDateKey, zonedTimeToUtc } from '@/lib/time';

const IST = 'Asia/Kolkata';
const NY = 'America/New_York';

describe('isMissed', () => {
  const dueAt = new Date('2026-09-05T12:00:00.000Z');

  it('is false before the deadline', () => {
    expect(isMissed({ dueAt, status: 'pending' }, new Date('2026-09-05T11:59:59Z'))).toBe(false);
  });

  it('is false exactly at the deadline', () => {
    // The deadline is the last moment it is still on time.
    expect(isMissed({ dueAt, status: 'pending' }, dueAt)).toBe(false);
  });

  it('is true one millisecond after', () => {
    expect(isMissed({ dueAt, status: 'pending' }, new Date(dueAt.getTime() + 1))).toBe(true);
  });

  it('applies to in-progress work too', () => {
    // Having started is not the same as having finished.
    expect(isMissed({ dueAt, status: 'in-progress' }, new Date('2026-09-06T00:00:00Z'))).toBe(true);
  });

  it.each(['done', 'abandoned'] as const)('is false when %s, however late', (status) => {
    expect(isMissed({ dueAt, status }, new Date('2027-01-01T00:00:00Z'))).toBe(false);
  });
});

describe('miss detection across timezone boundaries', () => {
  it('does not fire early for a deadline late in the local day', () => {
    // 23:00 on the 5th in IST is 17:30Z on the 5th. At 18:00Z the UTC day is
    // still the 5th, but locally it is already the 6th and the deadline has
    // genuinely passed.
    const dueAt = zonedTimeToUtc('2026-09-05', '23:00', IST);

    expect(dueAt.toISOString()).toBe('2026-09-05T17:30:00.000Z');
    expect(isMissed({ dueAt, status: 'pending' }, new Date('2026-09-05T17:29:00Z'))).toBe(false);
    expect(isMissed({ dueAt, status: 'pending' }, new Date('2026-09-05T17:31:00Z'))).toBe(true);
  });

  it('does not fire early for a deadline early in the local day', () => {
    // 00:30 on the 6th in IST is 19:00Z on the FIFTH. A naive comparison of
    // calendar dates would call this missed all through the 5th.
    const dueAt = zonedTimeToUtc('2026-09-06', '00:30', IST);

    expect(dueAt.toISOString()).toBe('2026-09-05T19:00:00.000Z');
    expect(toDateKey(dueAt, IST)).toBe('2026-09-06');
    expect(isMissed({ dueAt, status: 'pending' }, new Date('2026-09-05T12:00:00Z'))).toBe(false);
  });

  it('behaves the same in a zone behind UTC', () => {
    // 23:00 on the 5th in New York is 03:00Z on the SIXTH.
    const dueAt = zonedTimeToUtc('2026-09-05', '23:00', NY);

    expect(dueAt.toISOString()).toBe('2026-09-06T03:00:00.000Z');
    // Still the 5th locally, and not yet missed, even though UTC has ticked over.
    expect(isMissed({ dueAt, status: 'pending' }, new Date('2026-09-06T02:00:00Z'))).toBe(false);
    expect(isMissed({ dueAt, status: 'pending' }, new Date('2026-09-06T03:30:00Z'))).toBe(true);
  });

  it('is unaffected by a DST transition between deadline and now', () => {
    // Due before US DST begins; observed after. The instant comparison is
    // absolute, so the one-hour shift must not move the verdict.
    const dueAt = zonedTimeToUtc('2026-03-07', '12:00', NY);
    const after = zonedTimeToUtc('2026-03-09', '12:00', NY);

    expect(isMissed({ dueAt, status: 'pending' }, after)).toBe(true);
    expect(minutesOverdue({ dueAt, status: 'pending' }, after)).toBe(2 * 24 * 60 - 60);
  });
});

describe('minutesOverdue', () => {
  const dueAt = new Date('2026-09-05T12:00:00.000Z');

  it('is zero when not missed', () => {
    expect(minutesOverdue({ dueAt, status: 'pending' }, new Date('2026-09-05T11:00:00Z'))).toBe(0);
    expect(minutesOverdue({ dueAt, status: 'done' }, new Date('2027-01-01T00:00:00Z'))).toBe(0);
  });

  it('counts whole minutes past the deadline', () => {
    expect(minutesOverdue({ dueAt, status: 'pending' }, new Date('2026-09-05T13:30:00Z'))).toBe(90);
  });
});
