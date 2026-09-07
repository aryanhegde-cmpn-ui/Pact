import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeCollection } from '@/test/fake-collection';

const store = vi.hoisted(() => ({
  commitments: [] as Record<string, unknown>[],
  sessions: [] as Record<string, unknown>[],
  topics: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  progress: [] as { stableKey: string; status: string; note?: string }[],
  completed: [] as string[],
}));

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));
vi.mock('@/lib/db/models/commitment', () => ({
  CommitmentModel: fakeCollection(store.commitments),
}));
vi.mock('@/lib/db/models/curriculum-topic', () => ({
  CurriculumTopicModel: fakeCollection(store.topics),
}));
vi.mock('@/lib/db/models/focus-session', () => ({
  // The real unique partial index: one running session per owner. It is the
  // lock, and a mock without it would test nothing.
  FocusSessionModel: {
    ...fakeCollection(store.sessions, { uniqueBy: ['ownerId', 'endedAt'] }),
    findOneAndUpdate: (
      filter: Record<string, unknown>,
      update: Record<string, Record<string, number>>,
    ) => {
      const row = store.sessions.find(
        (entry) => entry.ownerId === filter.ownerId && (entry.endedAt ?? null) === null,
      );

      if (row && update.$inc) {
        for (const [field, by] of Object.entries(update.$inc)) {
          row[field] = ((row[field] as number) ?? 0) + by;
        }
      }

      return { lean: async () => row ?? null };
    },
  },
}));
vi.mock('@/lib/db/events', () => ({
  appendEvent: async (event: Record<string, unknown>) => {
    store.events.push(event);
    return { appended: true, type: event.type };
  },
}));
vi.mock('@/lib/commitments/service', () => ({
  completeCommitment: async (id: string) => {
    store.completed.push(id);
    const row = store.commitments.find((entry) => entry._id === id);
    if (row) {
      row.status = 'done';
      row.completedAt = new Date();
    }
    return { id, status: 'done' };
  },
}));
vi.mock('@/lib/curriculum/service', () => ({
  setTopicProgress: async (input: { stableKey: string; status: string; note?: string }) => {
    store.progress.push(input);
    return input;
  },
}));

const { actualMinutes, decideBudget, elapsedSeconds, endSession, getActiveSession, startSession } =
  await import('./service');

const OWNER = 'owner-1';
const START = new Date('2026-09-07T02:30:00.000Z');

beforeEach(() => {
  store.commitments.length = 0;
  store.sessions.length = 0;
  store.topics.length = 0;
  store.events = [];
  store.progress = [];
  store.completed = [];

  store.commitments.push({
    _id: 'block-commitment',
    ownerId: OWNER,
    title: 'DSA: Two Pointers',
    outcome: '5–8 problems',
    dueAt: new Date('2026-09-07T02:30:00.000Z'),
    estimateMinutes: 60,
    status: 'pending',
    startedAt: null,
    blockId: 'block-1',
    curriculumTopicKey: 'block-1/arrays/two-pointers/sorted',
  });

  store.commitments.push({
    _id: 'plain',
    ownerId: OWNER,
    title: 'Ship the report',
    outcome: 'The report is sent to Priya',
    dueAt: new Date('2026-09-07T09:00:00.000Z'),
    estimateMinutes: 45,
    status: 'pending',
    startedAt: null,
    blockId: null,
    curriculumTopicKey: null,
  });

  store.topics.push({
    ownerId: OWNER,
    stableKey: 'block-1/arrays/two-pointers/sorted',
    topic: 'Two Pointers',
    subTopic: 'Sorted arrays',
    practiceRaw: '5–8 problems',
    target: { kind: 'problems', unit: 'problems', targetMin: 5, targetMax: 8, needsReview: false },
  });
});

