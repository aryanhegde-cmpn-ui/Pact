import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MappedWorkbook } from './import-map';

const store = vi.hoisted(() => ({
  blocks: [] as Record<string, unknown>[],
  phases: [] as Record<string, unknown>[],
  topics: [] as Record<string, unknown>[],
  resources: [] as Record<string, unknown>[],
  interview: [] as Record<string, unknown>[],
  /** Deliberately never written to. See the test at the bottom of this file. */
  progress: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  writes: [] as { collection: string; filter: unknown; update: unknown }[],
}));

function collection(name: string, rows: () => Record<string, unknown>[]) {
  return {
    find: () => ({ lean: async () => rows(), sort: () => ({ lean: async () => rows() }) }),
    updateOne: async (filter: unknown, update: unknown) => {
      store.writes.push({ collection: name, filter, update });

      const $set = (update as { $set?: Record<string, unknown> }).$set ?? {};
      const insert = (update as { $setOnInsert?: Record<string, unknown> }).$setOnInsert;
      const key = filter as Record<string, unknown>;
      const existing = rows().find((row) =>
        Object.entries(key).every(([field, value]) => row[field] === value),
      );

      if (existing) Object.assign(existing, $set);
      else rows().push({ ...key, ...insert, ...$set });

      return { modifiedCount: 1 };
    },
  };
}

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));
vi.mock('@/lib/db/models/block', () => ({ BlockModel: collection('blocks', () => store.blocks) }));
vi.mock('@/lib/db/models/phase', () => ({ PhaseModel: collection('phases', () => store.phases) }));
vi.mock('@/lib/db/models/curriculum-topic', () => ({
  CurriculumTopicModel: collection('topics', () => store.topics),
}));
vi.mock('@/lib/db/models/resource', () => ({
  ResourceModel: collection('resources', () => store.resources),
}));
vi.mock('@/lib/db/models/interview-prep-item', () => ({
  InterviewPrepItemModel: collection('interview', () => store.interview),
}));
vi.mock('@/lib/db/models/topic-progress', () => ({
  TopicProgressModel: collection('progress', () => store.progress),
}));
vi.mock('@/lib/db/events', () => ({
  appendEvent: async (event: Record<string, unknown>) => {
    store.events.push(event);
  },
}));

const { importCurriculum } = await import('./import-service');

const OWNER = 'owner-1';

function topic(stableKey: string, overrides: Record<string, unknown> = {}) {
  return {
    stableKey,
    blockId: 'block-1' as const,
    category: 'DSA',
    module: 'Arrays',
    topic: 'Arrays',
    subTopic: 'Traversal',
    resourceName: 'Namaste DSA',
    link: 'https://example.test',
    practiceRaw: '5 problems',
    target: {
      kind: 'problems' as const,
      unit: 'problems' as const,
      targetMin: 5,
      targetMax: 5,
      needsReview: false,
      reviewReason: null,
    },
    priority: 'P0' as const,
    order: 0,
    ...overrides,
  };
}

