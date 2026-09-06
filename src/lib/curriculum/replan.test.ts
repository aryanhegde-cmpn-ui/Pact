import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  phases: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));
vi.mock('@/lib/db/models/phase', () => ({
  PhaseModel: {
    find: () => ({ sort: () => ({ lean: async () => store.phases }) }),
    updateOne: async (filter: { number: number }, update: { $set: Record<string, unknown> }) => {
      const row = store.phases.find((phase) => phase.number === filter.number);
      if (row) Object.assign(row, update.$set);
      return { modifiedCount: 1 };
    },
  },
}));
vi.mock('@/lib/db/events', () => ({
  appendEvent: async (event: Record<string, unknown>) => {
    store.events.push(event);
  },
}));

const { replanPhase } = await import('./replan');

const OWNER = 'owner-1';

/** The real plan's first three phases. */
beforeEach(() => {
  store.events = [];
  store.phases = [
    {
      ownerId: OWNER,
      number: 1,
      startDate: '2026-09-07',
      endDate: '2026-09-30',
      originalStartDate: '2026-09-07',
      originalEndDate: '2026-09-30',
      replannedAt: null,
    },
    {
      ownerId: OWNER,
      number: 2,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      originalStartDate: '2026-10-01',
      originalEndDate: '2026-10-31',
      replannedAt: null,
    },
    {
      ownerId: OWNER,
      number: 3,
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      originalStartDate: '2026-11-01',
      originalEndDate: '2026-11-30',
      replannedAt: null,
    },
  ];
});

const REASON = 'Two weeks lost to a release; the JS module is genuinely unfinished.';

describe('re-planning a phase', () => {
  it('moves its end date', async () => {
    await replanPhase({ phaseNumber: 1, newEndDate: '2026-10-07', reason: REASON }, OWNER);

    expect(store.phases[0]).toMatchObject({ startDate: '2026-09-07', endDate: '2026-10-07' });
  });

  it('shifts every later phase by the same amount rather than squeezing them', async () => {
    // Absorbing the delta by shortening the next phase is exactly the silent
    // re-flow this function exists to replace: the plan would look the same
    // length while quietly containing less time for the same material.
    await replanPhase({ phaseNumber: 1, newEndDate: '2026-10-07', reason: REASON }, OWNER);

    expect(store.phases[1]).toMatchObject({ startDate: '2026-10-08', endDate: '2026-11-07' });
    expect(store.phases[2]).toMatchObject({ startDate: '2026-11-08', endDate: '2026-12-07' });
  });

  it('leaves earlier phases alone', async () => {
    await replanPhase({ phaseNumber: 2, newEndDate: '2026-11-14', reason: REASON }, OWNER);

    expect(store.phases[0]).toMatchObject({ endDate: '2026-09-30', replannedAt: null });
  });

  it('keeps the dates the plan was first written with', async () => {
    await replanPhase({ phaseNumber: 1, newEndDate: '2026-10-07', reason: REASON }, OWNER);
    await replanPhase({ phaseNumber: 1, newEndDate: '2026-10-21', reason: REASON }, OWNER);

    // The original schedule is the only thing that makes "behind" mean
    // anything, so it survives however many re-plans there are.
    expect(store.phases[0]?.originalEndDate).toBe('2026-09-30');
    expect(store.events[1]?.payload).toMatchObject({ totalDaysFromOriginal: 21 });
  });
});

describe('the record it leaves', () => {
  it('records the reason, the delta and every phase that moved', async () => {
    await replanPhase({ phaseNumber: 1, newEndDate: '2026-10-07', reason: REASON }, OWNER);

    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({
      type: 'PLAN_REPLANNED',
      entityType: 'plan',
      source: 'user',
      payload: { phaseNumber: 1, deltaDays: 7, reason: REASON },
    });
    expect((store.events[0]?.payload as { moved: unknown[] }).moved).toHaveLength(3);
  });

  it('marks the moved phases so a re-import will not undo it', async () => {
    await replanPhase({ phaseNumber: 2, newEndDate: '2026-11-14', reason: REASON }, OWNER);

    expect(store.phases[1]?.replannedAt).toBeInstanceOf(Date);
    expect(store.phases[2]?.replannedAt).toBeInstanceOf(Date);
  });
});

describe('what it refuses', () => {
  it('does nothing, and records nothing, when the date has not changed', async () => {
    // Recording a re-plan here would put a reason in the log against a change
    // that did not happen.
    const result = await replanPhase(
      { phaseNumber: 1, newEndDate: '2026-09-30', reason: REASON },
      OWNER,
    );

    expect(result).toEqual({ moved: [], deltaDays: 0 });
    expect(store.events).toEqual([]);
    expect(store.phases[0]?.replannedAt).toBeNull();
  });

  it('refuses an end date before the phase starts', async () => {
    await expect(
      replanPhase({ phaseNumber: 1, newEndDate: '2026-09-01', reason: REASON }, OWNER),
    ).rejects.toThrow(/cannot end before it starts/);
  });

  it('refuses a phase that does not exist', async () => {
    await expect(
      replanPhase({ phaseNumber: 9, newEndDate: '2026-12-01', reason: REASON }, OWNER),
    ).rejects.toThrow(/No such phase/);
  });

  it('can pull a plan forward as well as push it back', async () => {
    // Being ahead is a real outcome, and the plan should be movable in that
    // direction too -- with the same reason and the same record.
    await replanPhase({ phaseNumber: 1, newEndDate: '2026-09-23', reason: REASON }, OWNER);

    expect(store.phases[0]?.endDate).toBe('2026-09-23');
    expect(store.phases[1]).toMatchObject({ startDate: '2026-09-24' });
  });
});
