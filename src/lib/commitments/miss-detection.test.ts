import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-memory events collection that enforces the same unique partial index the
 * real one does, so the concurrency behaviour under test is the real behaviour
 * rather than a mock that always succeeds.
 */
const store = vi.hoisted(() => ({
  rows: [] as { entityId: string; type: string; ts: Date; payload: unknown; source: string }[],
  createCalls: 0,
}));

vi.mock('@/lib/db/models/event', () => ({
  EventModel: {
    create: async (doc: {
      entityId: string;
      type: string;
      ts: Date;
      payload: unknown;
      source: string;
    }) => {
      store.createCalls += 1;

      // The unique partial index on (entityId, type) for DEADLINE_MISSED.
      if (doc.type === 'DEADLINE_MISSED') {
        const clash = store.rows.some(
          (row) => row.entityId === doc.entityId && row.type === 'DEADLINE_MISSED',
        );
        if (clash) {
          const error = new Error('E11000 duplicate key error') as Error & { code: number };
          error.code = 11000;
          throw error;
        }
      }

      store.rows.push(doc);
      return doc;
    },
    find: () => ({ sort: () => ({ lean: async () => store.rows }) }),
  },
}));

const { appendEvent } = await import('@/lib/db/events');
const { recordObservedMisses } = await import('@/lib/commitments/miss-detection');

const DUE = new Date('2026-09-05T12:00:00.000Z');
const NOW = new Date('2026-09-05T18:00:00.000Z');

beforeEach(() => {
  store.rows = [];
  store.createCalls = 0;
});

describe('appendEvent', () => {
  it('appends an event', async () => {
    const result = await appendEvent({
      type: 'COMMITMENT_CREATED',
      entityType: 'commitment',
      entityId: 'c1',
      source: 'user',
      payload: {},
    });

    expect(result.appended).toBe(true);
    expect(store.rows).toHaveLength(1);
  });

  it('defaults the timestamp without silently dropping a supplied one', async () => {
    const ts = new Date('2026-01-01T00:00:00Z');
    await appendEvent({
      type: 'COMMITMENT_CREATED',
      entityType: 'commitment',
      entityId: 'c1',
      source: 'user',
      ts,
    });

    expect(store.rows[0]?.ts).toEqual(ts);
  });

  it('reports a duplicate once-per-entity event as not appended, not as an error', async () => {
    const event = {
      type: 'DEADLINE_MISSED',
      entityType: 'commitment',
      entityId: 'c1',
      source: 'system',
    } as const;

    await expect(appendEvent(event)).resolves.toMatchObject({ appended: true });
    await expect(appendEvent(event)).resolves.toMatchObject({ appended: false });
    expect(store.rows).toHaveLength(1);
  });

  it('still throws a duplicate-key error for types that may repeat', async () => {
    // Only DEADLINE_MISSED is once-per-entity. A duplicate on anything else is
    // a real error and must not be swallowed.
    const boom = new Error('E11000') as Error & { code: number };
    boom.code = 11000;
    const { EventModel } = await import('@/lib/db/models/event');
    const spy = vi.spyOn(EventModel, 'create').mockRejectedValueOnce(boom);

    await expect(
      appendEvent({
        type: 'DEADLINE_CHANGED',
        entityType: 'commitment',
        entityId: 'c1',
        source: 'user',
      }),
    ).rejects.toThrow('E11000');

    spy.mockRestore();
  });

  it('rejects an event type outside the enum', async () => {
    await expect(
      appendEvent({
        // @ts-expect-error -- deliberately invalid
        type: 'INVENTED_EVENT',
        entityType: 'commitment',
        entityId: 'c1',
        source: 'user',
      }),
    ).rejects.toThrow();
  });
});

describe('lazy DEADLINE_MISSED under concurrent reads', () => {
  const missed = [{ _id: 'c1', dueAt: DUE, status: 'pending' as const }];

  it('appends exactly once when many reads observe the same miss at once', async () => {
    // Ten simultaneous requests, as several serverless invocations would be.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => recordObservedMisses(missed, NOW)),
    );

    const deadlineMissed = store.rows.filter((row) => row.type === 'DEADLINE_MISSED');
    expect(deadlineMissed).toHaveLength(1);

    // Exactly one caller is told it appended; the rest correctly report zero.
    expect(results.reduce((sum, n) => sum + n, 0)).toBe(1);
    // All ten genuinely attempted the write -- this is not a check-then-write.
    expect(store.createCalls).toBe(10);
  });

  it('stays at one across repeated later reads', async () => {
    await recordObservedMisses(missed, NOW);
    await recordObservedMisses(missed, new Date('2026-09-06T09:00:00Z'));
    await recordObservedMisses(missed, new Date('2026-09-07T09:00:00Z'));

    expect(store.rows.filter((r) => r.type === 'DEADLINE_MISSED')).toHaveLength(1);
  });

  it('timestamps the event at the DEADLINE, not when a read noticed', async () => {
    await recordObservedMisses(missed, NOW);

    // Otherwise the log would say the miss happened whenever the user next
    // opened the app, and the behaviour engine would read the wrong day.
    expect(store.rows[0]?.ts).toEqual(DUE);
    expect((store.rows[0]?.payload as { noticedAt: string }).noticedAt).toBe(NOW.toISOString());
  });

  it('appends nothing for commitments that are not missed', async () => {
    await recordObservedMisses(
      [
        { _id: 'c1', dueAt: new Date('2026-12-01T00:00:00Z'), status: 'pending' },
        { _id: 'c2', dueAt: DUE, status: 'done' },
        { _id: 'c3', dueAt: DUE, status: 'abandoned' },
      ],
      NOW,
    );

    expect(store.rows).toHaveLength(0);
    expect(store.createCalls).toBe(0);
  });

  it('records each missed commitment separately', async () => {
    await recordObservedMisses(
      [
        { _id: 'c1', dueAt: DUE, status: 'pending' },
        { _id: 'c2', dueAt: DUE, status: 'in-progress' },
      ],
      NOW,
    );

    expect(store.rows).toHaveLength(2);
    expect(store.rows.map((r) => r.entityId).sort()).toEqual(['c1', 'c2']);
  });
});