function workbook(overrides: Partial<MappedWorkbook> = {}): MappedWorkbook {
  return {
    blocks: [
      {
        blockId: 'block-1',
        label: '7:00–8:00',
        area: 'DSA',
        exactActivity: '1–2 problems',
        primaryResource: 'Namaste DSA Sheet',
        cadence: 'Daily',
        kind: 'study',
        startTime: '07:00',
        endTime: '08:00',
        durationMinutes: 60,
        order: 0,
      },
    ],
    phases: [
      {
        number: 1,
        datesRaw: 'Sep 7–Sep 30',
        startDate: '2026-09-07',
        endDate: '2026-09-30',
        primaryFocus: 'JS + DSA foundations',
        secondaryFocus: 'Machine coding basics',
        outcome: 'Close core JS gaps',
        rule: 'Hands-on > passive watching',
        focusCategories: ['DSA'],
        focusModules: [],
        revisionOnly: false,
        revisionBias: false,
      },
    ],
    topics: [topic('block-1/arrays/arrays/traversal')],
    resources: [
      {
        name: 'Namaste DSA Sheet',
        type: 'Core',
        use: 'Primary DSA question bank',
        link: 'https://example.test',
        howToUse: "Daily; don't finish as a course",
        order: 0,
      },
    ],
    interviewPrep: [
      {
        stableKey: 'resume/bundle',
        category: 'Resume',
        topic: '70% bundle reduction',
        whatToMaster: 'Baseline, root cause',
        practice: '5-min verbal',
        rehearsalFrom: '2026-11-01',
        order: 0,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  store.blocks = [];
  store.phases = [];
  store.topics = [];
  store.resources = [];
  store.interview = [];
  store.progress = [];
  store.events = [];
  store.writes = [];
});

describe('a first import', () => {
  it('creates every row and reports what it did', async () => {
    const report = await importCurriculum(workbook(), OWNER);

    expect(report.blocks).toEqual({ created: 1, updated: 0, unchanged: 0 });
    expect(report.topics).toEqual({ created: 1, updated: 0, unchanged: 0 });
    expect(report.resources.created).toBe(1);
    expect(report.interviewPrep.created).toBe(1);
  });

  it('scopes every row to the owner', async () => {
    await importCurriculum(workbook(), OWNER);

    for (const row of [...store.topics, ...store.phases, ...store.blocks]) {
      expect(row.ownerId).toBe(OWNER);
    }
  });

  it('records the import in the event log', async () => {
    await importCurriculum(workbook(), OWNER);

    // Otherwise "why does the plan say November?" has no answer beyond the
    // current contents of a spreadsheet on somebody's laptop.
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({ type: 'CURRICULUM_IMPORTED', entityType: 'plan' });
  });
});

describe('re-running it', () => {
  it('reports everything unchanged and writes nothing', async () => {
    await importCurriculum(workbook(), OWNER);
    store.writes = [];

    const second = await importCurriculum(workbook(), OWNER);

    expect(second.topics).toEqual({ created: 0, updated: 0, unchanged: 1 });
    expect(second.phases.unchanged).toBe(1);
    expect(store.writes).toEqual([]);
  });

  it('updates a definition that changed', async () => {
    await importCurriculum(workbook(), OWNER);

    const edited = workbook({
      topics: [topic('block-1/arrays/arrays/traversal', { priority: 'P1' })],
    });
    const report = await importCurriculum(edited, OWNER);

    expect(report.topics).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect(store.topics[0]?.priority).toBe('P1');
  });
});

describe('progress is never touched', () => {
  it('does not write to the progress collection at all', async () => {
    store.progress = [
      { ownerId: OWNER, stableKey: 'block-1/arrays/arrays/traversal', status: 'done' },
    ];

    await importCurriculum(workbook(), OWNER);
    await importCurriculum(workbook(), OWNER);

    // The load-bearing claim: an import that could lose progress is one nobody
    // dares re-run, and a curriculum that cannot be re-imported drifts out of
    // sync with the spreadsheet until they are different plans.
    expect(store.writes.filter((write) => write.collection === 'progress')).toEqual([]);
    expect(store.progress[0]?.status).toBe('done');
  });

  it('keeps progress attached when a topic is removed from the workbook', async () => {
    await importCurriculum(workbook(), OWNER);
    store.progress = [
      { ownerId: OWNER, stableKey: 'block-1/arrays/arrays/traversal', status: 'done' },
    ];

    const report = await importCurriculum(workbook({ topics: [] }), OWNER);

    // Reported, never deleted: the definition going away must not make the
    // record of having studied it look like it never happened.
    expect(report.orphaned).toEqual(['block-1/arrays/arrays/traversal']);
    expect(store.topics).toHaveLength(1);
    expect(store.progress[0]?.status).toBe('done');
  });
});

describe('what it refuses to overwrite', () => {
  it('leaves a re-planned phase’s dates alone, and says so', async () => {
    await importCurriculum(workbook(), OWNER);
    Object.assign(store.phases[0] as Record<string, unknown>, {
      replannedAt: new Date('2026-09-20'),
      startDate: '2026-09-14',
      endDate: '2026-10-07',
    });

    const report = await importCurriculum(workbook(), OWNER);

    // A re-plan is a decision with a reason recorded against it. Re-importing
    // must not silently undo it.
    expect(store.phases[0]?.startDate).toBe('2026-09-14');
    expect(report.keptReplannedPhases).toEqual([1]);
  });

  it('still updates a re-planned phase’s other fields', async () => {
    await importCurriculum(workbook(), OWNER);
    Object.assign(store.phases[0] as Record<string, unknown>, {
      replannedAt: new Date('2026-09-20'),
    });

    const edited = workbook();
    edited.phases[0]!.outcome = 'Something else';
    await importCurriculum(edited, OWNER);

    expect(store.phases[0]?.outcome).toBe('Something else');
  });

  it('leaves a hand-corrected target alone, and says so', async () => {
    await importCurriculum(workbook(), OWNER);
    const stored = store.topics[0] as Record<string, unknown>;
    stored.target = {
      kind: 'build',
      unit: 'minutes',
      targetMin: 45,
      targetMax: 45,
      needsReview: false,
      reviewReason: null,
      correctedByHand: true,
    };

    const report = await importCurriculum(workbook(), OWNER);

    // The point of the review list is that the parse was wrong. Re-applying
    // the same wrong parse would make correcting it pointless.
    expect((store.topics[0]?.target as { kind: string }).kind).toBe('build');
    expect(report.keptCorrectedTargets).toEqual(['block-1/arrays/arrays/traversal']);
  });

  it('still updates the rest of a hand-corrected topic', async () => {
    await importCurriculum(workbook(), OWNER);
    (store.topics[0] as Record<string, unknown>).target = {
      kind: 'build',
      needsReview: false,
      correctedByHand: true,
    };

    await importCurriculum(
      workbook({ topics: [topic('block-1/arrays/arrays/traversal', { module: 'Renamed' })] }),
      OWNER,
    );

    expect(store.topics[0]?.module).toBe('Renamed');
  });
});

describe('a dry run', () => {
  it('reports what would happen and writes nothing at all', async () => {
    const report = await importCurriculum(workbook(), OWNER, { dryRun: true });

    expect(report.topics.created).toBe(1);
    expect(report.dryRun).toBe(true);
    expect(store.writes).toEqual([]);
    expect(store.topics).toEqual([]);
    // Not even the event: nothing happened.
    expect(store.events).toEqual([]);
  });
});

describe('flagged rows', () => {
  it('counts the rows the parser could not read', async () => {
    const report = await importCurriculum(
      workbook({
        topics: [
          topic('a'),
          topic('b', {
            practiceRaw: 'Whiteboard + edge cases',
            target: {
              kind: 'other',
              unit: null,
              targetMin: null,
              targetMax: null,
              needsReview: true,
              reviewReason: 'no recognised target',
            },
          }),
        ],
      }),
      OWNER,
    );

    expect(report.flagged).toBe(1);
  });
});