describe('the clock is the server’s', () => {
  it('survives ninety minutes of a backgrounded tab', async () => {
    /**
     * The case the whole design exists for. A study block is 60 to 90 minutes
     * with the phone locked; a backgrounded tab's timers are throttled to once
     * a minute or stopped outright. Nothing here counts intervals -- elapsed
     * is recomputed from `startedAt` every time it is asked for, so a tick
     * that never fires costs nothing.
     */
    await startSession({ commitmentId: 'block-commitment' }, OWNER, START);

    const ninetyLater = new Date(START.getTime() + 90 * 60_000);
    const active = await getActiveSession(OWNER, ninetyLater);

    expect(active?.elapsedSeconds).toBe(90 * 60);
  });

  it('reports the same elapsed whether it was asked once or a thousand times', async () => {
    await startSession({ commitmentId: 'plain' }, OWNER, START);

    const at = new Date(START.getTime() + 37 * 60_000);
    for (let i = 0; i < 5; i += 1) await getActiveSession(OWNER, at);
    const active = await getActiveSession(OWNER, at);

    expect(active?.elapsedSeconds).toBe(37 * 60);
  });

  it('sends its own clock, so a wrong device clock cannot drift the display', async () => {
    await startSession({ commitmentId: 'plain' }, OWNER, START);
    const at = new Date(START.getTime() + 60_000);

    const active = await getActiveSession(OWNER, at);

    expect(active?.serverNow).toBe(at.toISOString());
    expect(active?.startedAt).toBe(START.toISOString());
  });

  it('computes actual minutes from the two server timestamps', () => {
    const ninety = actualMinutes(START, new Date(START.getTime() + 90 * 60_000));

    expect(ninety).toBe(90);
    // Never zero: a session that genuinely happened and lasted forty seconds
    // is not zero minutes of work, and a zero would bias the estimate history
    // in the direction of flattery.
    expect(actualMinutes(START, new Date(START.getTime() + 40_000))).toBe(1);
  });

  it('never reports negative elapsed', () => {
    expect(elapsedSeconds(START, new Date(START.getTime() - 60_000))).toBe(0);
  });

  it('records actual minutes from the server, not from the request', async () => {
    await startSession({ commitmentId: 'plain' }, OWNER, START);

    const result = await endSession(
      // A client-supplied duration would be ignored; there is no field for it.
      { outcome: 'done', note: 'Sent it', actualMinutes: 3 } as never,
      OWNER,
      new Date(START.getTime() + 52 * 60_000),
    );

    expect(result.actualMinutes).toBe(52);
    expect(store.sessions[0]?.actualMinutes).toBe(52);
  });
});

describe('the kind', () => {
  it('defaults to execution', async () => {
    const active = await startSession({ commitmentId: 'plain' }, OWNER, START);

    // The planning ratio is defeated by a default that makes miscategorising
    // the path of least effort.
    expect(active.kind).toBe('execution');
  });

  it('takes a deliberate choice to be anything else', async () => {
    const active = await startSession({ commitmentId: 'plain', kind: 'planning' }, OWNER, START);

    expect(active.kind).toBe('planning');
    expect(store.events[0]?.payload).toMatchObject({ kind: 'planning' });
  });

  it('carries a research budget only for a research session', async () => {
    const planning = await startSession(
      { commitmentId: 'plain', kind: 'planning', researchBudgetMinutes: 20 },
      OWNER,
      START,
    );

    expect(planning.researchBudgetMinutes).toBeNull();
  });
});

describe('one session at a time', () => {
  it('refuses a second session for a different commitment', async () => {
    await startSession({ commitmentId: 'plain' }, OWNER, START);

    // The unique partial index decides, not a check-then-write -- and a second
    // tab is exactly the thing that produces that race.
    await expect(startSession({ commitmentId: 'block-commitment' }, OWNER, START)).rejects.toThrow(
      /already running/,
    );
  });

  it('returns the running session when the same one is started twice', async () => {
    const first = await startSession({ commitmentId: 'plain' }, OWNER, START);
    const again = await startSession({ commitmentId: 'plain' }, OWNER, START);

    // A double tap, or a retried request. Not an error.
    expect(again.id).toBe(first.id);
    expect(store.sessions).toHaveLength(1);
  });

  it('refuses to end a session twice', async () => {
    await startSession({ commitmentId: 'plain' }, OWNER, START);
    await endSession({ outcome: 'done', note: 'Sent' }, OWNER, new Date(START.getTime() + 60_000));

    await expect(
      endSession({ outcome: 'done', note: 'Sent' }, OWNER, new Date(START.getTime() + 120_000)),
    ).rejects.toThrow(/No session is running/);
    // The commitment was completed once, not twice.
    expect(store.completed).toEqual(['plain']);
  });

  it('marks the commitment in progress when the session starts', async () => {
    await startSession({ commitmentId: 'plain' }, OWNER, START);

    expect(store.commitments.find((c) => c._id === 'plain')?.status).toBe('in-progress');
    expect(store.events.map((e) => e.type)).toContain('COMMITMENT_STARTED');
  });
});

describe('done', () => {
  it('completes the commitment and records what changed', async () => {
    await startSession({ commitmentId: 'plain' }, OWNER, START);

    await endSession(
      { outcome: 'done', note: 'Sent to Priya with the Q3 numbers' },
      OWNER,
      new Date(START.getTime() + 40 * 60_000),
    );

    expect(store.completed).toEqual(['plain']);
    expect(store.commitments.find((c) => c._id === 'plain')?.notes).toBe(
      'Sent to Priya with the Q3 numbers',
    );
  });

  it('requires the one line', async () => {
    await startSession({ commitmentId: 'plain' }, OWNER, START);

    // It is what separates finished from ticked off.
    await expect(
      endSession({ outcome: 'done', note: '' }, OWNER, new Date(START.getTime() + 60_000)),
    ).rejects.toThrow();
  });
});

