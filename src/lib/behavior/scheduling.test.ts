import { describe, expect, it } from 'vitest';

import { decideDelivery, deferPastQuietHours, isStale, isWithinQuietHours } from './scheduling';
import { STALENESS_CAP_MINUTES } from '@/lib/schemas/notification';
import { zonedTimeToUtc } from '@/lib/time';

const IST = 'Asia/Kolkata';
const DEFAULT_QUIET = { start: '00:00', end: '07:00' };
const WRAPPING_QUIET = { start: '22:00', end: '07:00' };

/** A UTC instant for a local wall clock on 2026-09-05, in IST. */
const at = (wall: string, date = '2026-09-05') => zonedTimeToUtc(date, wall, IST);

describe('isWithinQuietHours', () => {
  it.each(['00:00', '03:00', '06:59'])('is quiet at %s', (wall) => {
    expect(isWithinQuietHours(at(wall), DEFAULT_QUIET, IST)).toBe(true);
  });

  it.each(['07:00', '12:00', '23:59'])('is not quiet at %s', (wall) => {
    expect(isWithinQuietHours(at(wall), DEFAULT_QUIET, IST)).toBe(false);
  });

  it('handles a window that wraps midnight', () => {
    expect(isWithinQuietHours(at('23:30'), WRAPPING_QUIET, IST)).toBe(true);
    expect(isWithinQuietHours(at('02:00'), WRAPPING_QUIET, IST)).toBe(true);
    expect(isWithinQuietHours(at('21:59'), WRAPPING_QUIET, IST)).toBe(false);
    expect(isWithinQuietHours(at('07:00'), WRAPPING_QUIET, IST)).toBe(false);
  });

  it('treats a zero-width window as quiet hours being off', () => {
    expect(isWithinQuietHours(at('03:00'), { start: '00:00', end: '00:00' }, IST)).toBe(false);
  });

  it('judges by LOCAL time, not UTC', () => {
    // 03:00 IST is 21:30 UTC the previous day. A UTC-based check would call
    // this outside the window.
    const instant = at('03:00');
    expect(instant.toISOString()).toBe('2026-09-04T21:30:00.000Z');
    expect(isWithinQuietHours(instant, DEFAULT_QUIET, IST)).toBe(true);
  });
});

describe('deferPastQuietHours', () => {
  it('leaves a daytime notification alone', () => {
    const instant = at('14:00');
    expect(deferPastQuietHours(instant, DEFAULT_QUIET, IST)).toEqual(instant);
  });

  it('defers a 03:00 notification to 07:00 the same local day', () => {
    const deferred = deferPastQuietHours(at('03:00'), DEFAULT_QUIET, IST);
    expect(deferred).toEqual(at('07:00'));
  });

  it('defers 00:00 exactly, the first instant of the window', () => {
    expect(deferPastQuietHours(at('00:00'), DEFAULT_QUIET, IST)).toEqual(at('07:00'));
  });

  it('defers 06:59 to 07:00, one minute away', () => {
    expect(deferPastQuietHours(at('06:59'), DEFAULT_QUIET, IST)).toEqual(at('07:00'));
  });

  it('leaves 23:59 alone under the default window', () => {
    // 23:59 is OUTSIDE 00:00-07:00. Deferring it would be a bug, and an easy
    // one to write by treating "late at night" as quiet.
    const instant = at('23:59');
    expect(deferPastQuietHours(instant, DEFAULT_QUIET, IST)).toEqual(instant);
  });

  it('defers 23:59 to the NEXT morning under a wrapping window', () => {
    const deferred = deferPastQuietHours(at('23:59'), WRAPPING_QUIET, IST);

    // Not 07:00 today, which is already in the past.
    expect(deferred).toEqual(at('07:00', '2026-09-06'));
    expect(deferred.getTime()).toBeGreaterThan(at('23:59').getTime());
  });

  it('defers 02:00 to 07:00 the SAME day under a wrapping window', () => {
    // Already past midnight, so the window ends this morning, not tomorrow.
    expect(deferPastQuietHours(at('02:00'), WRAPPING_QUIET, IST)).toEqual(at('07:00'));
  });

  it('never moves a notification backwards', () => {
    for (const wall of ['00:00', '00:01', '03:30', '06:59', '22:30', '23:59']) {
      for (const quiet of [DEFAULT_QUIET, WRAPPING_QUIET]) {
        const instant = at(wall);
        const deferred = deferPastQuietHours(instant, quiet, IST);
        expect(deferred.getTime()).toBeGreaterThanOrEqual(instant.getTime());
      }
    }
  });

  it('lands outside the window in every case', () => {
    for (const wall of ['00:00', '02:00', '03:30', '06:59', '22:30', '23:59']) {
      for (const quiet of [DEFAULT_QUIET, WRAPPING_QUIET]) {
        const deferred = deferPastQuietHours(at(wall), quiet, IST);
        expect(isWithinQuietHours(deferred, quiet, IST)).toBe(false);
      }
    }
  });
});

