import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  commitments: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
}));

/** A chainable stand-in for a Mongoose query. */
function query(rows: () => Record<string, unknown>[]) {
  const chain = {
    sort: () => chain,
    limit: () => chain,
    lean: async () => rows(),
  };
  return chain;
}

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));
vi.mock('@/lib/notifications/settings', () => ({
  getSettings: async () => ({ shareNotesWithOverseer: false }),
}));
vi.mock('@/lib/db/models/commitment', () => ({
  CommitmentModel: {
    find: (filter: { status?: unknown }) =>
      query(() =>
        store.commitments.filter((row) =>
          filter.status === 'done' ? row.status === 'done' : true,
        ),
      ),
  },
}));
vi.mock('@/lib/db/models/event', () => ({
  EventModel: {
    find: (filter: { type: string }) =>
      query(() => store.events.filter((event) => event.type === filter.type)),
  },
}));

const { buildOverseerSnapshot } = await import('./overseer-view');

const OWNER = 'owner-1';

beforeEach(() => {
  store.commitments = [];
  store.events = [];
});

function change(payload: Record<string, unknown>) {
  store.events.push({
    entityId: 'c1',
    ownerId: OWNER,
    type: 'DEADLINE_CHANGED',
    ts: new Date('2026-09-05T12:00:00.000Z'),
    payload,
  });
}

describe('overseer read model, deadline changes without a category', () => {
  // Two such rows exist in the real database, written before the category
  // became a required part of a deadline change.

  it('counts them as legacy rather than as a category, and keeps aggregating', async () => {
    change({ category: 'avoidance' });
    change({ category: 'avoidance' });
    change({ reason: 'Ran out of time' });
    change({});

    const snapshot = await buildOverseerSnapshot(OWNER);

    expect(snapshot.legacyChanges).toBe(2);
    expect(snapshot.deadlineChanges).toEqual([
      { category: 'avoidance', label: expect.any(String), count: 2 },
    ]);
  });

  it('never lets the uncategorised pile win "most common"', async () => {
    change({ category: 'external' });
    change({});
    change({});
    change({});

    const snapshot = await buildOverseerSnapshot(OWNER);

    // Three legacy rows outnumber the one real category, and must still not
    // appear as a bucket — a phantom category at the top of this list would
    // misreport the pattern the overseer is here to see.
    expect(snapshot.deadlineChanges.map((row) => row.category)).toEqual(['external']);
    expect(snapshot.legacyChanges).toBe(3);
  });

  it('reports an empty category list, not a null bucket, when all are legacy', async () => {
    change({});
    change({});

    const snapshot = await buildOverseerSnapshot(OWNER);

    expect(snapshot.deadlineChanges).toEqual([]);
    expect(snapshot.legacyChanges).toBe(2);
  });
});
