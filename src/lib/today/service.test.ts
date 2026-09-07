import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlanContext } from '@/lib/curriculum/plan';

const store = vi.hoisted(() => ({
  commitments: [] as Record<string, unknown>[],
  phases: [] as Record<string, unknown>[],
  counts: { total: 0, needsReckoning: 0 },
  context: null as unknown,
  /** How many times stakes evaluation ran. Tomorrow must never trigger it. */
  evaluated: 0,
}));

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ APP_TIMEZONE: 'Asia/Kolkata' }),
  EnvironmentError: class extends Error {},
}));
vi.mock('@/lib/commitments/service', () => ({
  listByDateRange: async () => store.commitments,
  overdueCounts: async () => store.counts,
}));
vi.mock('@/lib/curriculum/plan', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/curriculum/plan')>();

  return { ...original, loadPlanContext: async () => store.context };
});
vi.mock('@/lib/db/models/phase', () => ({
  PhaseModel: { find: () => ({ sort: () => ({ lean: async () => store.phases }) }) },
}));

/**
 * The stakes have their own tests. Here they are a stub, so a Today assertion
 * cannot fail because a consequence evaluated -- and so that the dynamic
 * import `readOnlyStakes` uses resolves to the same mock.
 */
const EMPTY_STAKES = {
  onVacation: false,
  vacationSince: null,
  adherence: { kept: 0, of: 0, rate: 0, vacationDays: 0, sparse: true },
  topicsDone: 0,
  rewards: [],
  consequences: [],
  active: null,
  claimable: [],
};

vi.mock('@/lib/stakes/service', () => ({
  evaluateAndGetStakes: async () => {
    store.evaluated += 1;
    return EMPTY_STAKES;
  },
  readState: async () => EMPTY_STAKES,
}));

const { buildDay, splitTopicLabel } = await import('./service');

const OWNER = 'owner-1';
/** 2026-09-07 08:30 IST. Monday, inside the study window. */
const NOW = new Date('2026-09-07T03:00:00.000Z');
const TODAY = '2026-09-07';

function commitment(overrides: Record<string, unknown> = {}) {
  return {
    id: `c${Math.random()}`,
    title: 'Something',
    outcome: 'Something verifiable',
    dueAt: '2026-09-07T02:30:00.000Z',
    originalDueAt: '2026-09-07T02:30:00.000Z',
    estimateMinutes: 60,
    status: 'pending',
    priority: 'important',
    seriesId: null,
    occurrenceDate: TODAY,
    notes: '',
    createdAt: '2026-09-06T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    missed: false,
    minutesOverdue: 0,
    postponed: false,
    needsReckoning: false,
    nextAction: null,
    blockedOn: null,
    followUpDate: null,
    displacedBy: null,
    deadlineChanges: 0,
    blockId: null,
    curriculumTopicKey: null,
    topicOverridden: false,
    ...overrides,
  };
}

const CONTEXT: PlanContext = {
  blocks: [
    {
      blockId: 'block-1',
      area: 'DSA',
      exactActivity: '1–2 problems',
      durationMinutes: 60,
      startTime: '07:00',
      endTime: '08:00',
    },
    {
      blockId: 'block-2',
      area: 'Frontend Engineering',
      exactActivity: 'Hands-on build',
      durationMinutes: 90,
      startTime: '08:00',
      endTime: '09:30',
    },
    {
      blockId: 'block-3',
      area: 'System Design',
      exactActivity: 'One concept',
      durationMinutes: 30,
      startTime: '09:30',
      endTime: '10:00',
    },
  ],
  phases: [
    {
      number: 1,
      startDate: '2026-09-07',
      endDate: '2026-09-30',
      focusCategories: ['DSA'],
      focusModules: [],
      revisionOnly: false,
      revisionBias: false,
    },
  ],
  topics: [
    {
      stableKey: 'block-1/arrays/two-pointers/sorted',
      blockId: 'block-1',
      category: 'DSA',
      module: 'Arrays',
      topic: 'Two Pointers',
      subTopic: 'Sorted arrays',
      priority: 'P0',
      order: 1,
      practiceRaw: '5–8 problems',
    },
  ],
  progress: new Map(),
  carriedOver: new Map(),
};

