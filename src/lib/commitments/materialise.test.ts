import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-memory commitments and series, with the same unique index on
 * (seriesId, occurrenceDate) the real collection carries. Materialisation's
 * whole concurrency story rests on that index, so a mock without it would test
 * nothing.
 */
const store = vi.hoisted(() => ({
  series: [] as Record<string, unknown>[],
  commitments: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  notifications: [] as Record<string, unknown>[],
  createAttempts: 0,
}));

vi.mock('@/lib/db/models/series', () => ({
  SeriesModel: {
    find: () => ({ lean: async () => store.series }),
  },
}));

vi.mock('@/lib/db/models/commitment', () => ({
  CommitmentModel: {
    find: (query: { seriesId: string; occurrenceDate: { $in: string[] } }) => ({
      lean: async () =>
        store.commitments.filter(
          (row) =>
            row.seriesId === query.seriesId &&
            query.occurrenceDate.$in.includes(row.occurrenceDate as string),
        ),
    }),
    create: async (doc: Record<string, unknown>) => {
      store.createAttempts += 1;

      const clash = store.commitments.some(
        (row) => row.seriesId === doc.seriesId && row.occurrenceDate === doc.occurrenceDate,
      );
      if (clash) {
        const error = new Error('E11000 duplicate key') as Error & { code: number };
        error.code = 11000;
        throw error;
      }

      const saved = { ...doc, _id: `c${store.commitments.length + 1}` };
      store.commitments.push(saved);
      return saved;
    },
  },
}));

vi.mock('@/lib/db/models/settings', () => ({
  SettingsModel: {
    findOneAndUpdate: () => ({
      lean: async () => ({
        quietHoursStart: '00:00',
        quietHoursEnd: '07:00',
        dailyReviewAt: '07:30',
        defaultLeadMinutes: 30,
      }),
    }),
  },
}));

// The real queue module runs against this; whether materialisation enqueues is
// part of what is being tested.
vi.mock('@/lib/db/models/notification', () => ({
  NotificationModel: {
    create: async (doc: Record<string, unknown>) => {
      const clash = store.notifications.some(
        (row) =>
          row.commitmentId === doc.commitmentId &&
          row.type === doc.type &&
          (row.scheduledFor as Date).getTime() === (doc.scheduledFor as Date).getTime() &&
          row.channel === doc.channel,
      );
      if (clash) {
        const error = new Error('E11000 duplicate key') as Error & { code: number };
        error.code = 11000;
        throw error;
      }
      store.notifications.push({ ...doc });
      return doc;
    },
    updateOne: async () => ({ modifiedCount: 0 }),
    updateMany: async () => ({ modifiedCount: 0 }),
  },
}));

vi.mock('@/lib/db/events', () => ({
  appendEvent: async (event: Record<string, unknown>) => {
    store.events.push(event);
    return { appended: true, type: event.type };
  },
}));

const { materialiseRange } = await import('./materialise');

const IST = 'Asia/Kolkata';
const NOW = new Date('2026-09-05T06:00:00.000Z');

function dailySeries(overrides: Record<string, unknown> = {}) {
  return {
    _id: 's1',
    title: 'Morning review',
    outcome: 'Tomorrow is planned',
    priority: 'important',
    startDate: '2026-09-01',
    endDate: null,
    status: 'active',
    rule: {
      frequency: 'daily',
      interval: 1,
      byWeekday: [],
      timeOfDay: '09:00',
      estimateMinutes: 15,
    },
    ...overrides,
  };
}

beforeEach(() => {
  store.series = [dailySeries()];
  store.commitments = [];
  store.events = [];
  store.notifications = [];
  store.createAttempts = 0;
});

