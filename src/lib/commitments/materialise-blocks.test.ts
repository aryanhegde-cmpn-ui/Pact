import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlanContext } from '@/lib/curriculum/plan';
import { fakeCollection } from '@/test/fake-collection';

/**
 * A study block is an ordinary Series.
 *
 * This is the wiring test for that claim: the same materialiser, the same
 * unique index, the same events and the same queue -- with a title that names
 * the day's topic instead of repeating the block's name 150 times.
 */
const store = vi.hoisted(() => ({
  series: [] as Record<string, unknown>[],
  commitments: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  enqueued: [] as Record<string, unknown>[],
  planLoads: 0,
}));

const plan = vi.hoisted(() => ({ context: null as unknown }));

vi.mock('@/lib/db/models/series', () => ({
  SeriesModel: { find: () => ({ lean: async () => store.series }) },
}));
vi.mock('@/lib/db/models/commitment', () => ({
  CommitmentModel: fakeCollection(store.commitments, {
    uniqueBy: ['seriesId', 'occurrenceDate'],
  }),
}));
vi.mock('@/lib/db/events', () => ({
  appendEvents: async (events: Record<string, unknown>[]) => {
    store.events.push(...events);
    return { appended: events.length, duplicates: 0 };
  },
}));
vi.mock('@/lib/notifications/settings', () => ({ getSettings: async () => ({}) }));
vi.mock('@/lib/notifications/queue', () => ({
  enqueueForCommitments: async (commitments: Record<string, unknown>[]) => {
    store.enqueued.push(...commitments);
    return { created: commitments.length, revived: 0, duplicates: 0 };
  },
}));
vi.mock('@/lib/curriculum/plan', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/curriculum/plan')>();

  return {
    ...original,
    // The real planForBlock runs; only the read is replaced.
    loadPlanContext: async () => {
      store.planLoads += 1;
      return plan.context;
    },
  };
});

const { materialiseRange } = await import('./materialise');

const OWNER = 'owner-1';
const TZ = 'Asia/Kolkata';

const CONTEXT: PlanContext = {
  blocks: [
    {
      blockId: 'block-2',
      area: 'Frontend Engineering',
      exactActivity: 'Hands-on build',
      durationMinutes: 90,
      startTime: '08:00',
      endTime: '09:30',
    },
  ],
  phases: [
    {
      number: 1,
      startDate: '2026-09-07',
      endDate: '2026-09-30',
      focusCategories: ['Machine Coding', 'React'],
      focusModules: [],
      revisionOnly: false,
      revisionBias: false,
    },
  ],
  topics: [
    {
      stableKey: 'block-2/ui/modal/focus-trap',
      blockId: 'block-2',
      category: 'Machine Coding',
      module: 'UI Components',
      topic: 'Modal',
      subTopic: 'Focus trap',
      priority: 'P0',
      order: 35,
      practiceRaw: '45–60 min build',
    },
    {
      stableKey: 'block-2/testing/jest-rtl/unit',
      blockId: 'block-2',
      category: 'React',
      module: 'Testing',
      topic: 'Jest / RTL',
      subTopic: 'Unit vs integration',
      priority: 'P0',
      order: 32,
      practiceRaw: 'Test one machine-coded component',
    },
  ],
  progress: new Map(),
  carriedOver: new Map(),
};

function blockSeries() {
  return {
    _id: 's1',
    ownerId: OWNER,
    title: 'Frontend Engineering',
    outcome: 'Hands-on build',
    blockId: 'block-2',
    rule: {
      frequency: 'daily',
      interval: 1,
      byWeekday: [],
      timeOfDay: '09:30',
      estimateMinutes: 90,
    },
    priority: 'important',
    startDate: '2026-09-07',
    endDate: '2026-09-07',
    status: 'active',
  };
}

beforeEach(() => {
  store.series = [];
  // Emptied in place: the fake holds a reference to this array.
  store.commitments.length = 0;
  store.events = [];
  store.enqueued = [];
  store.planLoads = 0;
  plan.context = CONTEXT;
});