describe('isStale', () => {
  const scheduled = new Date('2026-09-05T12:00:00.000Z');

  it('is false for something not yet due', () => {
    expect(isStale(scheduled, new Date('2026-09-05T11:00:00Z'))).toBe(false);
  });

  it('is false just inside the cap', () => {
    const now = new Date(scheduled.getTime() + (STALENESS_CAP_MINUTES - 1) * 60_000);
    expect(isStale(scheduled, now)).toBe(false);
  });

  it('is true just past the cap', () => {
    const now = new Date(scheduled.getTime() + (STALENESS_CAP_MINUTES + 1) * 60_000);
    expect(isStale(scheduled, now)).toBe(true);
  });
});

describe('decideDelivery', () => {
  const scheduled = new Date('2026-09-05T12:00:00.000Z');
  const open = { commitmentResolved: false };

  it('holds anything not yet due', () => {
    expect(
      decideDelivery(
        { type: 'DEADLINE_APPROACHING', scheduledFor: scheduled },
        open,
        new Date('2026-09-05T11:00:00Z'),
      ),
    ).toEqual({ action: 'hold' });
  });

  it('sends when due and fresh', () => {
    expect(
      decideDelivery(
        { type: 'DEADLINE_APPROACHING', scheduledFor: scheduled },
        open,
        new Date('2026-09-05T12:01:00Z'),
      ),
    ).toEqual({ action: 'send' });
  });

  it('SKIPS rather than sends when stale', () => {
    // Opening the app after a quiet week must not deliver the backlog.
    const later = new Date(scheduled.getTime() + 8 * 3_600_000);

    expect(
      decideDelivery({ type: 'DEADLINE_APPROACHING', scheduledFor: scheduled }, open, later),
    ).toEqual({ action: 'skip', reason: 'stale' });
  });

  it('skips anything whose commitment is already resolved', () => {
    expect(
      decideDelivery(
        { type: 'DEADLINE_APPROACHING', scheduledFor: scheduled },
        { commitmentResolved: true },
        new Date('2026-09-05T12:01:00Z'),
      ),
    ).toEqual({ action: 'skip', reason: 'resolved' });
  });

  it('exempts ACCOUNTABILITY_CHECK from the staleness cap while unresolved', () => {
    // "Did you do it?" has not expired a week later, and the commitments
    // avoided longest would otherwise be the ones asked about least.
    const muchLater = new Date(scheduled.getTime() + 7 * 24 * 3_600_000);

    expect(
      decideDelivery({ type: 'ACCOUNTABILITY_CHECK', scheduledFor: scheduled }, open, muchLater),
    ).toEqual({ action: 'send' });
  });

  it('still skips ACCOUNTABILITY_CHECK once its commitment is resolved', () => {
    const muchLater = new Date(scheduled.getTime() + 7 * 24 * 3_600_000);

    expect(
      decideDelivery(
        { type: 'ACCOUNTABILITY_CHECK', scheduledFor: scheduled },
        { commitmentResolved: true },
        muchLater,
      ),
    ).toEqual({ action: 'skip', reason: 'resolved' });
  });
});
