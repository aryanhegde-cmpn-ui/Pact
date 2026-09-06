import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  commitments: [] as Record<string, unknown>[],
  topics: [] as Record<string, unknown>[],
  progress: [] as Record<string, unknown>[],
  blocks: [] as Record<string, unknown>[],
  phases: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  updates: [] as { collection: string; update: Record<string, unknown> }[],
}));

function chain(rows: () => Record<string, unknown>[]) {
  const query = {
    sort: () => query,
    limit: () => query,
    lean: async () => rows(),
  };
  return query;
}

function match(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) =>
    key === '_id' ? String(row._id) === String(value) : row[key] === value,
  );
}

function collection(name: string, rows: () => Record<string, unknown>[]) {
  return {
    find: (filter: Record<string, unknown> = {}) =>
      chain(() => rows().filter((row) => match(row, filter))),
    findOne: (filter: Record<string, unknown>) => ({
      lean: async () => rows().find((row) => match(row, filter)) ?? null,
    }),
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      store.updates.push({ collection: name, update });
      const row = rows().find((entry) => match(entry, filter));
      const $set = (update.$set ?? {}) as Record<string, unknown>;
      if (row) Object.assign(row, $set);
      else rows().push({ ...filter, ...((update.$setOnInsert ?? {}) as object), ...$set });

      return { matchedCount: row ? 1 : 0, modifiedCount: 1 };
    },
  };
}

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ APP_TIMEZONE: 'Asia/Kolkata' }),
  EnvironmentError: class extends Error {},
}));
vi.mock('@/lib/commitments/service', () => ({ listByDateRange: async () => [] }));
vi.mock('@/lib/db/models/commitment', () => ({
  CommitmentModel: collection('commitments', () => store.commitments),
}));
vi.mock('@/lib/db/models/curriculum-topic', () => ({
  CurriculumTopicModel: collection('topics', () => store.topics),
}));
vi.mock('@/lib/db/models/topic-progress', () => ({
  TopicProgressModel: collection('progress', () => store.progress),
}));
vi.mock('@/lib/db/models/block', () => ({ BlockModel: collection('blocks', () => store.blocks) }));
vi.mock('@/lib/db/models/phase', () => ({ PhaseModel: collection('phases', () => store.phases) }));
vi.mock('@/lib/db/models/resource', () => ({ ResourceModel: collection('resources', () => []) }));
vi.mock('@/lib/db/models/interview-prep-item', () => ({
  InterviewPrepItemModel: collection('interview', () => []),
}));
vi.mock('@/lib/db/events', () => ({
  appendEvent: async (event: Record<string, unknown>) => {
    store.events.push(event);
  },
}));

const { CurriculumError, overrideTopic, setTopicProgress } = await import('./service');

const OWNER = 'owner-1';

beforeEach(() => {
  store.updates = [];
  store.events = [];
  store.progress = [];
  store.blocks = [
    {
      ownerId: OWNER,
      blockId: 'block-1',
      area: 'DSA',
      exactActivity: '1–2 problems',
      durationMinutes: 60,
      order: 0,
    },
    {
      ownerId: OWNER,
      blockId: 'block-2',
      area: 'Frontend Engineering',
      exactActivity: 'Hands-on build',
      durationMinutes: 90,
      order: 1,
    },
  ];
  store.phases = [];
  store.topics = [
    {
      ownerId: OWNER,
      stableKey: 'block-1/arrays/two-pointers/sorted',
      blockId: 'block-1',
      category: 'DSA',
      module: 'Arrays',
      topic: 'Two Pointers',
      subTopic: 'Sorted arrays',
      practiceRaw: '5–8 problems',
      priority: 'P0',
      order: 1,
      target: {
        kind: 'problems',
        unit: 'problems',
        targetMin: 5,
        targetMax: 8,
        needsReview: false,
      },
    },
    {
      ownerId: OWNER,
      stableKey: 'block-2/ui/modal/focus-trap',
      blockId: 'block-2',
      category: 'Machine Coding',
      module: 'UI Components',
      topic: 'Modal',
      subTopic: 'Focus trap',
      practiceRaw: '45–60 min build',
      priority: 'P0',
      order: 35,
      target: { kind: 'build', unit: 'minutes', targetMin: 45, targetMax: 60, needsReview: false },
    },
  ];
  store.commitments = [
    {
      _id: 'c1',
      ownerId: OWNER,
      blockId: 'block-1',
      curriculumTopicKey: 'block-1/arrays/arrays/traversal',
      title: 'DSA: Arrays',
      outcome: '8–10 representative problems',
      dueAt: new Date('2026-09-07T02:30:00Z'),
    },
  ];
});