beforeEach(() => {
  store.commitments = [];
  store.phases = [
    {
      number: 1,
      startDate: '2026-09-07',
      endDate: '2026-09-30',
      outcome: 'Close core JS gaps',
      focusCategories: ['DSA'],
      focusModules: [],
    },
  ];
  store.counts = { total: 0, needsReckoning: 0 };
  store.context = CONTEXT;
  store.evaluated = 0;
});

describe('the ring denominator', () => {
  it('is exactly three, whatever else is due', () => {
    /**
     * The ring measures adherence to the PLAN, not total workload. A
     * denominator of "everything due today" would make a day with nine errands
     * read as a day with nine-elevenths of a study plan.
     */
    store.commitments = [
      commitment({ id: 'b1', blockId: 'block-1', status: 'done' }),
      commitment({ id: 'b2', blockId: 'block-2' }),
      commitment({ id: 'b3', blockId: 'block-3' }),
      ...Array.from({ length: 9 }, (_, i) => commitment({ id: `x${i}` })),
    ];

    return buildDay(OWNER, TODAY, NOW).then((day) => {
      expect(day.blocks).toHaveLength(3);
      expect(day.blocksDone).toBe(1);
      expect(day.alsoToday).toHaveLength(9);
    });
  });

  it('counts a block done only when it is done', async () => {
    store.commitments = [
      commitment({ id: 'b1', blockId: 'block-1', status: 'done' }),
      commitment({ id: 'b2', blockId: 'block-2', status: 'in-progress' }),
      commitment({ id: 'b3', blockId: 'block-3', status: 'abandoned' }),
    ];

    const day = await buildDay(OWNER, TODAY, NOW);

    // Abandoned is not kept. The ring is about blocks KEPT.
    expect(day.blocksDone).toBe(1);
  });

  it('keeps other commitments out of the ring entirely', async () => {
    store.commitments = [
      commitment({ id: 'x1', status: 'done' }),
      commitment({ id: 'x2', status: 'done' }),
    ];

    const day = await buildDay(OWNER, TODAY, NOW);

    expect(day.blocksDone).toBe(0);
    expect(day.blocks).toHaveLength(3);
  });

  it('has no blocks at all before a curriculum is imported', async () => {
    store.context = null;
    store.commitments = [commitment({ id: 'x1' })];

    const day = await buildDay(OWNER, TODAY, NOW);

    expect(day.blocks).toEqual([]);
    expect(day.noCurriculum).toBe(true);
  });
});

describe('the next action', () => {
  it('is an unanswered miss before anything else', async () => {
    /**
     * A miss sorts above everything else everywhere in this app. The next
     * action is the largest element on the page, and a cheerful "start Block
     * 2" there while a deadline sits unanswered would be the warm surface
     * softening an accountability one.
     */
    store.commitments = [
      commitment({ id: 'b1', blockId: 'block-1' }),
      commitment({ id: 'missed', title: 'Ship the report', needsReckoning: true, missed: true }),
    ];

    const day = await buildDay(OWNER, TODAY, NOW);

    expect(day.next?.commitmentId).toBe('missed');
    expect(day.next?.needsReckoning).toBe(true);
  });

  it('is the first open block when nothing is unanswered', async () => {
    store.commitments = [
      commitment({ id: 'b1', blockId: 'block-1', status: 'done' }),
      commitment({ id: 'b2', blockId: 'block-2' }),
      commitment({ id: 'x1' }),
    ];

    const day = await buildDay(OWNER, TODAY, NOW);

    expect(day.next?.commitmentId).toBe('b2');
    expect(day.next?.blockId).toBe('block-2');
  });

  it('falls through to other work when every block is closed', async () => {
    store.commitments = [
      commitment({ id: 'b1', blockId: 'block-1', status: 'done' }),
      commitment({ id: 'b2', blockId: 'block-2', status: 'done' }),
      commitment({ id: 'b3', blockId: 'block-3', status: 'abandoned' }),
      commitment({ id: 'x1', title: 'Call the bank' }),
    ];

    const day = await buildDay(OWNER, TODAY, NOW);

    expect(day.next?.commitmentId).toBe('x1');
  });

  it('is null when nothing is open', async () => {
    store.commitments = [
      commitment({ id: 'b1', blockId: 'block-1', status: 'done' }),
      commitment({ id: 'b2', blockId: 'block-2', status: 'done' }),
      commitment({ id: 'b3', blockId: 'block-3', status: 'done' }),
    ];

    const day = await buildDay(OWNER, TODAY, NOW);

    expect(day.next).toBeNull();
  });

  it('carries the block’s window and the topic’s own target', async () => {
    store.commitments = [
      commitment({
        id: 'b1',
        blockId: 'block-1',
        curriculumTopicKey: 'block-1/arrays/two-pointers/sorted',
      }),
    ];

    const day = await buildDay(OWNER, TODAY, NOW);

    expect(day.next?.window).toBe('07:00–08:00');
    expect(day.next?.outcome).toBe('5–8 problems');
  });
});

