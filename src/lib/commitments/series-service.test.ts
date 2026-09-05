import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  series: [] as Record<string, unknown>[],
  commitments: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
}));

const findById = (collection: Record<string, unknown>[], id: string) =>
  collection.find((row) => String(row._id) === String(id)) ?? null;

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));

vi.mock('@/lib/db/models/series', () => ({
  SeriesModel: {
    findById: (id: string) => ({ lean: async () => findById(store.series, id) }),
    updateOne: async (filter: { _id: string }, update: { $set: Record<string, unknown> }) => {
      const row = findById(store.series, filter._id);
      if (row) Object.assign(row, update.$set);
      return { modifiedCount: 1 };
    },
    create: async (doc: Record<string, unknown>) => {
      const saved = { ...doc, _id: `s${store.series.length + 1}`, toObject: () => saved };
      store.series.push(saved);
      return saved;
    },
    find: () => ({ sort: () => ({ lean: async () => store.series }) }),
  },
}));

vi.mock('@/lib/db/models/commitment', () => ({
  CommitmentModel: {
    findOne: (query: { seriesId: string; occurrenceDate: string }) => ({
      lean: async () =>
        store.commitments.find(
          (row) => row.seriesId === query.seriesId && row.occurrenceDate === query.occurrenceDate,
        ) ?? null,
    }),
    updateOne: async (filter: { _id: string }, update: { $set: Record<string, unknown> }) => {
      const row = findById(store.commitments, filter._id);
      if (row) Object.assign(row, update.$set);
      return { modifiedCount: 1 };
    },
    deleteMany: async (query: { seriesId: string; occurrenceDate: { $gt: string } }) => {
      const before = store.commitments.length;
      store.commitments = store.commitments.filter(
        (row) =>
          !(
            row.seriesId === query.seriesId &&
            (row.occurrenceDate as string) > query.occurrenceDate.$gt &&
            row.status === 'pending' &&
            row.startedAt === null
          ),
      );
      return { deletedCount: before - store.commitments.length };
    },
  },
}));

vi.mock('@/lib/db/events', () => ({
  appendEvent: async (event: Record<string, unknown>) => {
    store.events.push(event);
    return { appended: true, type: event.type };
  },
}));

const { endSeries, updateSeries } = await import('./series-service');

const IST = 'Asia/Kolkata';
const NOW = new Date('2026-09-10T06:00:00.000Z'); // 2026-09-10 local

function occurrence(date: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: `c-${date}`,
    seriesId: 's1',
    occurrenceDate: date,
    title: 'Morning review',
    outcome: 'Tomorrow is planned',
    priority: 'important',
    status: 'pending',
    startedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  store.series = [
    {
      _id: 's1',
      title: 'Morning review',
      outcome: 'Tomorrow is planned',
      priority: 'important',
      startDate: '2026-09-01',
      endDate: null,
      status: 'active',
      createdAt: new Date('2026-09-01T00:00:00Z'),
      rule: {
        frequency: 'daily',
        interval: 1,
        byWeekday: [],
        timeOfDay: '09:00',
        estimateMinutes: 15,
      },
    },
  ];
  store.commitments = [
    occurrence('2026-09-05', { status: 'done' }),
    occurrence('2026-09-08', { status: 'abandoned' }),
    occurrence('2026-09-10'),
    occurrence('2026-09-12'),
    occurrence('2026-09-15'),
  ];
  store.events = [];
});

describe('this-occurrence edits', () => {
  it('changes only that occurrence', async () => {
    await updateSeries(
      's1',
      { scope: 'this-occurrence', occurrenceDate: '2026-09-10', title: 'Just today' },
      IST,
      NOW,
    );

    expect(store.commitments.find((c) => c.occurrenceDate === '2026-09-10')?.title).toBe(
      'Just today',
    );
    expect(store.commitments.find((c) => c.occurrenceDate === '2026-09-12')?.title).toBe(
      'Morning review',
    );
  });

  it('leaves the series rule untouched', async () => {
    await updateSeries(
      's1',
      { scope: 'this-occurrence', occurrenceDate: '2026-09-10', title: 'Just today' },
      IST,
      NOW,
    );

    expect(store.series[0]?.title).toBe('Morning review');
    expect(store.series[0]?.status).toBe('active');
    expect(store.series).toHaveLength(1);
  });
});

