import { describe, expect, it } from 'vitest';

import { eveningPlan, type MorningBlock } from './evening';

function morning(statuses: string[]): MorningBlock[] {
  return statuses.map((status, i) => ({
    blockId: `block-${i + 1}`,
    area: ['DSA', 'Frontend Engineering', 'System Design'][i] ?? 'Area',
    commitmentId: `c${i + 1}`,
    title: 'Something specific',
    status,
  }));
}

const WEAK = [{ stableKey: 'k/js/closures', label: 'Closures', status: 'needs-revision' as const }];

describe('when the morning was completed', () => {
  it('leaves the evening empty and names recovery as the priority', () => {
    const evening = eveningPlan({ morning: morning(['done', 'done', 'done']), weakTopics: WEAK });

    expect(evening.recoveryOnly).toBe(true);
    expect(evening.options).toEqual([]);
    expect(evening.reason).toMatch(/priority/i);
  });

  it('offers nothing even when weak topics exist', () => {
    // The tempting case. A day where everything closed is exactly the day the
    // sheet says to stop, and a "bonus revision" here is the generator
    // deciding it knows better than the person who has to sleep.
    const evening = eveningPlan({
      morning: morning(['done', 'done', 'done']),
      weakTopics: [
        ...WEAK,
        { stableKey: 'k/react/memo', label: 'memo', status: 'needs-revision' as const },
      ],
    });

    expect(evening.options).toEqual([]);
  });

  it('treats an abandoned block as closed', () => {
    const evening = eveningPlan({
      morning: morning(['done', 'abandoned', 'done']),
      weakTopics: [],
    });

    expect(evening.recoveryOnly).toBe(true);
  });
});

describe('when a block did not close', () => {
  it('offers to finish that block, and names it', () => {
    const evening = eveningPlan({
      morning: morning(['done', 'pending', 'done']),
      weakTopics: [],
    });

    expect(evening.recoveryOnly).toBe(false);
    expect(evening.options).toEqual([
      {
        kind: 'finish',
        commitmentId: 'c2',
        label: 'Finish Frontend Engineering: Something specific',
      },
    ]);
  });

  it('points at the EXISTING commitment rather than making a new one', () => {
    // The morning work already is a commitment with its own deadline and its
    // own miss. A second row for the same work would double-count it in every
    // reading of the record.
    const evening = eveningPlan({ morning: morning(['in-progress']), weakTopics: [] });

    expect(evening.options[0]?.commitmentId).toBe('c1');
  });

  it('also offers revising a weak topic, as the sheet’s second option', () => {
    const evening = eveningPlan({
      morning: morning(['pending', 'done', 'done']),
      weakTopics: WEAK,
    });

    expect(evening.options.map((o) => o.kind)).toEqual(['finish', 'revise']);
    expect(evening.options[1]?.stableKey).toBe('k/js/closures');
  });

  it('never offers new material', () => {
    const evening = eveningPlan({
      morning: morning(['pending', 'pending', 'pending']),
      weakTopics: [
        { stableKey: 'k/new', label: 'Something new', status: 'not-started' },
        { stableKey: 'k/started', label: 'Half done', status: 'in-progress' },
      ],
    });

    // Only the three unfinished blocks. Nothing not-started, nothing in
    // progress that was not this morning's work.
    expect(evening.options.every((o) => o.kind === 'finish')).toBe(true);
  });

  it('caps itself out loud', () => {
    const evening = eveningPlan({ morning: morning(['pending']), weakTopics: [] });

    expect(evening.reason).toMatch(/30–60 minutes/);
  });
});

describe('a day with no morning at all', () => {
  it('does not claim the morning was completed', () => {
    // No blocks generated yet is not the same fact as three blocks finished,
    // and a "well done, go and rest" on a day nothing was planned is a lie.
    const evening = eveningPlan({ morning: [], weakTopics: WEAK });

    expect(evening.recoveryOnly).toBe(false);
    expect(evening.options.map((o) => o.kind)).toEqual(['revise']);
  });
});