describe('splitTopicLabel', () => {
  it('keeps the heading short enough to set at display size', () => {
    /**
     * A plan-generated title runs to 96 characters. Set whole at 28px on a
     * 390px screen that is five lines, at which point the next action stops
     * looking like one thing to do.
     */
    const [heading, detail] = splitTopicLabel(
      'Frontend Engineering',
      'Interview Process · Clarify scope; model data; components; services; performance; security; a11y',
    );

    expect(heading).toBe('Frontend Engineering: Interview Process');
    expect(detail).toBe(
      'Clarify scope; model data; components; services; performance; security; a11y',
    );
  });

  it('has no detail when the topic has no sub-topic', () => {
    expect(splitTopicLabel('DSA', 'Arrays')).toEqual(['DSA: Arrays', null]);
  });

  it('falls back to the area when there is no topic', () => {
    expect(splitTopicLabel('DSA', null)).toEqual(['DSA', null]);
  });
});

describe('needs-reckoning', () => {
  it('is surfaced separately from the rest of the day', async () => {
    store.commitments = [
      commitment({ id: 'm1', needsReckoning: true }),
      commitment({ id: 'm2', needsReckoning: true }),
      commitment({ id: 'x1' }),
    ];

    const day = await buildDay(OWNER, TODAY, NOW);

    expect(day.needsReckoning.map((row) => row.id)).toEqual(['m1', 'm2']);
  });
});

describe('ahead of schedule', () => {
  it('is recognised when tomorrow’s block is already done', async () => {
    // Recognised as a message, never as a badge -- see docs/product.md,
    // Conflict 2. The service returns a boolean and the surface turns it into
    // one sentence.
    store.commitments = [commitment({ id: 'b1', blockId: 'block-1', status: 'done' })];

    const tomorrow = await buildDay(OWNER, '2026-09-08', NOW);

    expect(tomorrow.aheadOfSchedule).toBe(true);
  });

  it('is not claimed for today’s own work', async () => {
    store.commitments = [commitment({ id: 'b1', blockId: 'block-1', status: 'done' })];

    const day = await buildDay(OWNER, TODAY, NOW);

    expect(day.aheadOfSchedule).toBe(false);
  });

  it('is not claimed when nothing ahead is done', async () => {
    const tomorrow = await buildDay(OWNER, '2026-09-08', NOW);

    expect(tomorrow.aheadOfSchedule).toBe(false);
  });
});

describe('the greeting reflects the day being built', () => {
  it('greets tomorrow as the start of its window rather than as now', async () => {
    // Tomorrow has no "now". Greeting it at 8:30pm because that is when you
    // looked would describe a state it is not in.
    const tomorrow = await buildDay(OWNER, '2026-09-08', new Date('2026-09-07T15:00:00.000Z'));

    expect(tomorrow.greeting.bucket).toBe('window');
  });

  it('uses the real clock for today', async () => {
    const day = await buildDay(OWNER, TODAY, NOW);

    // 08:30 IST.
    expect(day.greeting.bucket).toBe('window');
  });
});

describe('the overdue count', () => {
  it('is a count, never a list', async () => {
    store.counts = { total: 44, needsReckoning: 34 };

    const day = await buildDay(OWNER, TODAY, NOW);

    expect(day.overdue).toEqual({ total: 44, needsReckoning: 34 });
    // No array of overdue rows anywhere on the view.
    expect(Object.keys(day)).not.toContain('overdueList');
  });
});

describe('stakes evaluation', () => {
  it('runs when today is being read', async () => {
    await buildDay(OWNER, TODAY, NOW);

    expect(store.evaluated).toBe(1);
  });

  it('does NOT run when tomorrow is', async () => {
    /**
     * Looking ahead must not activate a consequence. Evaluation is a side
     * effect of living through a day, not of previewing one.
     */
    await buildDay(OWNER, '2026-09-08', NOW);

    expect(store.evaluated).toBe(0);
  });
});