describe('this-and-future edits', () => {
  it('never rewrites past occurrences', async () => {
    const before = store.commitments
      .filter((c) => (c.occurrenceDate as string) < '2026-09-10')
      .map((c) => ({ ...c }));

    await updateSeries('s1', { scope: 'this-and-future', title: 'Evening review' }, IST, NOW);

    for (const original of before) {
      const after = store.commitments.find((c) => c._id === original._id);
      // Historical fact: what was committed to then does not change now.
      expect(after?.title).toBe(original.title);
      expect(after?.status).toBe(original.status);
    }
  });

  it('ends the old series the day before today and starts a new one', async () => {
    await updateSeries('s1', { scope: 'this-and-future', title: 'Evening review' }, IST, NOW);

    const old = store.series.find((s) => s._id === 's1');
    expect(old?.status).toBe('ended');
    expect(old?.endDate).toBe('2026-09-09');

    const replacement = store.series.find((s) => s._id !== 's1');
    expect(replacement).toMatchObject({
      title: 'Evening review',
      startDate: '2026-09-10',
      status: 'active',
      supersedes: 's1',
    });
  });

  it('leaves the old series describing exactly the occurrences it produced', async () => {
    await updateSeries(
      's1',
      {
        scope: 'this-and-future',
        rule: {
          frequency: 'weekly',
          interval: 1,
          byWeekday: [1],
          timeOfDay: '18:00',
          estimateMinutes: 45,
        },
      },
      IST,
      NOW,
    );

    const old = store.series.find((s) => s._id === 's1');
    // The old rule is intact -- it is the accurate description of past history.
    expect((old?.rule as { timeOfDay: string }).timeOfDay).toBe('09:00');
  });

  it('logs the ending and the replacement', async () => {
    await updateSeries('s1', { scope: 'this-and-future', title: 'Evening review' }, IST, NOW);

    const types = store.events.map((e) => e.type);
    expect(types).toContain('SERIES_ENDED');
    expect(types).toContain('SERIES_CREATED');
    expect(types).toContain('SERIES_EDITED');
  });
});

describe('ending a series', () => {
  it('does not delete past occurrences', async () => {
    await endSeries('s1', IST, NOW);

    expect(store.commitments.find((c) => c.occurrenceDate === '2026-09-05')).toBeDefined();
    expect(store.commitments.find((c) => c.occurrenceDate === '2026-09-08')).toBeDefined();
  });

  it("keeps today's occurrence", async () => {
    await endSeries('s1', IST, NOW);

    expect(store.commitments.find((c) => c.occurrenceDate === '2026-09-10')).toBeDefined();
  });

  it('removes only untouched future occurrences', async () => {
    const result = await endSeries('s1', IST, NOW);

    expect(result.futureOccurrencesRemoved).toBe(2);
    expect(store.commitments.find((c) => c.occurrenceDate === '2026-09-12')).toBeUndefined();
  });

  it('keeps a future occurrence that has already been started', async () => {
    store.commitments.push(
      occurrence('2026-09-20', { status: 'in-progress', startedAt: new Date() }),
    );

    await endSeries('s1', IST, NOW);

    // Work already begun is history, not a stale projection.
    expect(store.commitments.find((c) => c.occurrenceDate === '2026-09-20')).toBeDefined();
  });

  it('marks the series ended rather than deleting it', async () => {
    await endSeries('s1', IST, NOW);

    expect(store.series.find((s) => s._id === 's1')?.status).toBe('ended');
  });
});