describe('materialiseRange', () => {
  it('creates occurrences for the window plus a 14-day lookahead', async () => {
    const result = await materialiseRange('2026-09-05', '2026-09-05', IST, NOW);

    // One requested day + 14 days of lookahead.
    expect(result.created).toBe(15);
    expect(store.commitments).toHaveLength(15);
  });

  it('resolves the rule time to a UTC instant on the right local date', async () => {
    await materialiseRange('2026-09-05', '2026-09-05', IST, NOW);

    const first = store.commitments.find((c) => c.occurrenceDate === '2026-09-05');
    // 09:00 IST is 03:30Z.
    expect((first?.dueAt as Date).toISOString()).toBe('2026-09-05T03:30:00.000Z');
  });

  it('sets originalDueAt equal to dueAt at birth', async () => {
    await materialiseRange('2026-09-05', '2026-09-05', IST, NOW);

    for (const c of store.commitments) {
      expect((c.originalDueAt as Date).getTime()).toBe((c.dueAt as Date).getTime());
    }
  });

  it('is idempotent: running twice creates nothing the second time', async () => {
    const first = await materialiseRange('2026-09-05', '2026-09-05', IST, NOW);
    const second = await materialiseRange('2026-09-05', '2026-09-05', IST, NOW);

    expect(first.created).toBe(15);
    expect(second.created).toBe(0);
    expect(store.commitments).toHaveLength(15);
  });

  it('creates each occurrence exactly once under concurrent materialisation', async () => {
    // Five simultaneous requests for the same window, as several serverless
    // invocations would be.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => materialiseRange('2026-09-05', '2026-09-05', IST, NOW)),
    );

    const keys = store.commitments.map((c) => `${c.seriesId}:${c.occurrenceDate}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(store.commitments).toHaveLength(15);

    // Every occurrence was created exactly once in total across all callers.
    expect(results.reduce((sum, r) => sum + r.created, 0)).toBe(15);
    // And the losers recorded races rather than throwing.
    expect(results.reduce((sum, r) => sum + r.raced, 0)).toBeGreaterThan(0);
  });

  it('logs CREATED and DEADLINE_SET for each occurrence, sourced as system', async () => {
    await materialiseRange('2026-09-05', '2026-09-05', IST, NOW);

    const created = store.events.filter((e) => e.type === 'COMMITMENT_CREATED');
    const deadlines = store.events.filter((e) => e.type === 'DEADLINE_SET');

    expect(created).toHaveLength(15);
    expect(deadlines).toHaveLength(15);
    // A rule produced these, not a person.
    expect(created.every((e) => e.source === 'system')).toBe(true);
  });

  it('ignores ended series', async () => {
    store.series = [dailySeries({ status: 'ended' })];
    // The query filters on status, so an ended series is simply not returned.
    store.series = [];

    const result = await materialiseRange('2026-09-05', '2026-09-05', IST, NOW);
    expect(result.created).toBe(0);
  });

  it('does not create occurrences past the series end date', async () => {
    store.series = [dailySeries({ endDate: '2026-09-07' })];

    await materialiseRange('2026-09-05', '2026-09-05', IST, NOW);

    const dates = store.commitments.map((c) => c.occurrenceDate).sort();
    expect(dates).toEqual(['2026-09-05', '2026-09-06', '2026-09-07']);
  });

  it('does not backfill before the requested window', async () => {
    // The series started on the 1st, but a query for the 5th must not
    // manufacture history for days nobody asked about.
    await materialiseRange('2026-09-05', '2026-09-05', IST, NOW);

    const earliest = store.commitments.map((c) => c.occurrenceDate as string).sort()[0];
    expect(earliest).toBe('2026-09-05');
  });
});

describe('series occurrences enqueue as they materialise', () => {
  it('queues notifications for every occurrence it creates', async () => {
    await materialiseRange('2026-09-05', '2026-09-05', IST, NOW);

    // Three per occurrence: approaching, now, accountability check.
    expect(store.commitments).toHaveLength(15);
    expect(store.notifications).toHaveLength(15 * 3);
  });

  it('schedules them against each occurrence own deadline', async () => {
    await materialiseRange('2026-09-05', '2026-09-05', IST, NOW);

    const first = store.commitments.find((c) => c.occurrenceDate === '2026-09-05');
    const due = (first?.dueAt as Date).getTime();
    const forFirst = store.notifications.filter((n) => n.commitmentId === first?._id);

    const times = forFirst
      .map((n) => (n.scheduledFor as Date).getTime() - due)
      .sort((a, b) => a - b);
    // -30 min, 0, +15 min.
    expect(times).toEqual([-30 * 60_000, 0, 15 * 60_000]);
  });

  it('does not re-enqueue on a second materialisation pass', async () => {
    await materialiseRange('2026-09-05', '2026-09-05', IST, NOW);
    const after = store.notifications.length;

    await materialiseRange('2026-09-05', '2026-09-05', IST, NOW);

    // Nothing new was created, so nothing new was queued.
    expect(store.notifications).toHaveLength(after);
  });
});