describe('a block session advances its topic', () => {
  it('records the problems solved against the topic', async () => {
    await startSession({ commitmentId: 'block-commitment' }, OWNER, START);

    const result = await endSession(
      {
        outcome: 'done',
        note: 'Two mediums, both first try',
        topicProgress: { problemsSolved: 2 },
      },
      OWNER,
      new Date(START.getTime() + 60 * 60_000),
    );

    // The reason the block is the commitment and the topic is the content.
    expect(store.progress).toEqual([
      { stableKey: 'block-1/arrays/two-pointers/sorted', status: 'done' },
    ]);
    expect(result.topicStatus).toBe('done');

    const logged = store.events.find((e) => e.type === 'PROGRESS_LOGGED');
    expect(logged?.payload).toMatchObject({ problemsSolved: 2, minutes: 60 });
  });

  it('leaves the topic in progress when nothing was solved', async () => {
    await startSession({ commitmentId: 'block-commitment' }, OWNER, START);

    await endSession(
      {
        outcome: 'done',
        note: 'Read the pattern, solved none',
        topicProgress: { problemsSolved: 0 },
      },
      OWNER,
      new Date(START.getTime() + 60 * 60_000),
    );

    expect(store.progress[0]?.status).toBe('in-progress');
  });

  it('honours needs-revision as its own status, not a lesser done', async () => {
    await startSession({ commitmentId: 'block-commitment' }, OWNER, START);

    await endSession(
      {
        outcome: 'done',
        note: 'Got there but had to look it up twice',
        topicProgress: { problemsSolved: 5, needsRevision: true },
      },
      OWNER,
      new Date(START.getTime() + 60 * 60_000),
    );

    expect(store.progress[0]?.status).toBe('needs-revision');
  });

  it('asks nothing of a commitment with no topic', async () => {
    await startSession({ commitmentId: 'plain' }, OWNER, START);

    const result = await endSession(
      { outcome: 'done', note: 'Sent' },
      OWNER,
      new Date(START.getTime() + 60_000),
    );

    expect(store.progress).toEqual([]);
    expect(result.topicStatus).toBeNull();
  });
});

describe('need more time', () => {
  it('is not a failure anywhere', async () => {
    await startSession({ commitmentId: 'plain' }, OWNER, START);

    const result = await endSession(
      { outcome: 'more-time', revisedEstimateMinutes: 120 },
      OWNER,
      new Date(START.getTime() + 45 * 60_000),
    );

    // Nothing completed, nothing abandoned, no miss, no reckoning.
    expect(store.completed).toEqual([]);
    const row = store.commitments.find((c) => c._id === 'plain');
    expect(row?.status).toBe('in-progress');
    expect(row?.completedAt).toBeUndefined();
    expect(result.outcome).toBe('more-time');
  });

  it('corrects the estimate with the evidence just gathered', async () => {
    await startSession({ commitmentId: 'plain' }, OWNER, START);

    await endSession(
      { outcome: 'more-time', revisedEstimateMinutes: 120 },
      OWNER,
      new Date(START.getTime() + 45 * 60_000),
    );

    expect(store.commitments.find((c) => c._id === 'plain')?.estimateMinutes).toBe(120);
    expect(store.events.find((e) => e.type === 'PROGRESS_LOGGED')?.payload).toMatchObject({
      previousEstimateMinutes: 45,
      revisedEstimateMinutes: 120,
      minutes: 45,
    });
  });

  it('leaves a block’s topic in progress, which is what carries it to tomorrow', async () => {
    await startSession({ commitmentId: 'block-commitment' }, OWNER, START);

    await endSession(
      { outcome: 'more-time', revisedEstimateMinutes: 90 },
      OWNER,
      new Date(START.getTime() + 60 * 60_000),
    );

    expect(store.progress).toEqual([
      { stableKey: 'block-1/arrays/two-pointers/sorted', status: 'in-progress' },
    ]);
    expect(store.sessions[0]).toMatchObject({ outcome: 'more-time', blockId: 'block-1' });
  });
});