describe('overriding today’s topic', () => {
  it('renames the commitment and points it at the new topic', async () => {
    await overrideTopic(
      { commitmentId: 'c1', stableKey: 'block-1/arrays/two-pointers/sorted' },
      OWNER,
    );

    expect(store.commitments[0]).toMatchObject({
      curriculumTopicKey: 'block-1/arrays/two-pointers/sorted',
      title: 'DSA: Two Pointers · Sorted arrays',
      // The topic's own practice instruction becomes the outcome, which is
      // what makes a plan-generated commitment specific without typing.
      outcome: '5–8 problems',
    });
  });

  it('NEVER writes dueAt', async () => {
    // Changing what you study at 7am is not changing when the block is. If it
    // ever needed to move the deadline it would have to go through
    // changeDeadline(), which requires a category and a reason.
    await overrideTopic(
      { commitmentId: 'c1', stableKey: 'block-1/arrays/two-pointers/sorted' },
      OWNER,
    );

    for (const write of store.updates) {
      expect(JSON.stringify(write.update)).not.toContain('dueAt');
    }
    expect(store.commitments[0]?.dueAt).toEqual(new Date('2026-09-07T02:30:00Z'));
  });

  it('records the swap, with what it was before', async () => {
    await overrideTopic(
      { commitmentId: 'c1', stableKey: 'block-1/arrays/two-pointers/sorted' },
      OWNER,
    );

    expect(store.events[0]).toMatchObject({
      type: 'PLAN_TOPIC_OVERRIDDEN',
      payload: {
        from: 'block-1/arrays/arrays/traversal',
        to: 'block-1/arrays/two-pointers/sorted',
      },
    });
  });

  it('refuses a topic from a different block', async () => {
    // Block 1 is an hour of DSA. A machine-coding build in it would make the
    // block's own record meaningless.
    await expect(
      overrideTopic({ commitmentId: 'c1', stableKey: 'block-2/ui/modal/focus-trap' }, OWNER),
    ).rejects.toThrow(/different block/);
  });

  it('clears the topic when asked, falling back to the block’s own activity', async () => {
    await overrideTopic({ commitmentId: 'c1', stableKey: null }, OWNER);

    expect(store.commitments[0]).toMatchObject({
      curriculumTopicKey: null,
      title: 'DSA',
      outcome: '1–2 problems',
    });
  });

  it('refuses a commitment that is not part of the plan', async () => {
    store.commitments.push({ _id: 'c2', ownerId: OWNER, blockId: null, title: 'Ship the report' });

    await expect(
      overrideTopic({ commitmentId: 'c2', stableKey: 'block-1/arrays/two-pointers/sorted' }, OWNER),
    ).rejects.toThrow(CurriculumError);
  });

  it('will not touch another owner’s commitment', async () => {
    store.commitments.push({ _id: 'c3', ownerId: 'someone-else', blockId: 'block-1' });

    await expect(
      overrideTopic({ commitmentId: 'c3', stableKey: 'block-1/arrays/two-pointers/sorted' }, OWNER),
    ).rejects.toThrow(/No such commitment/);
  });
});

describe('topic progress', () => {
  const KEY = 'block-1/arrays/two-pointers/sorted';

  it('records the change with where it came from', async () => {
    await setTopicProgress({ stableKey: KEY, status: 'in-progress' }, OWNER);

    expect(store.events[0]).toMatchObject({
      type: 'TOPIC_PROGRESS_CHANGED',
      entityType: 'topic',
      entityId: KEY,
      payload: { from: 'not-started', to: 'in-progress' },
    });
  });

  it('keeps the note out of the event payload', async () => {
    await setTopicProgress(
      { stableKey: KEY, status: 'needs-revision', note: 'I fudged this' },
      OWNER,
    );

    // Free text is private by default, and the overseer's read model is built
    // from events. Putting it here is the quiet way it becomes readable.
    expect(JSON.stringify(store.events)).not.toContain('I fudged this');
    expect(store.progress[0]?.note).toBe('I fudged this');
  });

  it('treats needs-revision as its own state, not a kind of done', async () => {
    await setTopicProgress({ stableKey: KEY, status: 'done' }, OWNER);
    await setTopicProgress({ stableKey: KEY, status: 'needs-revision' }, OWNER);

    expect(store.progress[0]?.status).toBe('needs-revision');
    // But the fact that it was once finished survives.
    expect(store.progress[0]?.firstDoneAt).toBeInstanceOf(Date);
  });

  it('refuses a key that is not in the curriculum', async () => {
    await expect(
      setTopicProgress({ stableKey: 'made/up/key/entirely', status: 'done' }, OWNER),
    ).rejects.toThrow(/No such topic/);
  });
});
