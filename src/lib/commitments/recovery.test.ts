import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeCollection } from '@/test/fake-collection';

/**
 * Recovery mode.
 *
 * The two claims worth testing are the triggers and the refusal to leave. A
 * mode that never fires is decoration; one that fires and then lets you out
 * after a single tap is worse than decoration, because it looks like the
 * backlog was dealt with.
 */
const store = vi.hoisted(() => ({
  commitments: [] as Record<string, unknown>[],
  sessions: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  counts: { total: 0, needsReckoning: 0 },
  resolved: [] as { fn: string; id: string }[],
}));

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));
vi.mock('@/lib/db/models/commitment', () => ({
  CommitmentModel: fakeCollection(store.commitments),
}));
vi.mock('@/lib/db/models/recovery-session', () => ({
  RecoverySessionModel: fakeCollection(store.sessions, { uniqueBy: ['ownerId', 'endedAt'] }),
}));
vi.mock('@/lib/db/events', () => ({
  appendEvent: async (event: Record<string, unknown>) => {
    store.events.push(event);
    return { appended: true, type: event.type };
  },
}));

/**
 * The counts come from an aggregation over commitments and events; the service
 * that owns it is tested separately. Here it is a dial, so the thresholds can
 * be walked across precisely.
 */
vi.mock('@/lib/commitments/service', () => ({
  overdueCounts: async () => store.counts,
  completeCommitment: async (id: string) => {
    store.resolved.push({ fn: 'complete', id });
    const row = store.commitments.find((entry) => entry._id === id);
    if (row) row.status = 'done';
  },
  abandonCommitment: async (id: string) => {
    store.resolved.push({ fn: 'abandon', id });
    const row = store.commitments.find((entry) => entry._id === id);
    if (row) row.status = 'abandoned';
  },
  CommitmentError: class CommitmentError extends Error {
    constructor(
      message: string,
      readonly status = 400,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/commitments/reckoning', () => ({
  submitReckoning: async (id: string) => {
    store.resolved.push({ fn: 'reckon', id });
    return { recorded: true, action: null, effect: '', createdCommitmentIds: [] };
  },
}));
vi.mock('@/lib/commitments/deadline', () => ({
  changeDeadline: async (id: string) => {
    store.resolved.push({ fn: 'changeDeadline', id });
    return { previousDueAt: new Date(), newDueAt: new Date() };
  },
}));

const { getRecoveryState, resolveSlot } = await import('./recovery');

const OWNER = 'owner-1';
const NOW = new Date('2026-09-20T09:00:00.000Z');

function commitment(id: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    ownerId: OWNER,
    title: `Commitment ${id}`,
    outcome: 'Something verifiable',
    dueAt: new Date('2026-09-10T09:00:00.000Z'),
    estimateMinutes: 60,
    status: 'pending',
    startedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  store.commitments.length = 0;
  store.sessions.length = 0;
  store.events = [];
  store.resolved = [];
  store.counts = { total: 0, needsReckoning: 0 };

  for (let i = 0; i < 30; i += 1) {
    store.commitments.push(
      commitment(`c${i}`, {
        estimateMinutes: 15 + i * 5,
        dueAt: new Date(`2026-09-${String(1 + (i % 18)).padStart(2, '0')}T09:00:00.000Z`),
        startedAt: i % 3 === 0 ? null : new Date('2026-09-11T09:00:00.000Z'),
      }),
    );
  }
});

describe('the triggers', () => {
  it('stays off at the thresholds, and fires above them', async () => {
    store.counts = { total: 20, needsReckoning: 10 };
    expect((await getRecoveryState(OWNER, NOW)).active).toBe(false);

    store.counts = { total: 21, needsReckoning: 10 };
    expect((await getRecoveryState(OWNER, NOW)).active).toBe(true);
  });

  it('fires on unanswered misses alone, with the overdue count well under', async () => {
    // Two different failures. A reckoning debt makes the record unable to say
    // anything true about behaviour, whatever the volume is.
    store.counts = { total: 11, needsReckoning: 11 };

    expect((await getRecoveryState(OWNER, NOW)).active).toBe(true);
  });

  it('fires on volume alone, with every miss dutifully answered', async () => {
    store.counts = { total: 21, needsReckoning: 0 };

    expect((await getRecoveryState(OWNER, NOW)).active).toBe(true);
  });

  it('fires on the real seeded backlog', async () => {
    // The measured state of the database this was built against.
    store.counts = { total: 44, needsReckoning: 34 };

    expect((await getRecoveryState(OWNER, NOW)).active).toBe(true);
  });
});

describe('the episode', () => {
  it('opens one session and records entering, once', async () => {
    store.counts = { total: 44, needsReckoning: 34 };

    await getRecoveryState(OWNER, NOW);
    await getRecoveryState(OWNER, NOW);
    await getRecoveryState(OWNER, NOW);

    expect(store.sessions).toHaveLength(1);
    expect(store.events.filter((e) => e.type === 'RECOVERY_MODE_ENTERED')).toHaveLength(1);
  });

  it('opens exactly one session under concurrent reads', async () => {
    // Several serverless invocations can observe the same thresholds at the
    // same instant. The unique partial index decides; the losers see a
    // duplicate-key error, which is success.
    store.counts = { total: 44, needsReckoning: 34 };

    await Promise.all(Array.from({ length: 5 }, () => getRecoveryState(OWNER, NOW)));

    expect(store.sessions).toHaveLength(1);
    expect(store.events.filter((e) => e.type === 'RECOVERY_MODE_ENTERED')).toHaveLength(1);
  });

  it('records leaving when the counts drop, and closes the session', async () => {
    store.counts = { total: 44, needsReckoning: 34 };
    await getRecoveryState(OWNER, NOW);

    store.counts = { total: 9, needsReckoning: 2 };
    const state = await getRecoveryState(OWNER, NOW);

    expect(state.active).toBe(false);
    expect(store.sessions[0]?.endedAt).toBeInstanceOf(Date);
    expect(store.events.filter((e) => e.type === 'RECOVERY_MODE_EXITED')).toHaveLength(1);
  });

  it('records leaving once, however many times the page is read', async () => {
    store.counts = { total: 44, needsReckoning: 34 };
    await getRecoveryState(OWNER, NOW);

    store.counts = { total: 9, needsReckoning: 2 };
    await getRecoveryState(OWNER, NOW);
    await getRecoveryState(OWNER, NOW);

    expect(store.events.filter((e) => e.type === 'RECOVERY_MODE_EXITED')).toHaveLength(1);
  });

  it('never records leaving without having entered', async () => {
    store.counts = { total: 3, needsReckoning: 1 };

    await getRecoveryState(OWNER, NOW);

    expect(store.events).toEqual([]);
  });
});

describe('the three slots', () => {
  beforeEach(() => {
    store.counts = { total: 44, needsReckoning: 34 };
  });

  it('offers exactly three, one of each disposition', async () => {
    const state = await getRecoveryState(OWNER, NOW);

    // Triage is the point. Three slots that could all be rescheduled would be
    // the backlog spiral with extra steps.
    expect(state.slots.map((s) => s.slot)).toEqual(['finish', 'reschedule', 'abandon']);
  });

  it('never offers the same commitment twice', async () => {
    const state = await getRecoveryState(OWNER, NOW);
    const ids = state.slots.map((s) => s.suggested?.id);

    expect(new Set(ids).size).toBe(3);
  });

  it('puts the smallest thing in the finish slot', async () => {
    // The slot has to be plausible today or the pass does not happen at all.
    const state = await getRecoveryState(OWNER, NOW);
    const finish = state.slots.find((s) => s.slot === 'finish')?.suggested;
    const smallest = Math.min(...state.candidates.map((c) => c.estimateMinutes));

    expect(finish?.estimateMinutes).toBe(smallest);
  });

  it('puts the largest in the reschedule slot', async () => {
    const state = await getRecoveryState(OWNER, NOW);
    const reschedule = state.slots.find((s) => s.slot === 'reschedule')?.suggested;
    const largest = Math.max(...state.candidates.map((c) => c.estimateMinutes));

    expect(reschedule?.estimateMinutes).toBe(largest);
  });

  it('prefers a never-started commitment for abandon', async () => {
    const state = await getRecoveryState(OWNER, NOW);
    const abandon = state.slots.find((s) => s.slot === 'abandon')?.suggested;

    expect(abandon?.neverStarted).toBe(true);
  });

  it('offers the whole pool so a suggestion can be swapped', async () => {
    // Forcing a specific commitment to be abandoned would be the app making a
    // decision that is not its to make.
    const state = await getRecoveryState(OWNER, NOW);

    expect(state.candidates.length).toBeGreaterThan(3);
  });

  it('shows nothing else at all', async () => {
    const state = await getRecoveryState(OWNER, NOW);

    // No drift, no curriculum, no adherence, no streak. Everything absent is
    // an input to planning, and planning is the thing to stop doing.
    expect(Object.keys(state).sort()).toEqual([
      'active',
      'candidates',
      'counts',
      'session',
      'slots',
      'thresholds',
    ]);
  });
});

describe('resolving a slot', () => {
  beforeEach(() => {
    store.counts = { total: 44, needsReckoning: 34 };
  });

  it('completes through the ordinary service', async () => {
    await resolveSlot({ slot: 'finish', commitmentId: 'c1' }, OWNER, NOW);

    expect(store.resolved).toEqual([{ fn: 'complete', id: 'c1' }]);
  });

  it('answers the miss BEFORE moving the deadline', async () => {
    /**
     * An unanswered miss cannot be rescheduled -- that refusal is the whole
     * reckoning feature. A backlog is exactly when it would be tempting to let
     * it slide, and exactly when doing so would destroy the record that
     * explains how the backlog happened.
     */
    await resolveSlot(
      {
        slot: 'reschedule',
        commitmentId: 'c2',
        reason: 'avoided',
        nextAction: 'Open the file and write one paragraph',
        newDueAt: new Date('2026-09-25T09:00:00.000Z'),
      },
      OWNER,
      NOW,
    );

    expect(store.resolved.map((r) => r.fn)).toEqual(['reckon', 'changeDeadline']);
  });

  it('records the deadline category derived from the miss reason', async () => {
    const result = await resolveSlot(
      {
        slot: 'reschedule',
        commitmentId: 'c2',
        reason: 'avoided',
        nextAction: 'Open the file',
        newDueAt: new Date('2026-09-25T09:00:00.000Z'),
      },
      OWNER,
      NOW,
    );

    expect(result.effect).toContain('avoidance');
  });

  it('abandons with the reason on the record', async () => {
    await resolveSlot(
      { slot: 'abandon', commitmentId: 'c3', reason: 'It stopped mattering in July' },
      OWNER,
      NOW,
    );

    expect(store.resolved).toEqual([{ fn: 'abandon', id: 'c3' }]);
  });

  it('refuses when recovery is not active', async () => {
    // Otherwise the recovery endpoint is a way to complete a commitment
    // without the ordinary surface's rules.
    store.counts = { total: 2, needsReckoning: 0 };

    await expect(resolveSlot({ slot: 'finish', commitmentId: 'c1' }, OWNER, NOW)).rejects.toThrow(
      /not active/,
    );
  });

  it('requires a reason to reschedule and one to abandon', async () => {
    await expect(
      resolveSlot({ slot: 'abandon', commitmentId: 'c3', reason: '   ' } as never, OWNER, NOW),
    ).rejects.toThrow();

    await expect(
      resolveSlot(
        {
          slot: 'reschedule',
          commitmentId: 'c2',
          reason: 'avoided',
          nextAction: '',
          newDueAt: new Date(),
        } as never,
        OWNER,
        NOW,
      ),
    ).rejects.toThrow();
  });
});

describe('getting out', () => {
  it('does not let one pass end it while the counts are still high', async () => {
    store.counts = { total: 44, needsReckoning: 34 };

    await resolveSlot({ slot: 'finish', commitmentId: 'c1' }, OWNER, NOW);
    await resolveSlot(
      {
        slot: 'reschedule',
        commitmentId: 'c2',
        reason: 'underestimated',
        nextAction: 'Draft the outline',
        newDueAt: new Date('2026-09-25T09:00:00.000Z'),
      },
      OWNER,
      NOW,
    );
    const third = await resolveSlot(
      { slot: 'abandon', commitmentId: 'c3', reason: 'Not happening' },
      OWNER,
      NOW,
    );

    // Three dispatched, and still in recovery: 44 is a long way above 20.
    expect(third.state.active).toBe(true);
    expect(store.events.filter((e) => e.type === 'RECOVERY_MODE_EXITED')).toEqual([]);
  });

  it('counts a pass only when three DIFFERENT commitments are dispatched', async () => {
    store.counts = { total: 44, needsReckoning: 34 };

    await resolveSlot({ slot: 'finish', commitmentId: 'c1' }, OWNER, NOW);
    await resolveSlot({ slot: 'finish', commitmentId: 'c1' }, OWNER, NOW);
    const twice = await resolveSlot({ slot: 'finish', commitmentId: 'c1' }, OWNER, NOW);

    // A double tap on one slot is not a pass.
    expect(twice.state.session?.passes).toBe(0);
  });

  it('leaves only when both counts are back under', async () => {
    store.counts = { total: 44, needsReckoning: 34 };
    await getRecoveryState(OWNER, NOW);

    // Volume dealt with, reckoning debt not.
    store.counts = { total: 18, needsReckoning: 14 };
    expect((await getRecoveryState(OWNER, NOW)).active).toBe(true);

    store.counts = { total: 18, needsReckoning: 9 };
    expect((await getRecoveryState(OWNER, NOW)).active).toBe(false);
  });
});
