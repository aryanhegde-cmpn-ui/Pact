import { describe, expect, it } from 'vitest';

import type { TopicStatus } from '@/lib/schemas/curriculum';

import { computeDrift, phaseOn, topicsInPhase, type DriftTopic, type PhaseWindow } from './drift';

/** Phase 1 of the real plan: Sep 7 to Sep 30, JS + DSA + Machine Coding. */
const PHASE_1: PhaseWindow = {
  number: 1,
  startDate: '2026-09-07',
  endDate: '2026-09-30',
  focusCategories: ['JS', 'DSA', 'Machine Coding'],
  focusModules: [],
};

function topics(
  spec: [key: string, priority: 'P0' | 'P1' | 'P2', category: string][],
): DriftTopic[] {
  return spec.map(([stableKey, priority, category]) => ({
    stableKey,
    priority,
    category,
    module: 'Module',
  }));
}

const TEN_P0 = topics(
  Array.from({ length: 10 }, (_, i) => [`p0-${i}`, 'P0', 'JS'] as [string, 'P0', string]),
);

function progress(done: string[], other: Record<string, TopicStatus> = {}) {
  return new Map<string, TopicStatus>([
    ...done.map((key) => [key, 'done'] as [string, TopicStatus]),
    ...Object.entries(other),
  ]);
}

describe('elapsed vs done', () => {
  it('is on track when the proportions match', () => {
    // Day 12 of 24 is half the phase; 5 of 10 P0 topics is half the material.
    const drift = computeDrift(
      PHASE_1,
      TEN_P0,
      progress(['p0-0', 'p0-1', 'p0-2', 'p0-3', 'p0-4']),
      '2026-09-18',
    );

    expect(drift.elapsedFraction).toBeCloseTo(0.5);
    expect(drift.doneFraction).toBe(0.5);
    expect(drift.status).toBe('on-track');
    expect(drift.topicsBehind).toBe(0);
  });

  it('is behind when the calendar has moved further than the work', () => {
    const drift = computeDrift(PHASE_1, TEN_P0, progress(['p0-0']), '2026-09-18');

    expect(drift.status).toBe('behind');
    expect(drift.drift).toBeLessThan(0);
    // Half the phase gone, one of ten done: four more should have been.
    expect(drift.topicsBehind).toBe(4);
  });

  it('recognises being ahead, not just being behind', () => {
    const drift = computeDrift(
      PHASE_1,
      TEN_P0,
      progress(['p0-0', 'p0-1', 'p0-2', 'p0-3', 'p0-4', 'p0-5', 'p0-6', 'p0-7']),
      '2026-09-18',
    );

    expect(drift.status).toBe('ahead');
    expect(drift.topicsBehind).toBe(0);
  });

  it('says nothing on the first morning of a phase', () => {
    // A phase that starts today is not 100% behind, and telling the user it is
    // on day one is how a warning stops meaning anything.
    const drift = computeDrift(PHASE_1, TEN_P0, progress([]), '2026-09-07');

    expect(drift.status).not.toBe('behind');
  });

  it('counts both ends of the phase, so day one is not already late', () => {
    const drift = computeDrift(PHASE_1, TEN_P0, progress([]), '2026-09-07');

    // 1 of 24 days, not 0 of 23.
    expect(drift.elapsedFraction).toBeCloseTo(1 / 24, 5);
  });

  it('has a tolerance band, so an ordinary Tuesday is not an alarm', () => {
    // 12 of 24 days elapsed, 5 of 10 done is exact; 5 of 10 at day 13 is 4%
    // behind and must not fire.
    const drift = computeDrift(
      PHASE_1,
      TEN_P0,
      progress(['p0-0', 'p0-1', 'p0-2', 'p0-3', 'p0-4']),
      '2026-09-19',
    );

    expect(drift.status).toBe('on-track');
  });
});

