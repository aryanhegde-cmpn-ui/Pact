import { describe, expect, it } from 'vitest';

import { adherenceRate, needsReckoning, summarisePostponements } from './reckoning';
import type { ReckoningEvent } from './reckoning';

const DUE = new Date('2026-09-05T12:00:00.000Z');
const AFTER = new Date('2026-09-05T18:00:00.000Z');

const reckoning = (ts: Date): ReckoningEvent => ({ ts, type: 'RECKONING_SUBMITTED' });
const change = (ts: Date, category?: string): ReckoningEvent => ({
  ts,
  type: 'DEADLINE_CHANGED',
  payload: category ? { category } : {},
});

describe('needsReckoning', () => {
  it('is false before the deadline', () => {
    expect(
      needsReckoning({ dueAt: DUE, status: 'pending' }, [], new Date('2026-09-05T11:00:00Z')),
    ).toBe(false);
  });

  it('is TRUE once missed and unanswered', () => {
    expect(needsReckoning({ dueAt: DUE, status: 'pending' }, [], AFTER)).toBe(true);
  });

  it('applies to blocked commitments too', () => {
    // The deadline does not stop for the person you are waiting on, and that
    // is exactly the fact worth surfacing.
    expect(needsReckoning({ dueAt: DUE, status: 'blocked' }, [], AFTER)).toBe(true);
  });

  it.each(['done', 'abandoned'] as const)('is false when %s', (status) => {
    expect(needsReckoning({ dueAt: DUE, status }, [], AFTER)).toBe(false);
  });

  it('is false once this deadline has been reckoned with', () => {
    expect(needsReckoning({ dueAt: DUE, status: 'pending' }, [reckoning(DUE)], AFTER)).toBe(false);
  });

  it('is TRUE again for a NEW deadline after a previous reckoning', () => {
    // Missed, reckoned, rescheduled, missed again. The first answer was about
    // a different deadline and does not discharge this one.
    const newDeadline = new Date('2026-09-09T12:00:00.000Z');

    expect(
      needsReckoning(
        { dueAt: newDeadline, status: 'pending' },
        [reckoning(DUE)],
        new Date('2026-09-09T18:00:00Z'),
      ),
    ).toBe(true);
  });

  it('is not discharged by a reckoning for an unrelated instant', () => {
    // Keyed on the deadline, so an answer about some other moment does not
    // count as an answer about this one.
    expect(
      needsReckoning(
        { dueAt: DUE, status: 'pending' },
        [reckoning(new Date('2026-09-01T12:00:00Z'))],
        AFTER,
      ),
    ).toBe(true);
  });
});

describe('summarisePostponements', () => {
  const original = new Date('2026-09-01T12:00:00.000Z');

  it('counts changes and measures drift against the ORIGINAL deadline', () => {
    const summary = summarisePostponements(
      [change(new Date('2026-09-02T10:00:00Z')), change(new Date('2026-09-04T10:00:00Z'))],
      original,
      new Date('2026-09-06T12:00:00.000Z'),
    );

    expect(summary.changes).toBe(2);
    // Not the sum of each hop: a move forward and back must not read as two
    // postponements' worth of drift.
    expect(summary.totalDaysPostponed).toBe(5);
  });

  it('reports the most common category', () => {
    const summary = summarisePostponements(
      [
        change(new Date('2026-09-02T10:00:00Z'), 'avoidance'),
        change(new Date('2026-09-03T10:00:00Z'), 'avoidance'),
        change(new Date('2026-09-04T10:00:00Z'), 'underestimated'),
      ],
      original,
      original,
    );

    expect(summary.mostCommonCategory).toBe('avoidance');
  });

  it('flags three or more changes as an intervention candidate', () => {
    const three = [1, 2, 3].map((d) => change(new Date(`2026-09-0${d}T10:00:00Z`), 'avoidance'));

    expect(
      summarisePostponements(three.slice(0, 2), original, original).interventionCandidate,
    ).toBe(false);
    // Three is a pattern, and the honest response to a pattern is not a fourth
    // new date.
    expect(summarisePostponements(three, original, original).interventionCandidate).toBe(true);
  });

  it('never reports negative drift when a deadline was pulled forward', () => {
    const summary = summarisePostponements(
      [change(new Date('2026-09-02T10:00:00Z'))],
      original,
      new Date('2026-08-30T12:00:00.000Z'),
    );

    expect(summary.totalDaysPostponed).toBe(0);
  });
});

describe('adherenceRate', () => {
  it('is a rolling rate, not a streak', () => {
    // One miss in the middle must not zero the number: that is the property
    // that makes a streak a reason to stop opening the app.
    const record = [
      ...Array.from({ length: 9 }, () => ({ onTime: true })),
      { onTime: false },
      ...Array.from({ length: 10 }, () => ({ onTime: true })),
    ];

    const result = adherenceRate(record);

    expect(result).toMatchObject({ kept: 19, of: 20 });
    expect(result.rate).toBeCloseTo(0.95);
  });

  it('only considers the window, so old failures age out', () => {
    const record = [
      ...Array.from({ length: 20 }, () => ({ onTime: false })),
      ...Array.from({ length: 20 }, () => ({ onTime: true })),
    ];

    // Recovery is visible as the window advances.
    expect(adherenceRate(record, 20).rate).toBe(1);
  });

  it('is 100% when nothing has been resolved yet', () => {
    expect(adherenceRate([]).rate).toBe(1);
  });

  it('moves a little for one miss and a lot for a pattern', () => {
    const mostlyGood = Array.from({ length: 20 }, (_, i) => ({ onTime: i !== 0 }));
    const mostlyBad = Array.from({ length: 20 }, (_, i) => ({ onTime: i % 4 === 0 }));

    expect(adherenceRate(mostlyGood).rate).toBeCloseTo(0.95);
    expect(adherenceRate(mostlyBad).rate).toBeCloseTo(0.25);
  });
});