describe('blocked', () => {
  it('records the blocker and its kind', async () => {
    await startSession({ commitmentId: 'plain' }, OWNER, START);

    await endSession(
      { outcome: 'blocked', blockerKind: 'information', blocker: 'The Q3 export is missing' },
      OWNER,
      new Date(START.getTime() + 20 * 60_000),
    );

    expect(store.commitments.find((c) => c._id === 'plain')?.status).toBe('blocked');
    expect(store.events.find((e) => e.type === 'TASK_BLOCKED')?.payload).toMatchObject({
      blockerKind: 'information',
      blocker: 'The Q3 export is missing',
    });
  });

  it('creates the follow-up when a person is blocking', async () => {
    await startSession({ commitmentId: 'plain' }, OWNER, START);

    await endSession(
      {
        outcome: 'blocked',
        blockerKind: 'person',
        blocker: 'Priya',
        createFollowUp: true,
        followUpAt: new Date('2026-09-09T09:00:00.000Z'),
      },
      OWNER,
      new Date(START.getTime() + 20 * 60_000),
    );

    // "Waiting on someone" with no date attached is how a commitment sits
    // blocked for a month with nobody having chased anything.
    const followUp = store.commitments.find((c) => c.title === 'Chase Priya');
    expect(followUp).toBeDefined();
    expect(store.commitments.find((c) => c._id === 'plain')?.blockedOn).toBe('Priya');
  });

  it('creates no follow-up for a missing-information block', async () => {
    await startSession({ commitmentId: 'plain' }, OWNER, START);

    await endSession(
      {
        outcome: 'blocked',
        blockerKind: 'information',
        blocker: 'The export',
        createFollowUp: true,
        followUpAt: new Date('2026-09-09T09:00:00.000Z'),
      },
      OWNER,
      new Date(START.getTime() + 20 * 60_000),
    );

    expect(store.commitments.some((c) => String(c.title).startsWith('Chase'))).toBe(false);
  });
});

describe('the research budget', () => {
  async function spentBudget() {
    await startSession(
      { commitmentId: 'plain', kind: 'research', researchBudgetMinutes: 20 },
      OWNER,
      START,
    );

    return getActiveSession(OWNER, new Date(START.getTime() + 21 * 60_000));
  }

  it('reports itself spent once the time is up', async () => {
    const active = await spentBudget();

    expect(active?.budgetSpent).toBe(true);
    expect(active?.budgetWarned).toBe(false);
  });

  it('is not spent before the time is up', async () => {
    await startSession(
      { commitmentId: 'plain', kind: 'research', researchBudgetMinutes: 20 },
      OWNER,
      START,
    );

    const active = await getActiveSession(OWNER, new Date(START.getTime() + 19 * 60_000));
    expect(active?.budgetSpent).toBe(false);
  });

  it('interrupts exactly once, whatever happens afterwards', async () => {
    await spentBudget();

    await decideBudget({ decision: 'execute' }, OWNER, new Date(START.getTime() + 21 * 60_000));

    // Much later, and still not asking again. A budget that nags gets
    // dismissed reflexively, and then it is noise rather than a decision.
    const later = await getActiveSession(OWNER, new Date(START.getTime() + 200 * 60_000));
    expect(later?.budgetWarned).toBe(true);
    expect(store.events.filter((e) => e.type === 'RESEARCH_BUDGET_SPENT')).toHaveLength(1);
  });

  it('switches the session to execution when that is the answer', async () => {
    await spentBudget();

    const after = await decideBudget(
      { decision: 'execute' },
      OWNER,
      new Date(START.getTime() + 21 * 60_000),
    );

    expect(after.kind).toBe('execution');
  });

  it('requires a justification to extend', async () => {
    await spentBudget();

    // Extending without saying why is how a research budget becomes a number
    // that is always extended, which is the same as not having one.
    await expect(
      decideBudget({ decision: 'extend', extraMinutes: 15 } as never, OWNER, START),
    ).rejects.toThrow();
  });

  it('extends the budget and records the reason', async () => {
    await spentBudget();

    await decideBudget(
      {
        decision: 'extend',
        extraMinutes: 15,
        justification: 'Still looking for how the chunk sizes are negotiated',
      },
      OWNER,
      new Date(START.getTime() + 21 * 60_000),
    );

    const active = await getActiveSession(OWNER, new Date(START.getTime() + 30 * 60_000));
    // 20 + 15, so at 30 minutes it is no longer spent.
    expect(active?.budgetSpent).toBe(false);
    expect(store.events.find((e) => e.type === 'RESEARCH_BUDGET_SPENT')?.payload).toMatchObject({
      decision: 'extend',
      extraMinutes: 15,
    });
  });

  it('answers a repeated decision quietly rather than erroring', async () => {
    await spentBudget();
    const at = new Date(START.getTime() + 21 * 60_000);

    await decideBudget({ decision: 'execute' }, OWNER, at);
    await expect(decideBudget({ decision: 'execute' }, OWNER, at)).resolves.toBeDefined();

    expect(store.events.filter((e) => e.type === 'RESEARCH_BUDGET_SPENT')).toHaveLength(1);
  });
});