describe('what counts', () => {
  it('measures P0 only', () => {
    const mixed = [
      ...topics([
        ['p0-a', 'P0', 'JS'],
        ['p0-b', 'P0', 'JS'],
      ]),
      ...topics([
        ['p2-a', 'P2', 'JS'],
        ['p2-b', 'P2', 'JS'],
        ['p2-c', 'P2', 'JS'],
      ]),
    ];

    // Every optional row done, neither must-master row: the plan says behind.
    const drift = computeDrift(PHASE_1, mixed, progress(['p2-a', 'p2-b', 'p2-c']), '2026-09-25');

    expect(drift.p0Total).toBe(2);
    expect(drift.p0Done).toBe(0);
    expect(drift.status).toBe('behind');
  });

  it('does not count needs-revision as done', () => {
    // It is the status meaning "finished badly". Counting it would make the
    // number agree with the most optimistic reading of the user's own work.
    const drift = computeDrift(
      PHASE_1,
      TEN_P0,
      progress([], { 'p0-0': 'needs-revision', 'p0-1': 'needs-revision', 'p0-2': 'in-progress' }),
      '2026-09-18',
    );

    expect(drift.p0Done).toBe(0);
    expect(drift.status).toBe('behind');
  });

  it('measures only the phase’s own material', () => {
    const mixed = topics([
      ['js-1', 'P0', 'JS'],
      ['sd-1', 'P0', 'System Design'],
      ['sd-2', 'P0', 'System Design'],
    ]);

    // System Design is not in phase 1's focus, so two untouched System Design
    // rows are not phase 1 being behind.
    const drift = computeDrift(PHASE_1, mixed, progress(['js-1']), '2026-09-18');

    expect(drift.p0Total).toBe(1);
    expect(drift.doneFraction).toBe(1);
    expect(drift.status).toBe('ahead');
  });

  it('gives an unfocused phase no material rather than all of it', () => {
    const all = topics([
      ['a', 'P0', 'JS'],
      ['b', 'P0', 'System Design'],
    ]);

    // "Applications + interviews" itemises nothing. Measuring it against the
    // whole curriculum would report every topic as outstanding in January.
    expect(topicsInPhase(all, { focusCategories: [], focusModules: [] })).toEqual([]);
  });

  it('says there is nothing to measure rather than reporting a false gap', () => {
    const drift = computeDrift(
      { ...PHASE_1, focusCategories: [], focusModules: [] },
      TEN_P0,
      progress([]),
      '2026-09-25',
    );

    expect(drift.p0Total).toBe(0);
    expect(drift.status).toBe('on-track');
    expect(drift.topicsBehind).toBe(0);
  });
});

describe('it never re-flows', () => {
  it('returns a number and changes nothing', () => {
    const phase = { ...PHASE_1 };
    const before = JSON.stringify(phase);

    computeDrift(phase, TEN_P0, progress([]), '2026-09-29');

    // The phase dates are the schedule. Being behind does not move them; only
    // an explicit re-plan does, and that records an event with a reason.
    expect(JSON.stringify(phase)).toBe(before);
  });

  it('reports the days that are actually left, not the days needed', () => {
    const drift = computeDrift(PHASE_1, TEN_P0, progress([]), '2026-09-28');

    expect(drift.daysRemaining).toBe(2);
    expect(drift.status).toBe('behind');
  });
});

describe('phaseOn', () => {
  const PHASES = [
    { number: 1, startDate: '2026-09-07', endDate: '2026-09-30' },
    { number: 2, startDate: '2026-10-01', endDate: '2026-10-31' },
  ];

  it('finds the phase containing a date, both ends inclusive', () => {
    expect(phaseOn(PHASES, '2026-09-07')?.number).toBe(1);
    expect(phaseOn(PHASES, '2026-09-30')?.number).toBe(1);
    expect(phaseOn(PHASES, '2026-10-01')?.number).toBe(2);
  });

  it('returns null outside the plan rather than clamping to an end', () => {
    // Before the plan starts there is no phase, and pretending there is one
    // would report drift against a phase that has not begun.
    expect(phaseOn(PHASES, '2026-09-01')).toBeNull();
    expect(phaseOn(PHASES, '2027-02-01')).toBeNull();
  });
});