describe('a study block materialises like any other series', () => {
  it('names the day’s topic instead of repeating the block’s name', async () => {
    store.series = [blockSeries()];

    // 2026-09-07 is a Monday: the rhythm's frontend cell is machine coding.
    await materialiseRange('2026-09-07', '2026-09-07', TZ, OWNER, new Date('2026-09-07T00:00:00Z'));

    expect(store.commitments[0]).toMatchObject({
      title: 'Frontend Engineering: Modal · Focus trap',
      // The topic's practice instruction, which is already specific enough to
      // skip the manual creation guardrails.
      outcome: '45–60 min build',
      // The BLOCK's length, not the topic's: the practice target is the size
      // of the output, and a plan that under-reports its own cost is the plan
      // you fall behind on without seeing why.
      estimateMinutes: 90,
      priority: 'must-win',
      blockId: 'block-2',
      curriculumTopicKey: 'block-2/ui/modal/focus-trap',
    });
  });

  it('picks a different topic on a day with a different slant', async () => {
    // 2026-09-10 is a Thursday: React and testing.
    store.series = [{ ...blockSeries(), startDate: '2026-09-10', endDate: '2026-09-10' }];

    await materialiseRange('2026-09-10', '2026-09-10', TZ, OWNER, new Date('2026-09-10T00:00:00Z'));

    expect(store.commitments[0]?.curriculumTopicKey).toBe('block-2/testing/jest-rtl/unit');
  });

  it('resolves the topic per DAY, not once for the whole lookahead', async () => {
    // A fortnight materialised with today's answer would name the same topic
    // fourteen times, and the weekly rhythm would be decorative.
    store.series = [{ ...blockSeries(), endDate: '2026-09-10' }];

    await materialiseRange('2026-09-07', '2026-09-10', TZ, OWNER, new Date('2026-09-07T00:00:00Z'));

    const keys = store.commitments.map((row) => row.curriculumTopicKey);
    expect(new Set(keys).size).toBeGreaterThan(1);
  });

  it('goes through the same events and the same queue', async () => {
    store.series = [blockSeries()];

    await materialiseRange('2026-09-07', '2026-09-07', TZ, OWNER, new Date('2026-09-07T00:00:00Z'));

    expect(store.events.map((event) => event.type)).toEqual(['COMMITMENT_CREATED', 'DEADLINE_SET']);
    expect(store.enqueued[0]).toMatchObject({ title: 'Frontend Engineering: Modal · Focus trap' });
  });

  it('records why the topic was chosen', async () => {
    store.series = [blockSeries()];

    await materialiseRange('2026-09-07', '2026-09-07', TZ, OWNER, new Date('2026-09-07T00:00:00Z'));

    // So a suggestion the user disagrees with can be argued with rather than
    // guessed at.
    expect(store.events[0]?.payload).toMatchObject({
      blockId: 'block-2',
      curriculumTopicKey: 'block-2/ui/modal/focus-trap',
    });
    expect(
      (store.events[0]?.payload as { suggestionReasons: string[] }).suggestionReasons.length,
    ).toBeGreaterThan(0);
  });
});

describe('without a curriculum', () => {
  it('behaves as an ordinary daily series', async () => {
    // Every installation starts here, and a study block with no imported
    // workbook must be correct rather than broken.
    plan.context = null;
    store.series = [blockSeries()];

    await materialiseRange('2026-09-07', '2026-09-07', TZ, OWNER, new Date('2026-09-07T00:00:00Z'));

    expect(store.commitments[0]).toMatchObject({
      title: 'Frontend Engineering',
      outcome: 'Hands-on build',
      estimateMinutes: 90,
      priority: 'important',
      curriculumTopicKey: null,
    });
  });

  it('does not read the curriculum at all when no series is a block', async () => {
    // An installation with no curriculum must pay nothing for one.
    store.series = [{ ...blockSeries(), blockId: null }];

    await materialiseRange('2026-09-07', '2026-09-07', TZ, OWNER, new Date('2026-09-07T00:00:00Z'));

    expect(store.planLoads).toBe(0);
  });

  it('reads it once for the whole pass, not once per occurrence', async () => {
    store.series = [{ ...blockSeries(), endDate: '2026-09-30' }];

    await materialiseRange('2026-09-07', '2026-09-20', TZ, OWNER, new Date('2026-09-07T00:00:00Z'));

    expect(store.commitments.length).toBeGreaterThan(10);
    expect(store.planLoads).toBe(1);
  });
});
