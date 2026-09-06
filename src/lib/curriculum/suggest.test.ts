import { describe, expect, it } from 'vitest';

import type { TopicStatus } from '@/lib/schemas/curriculum';

import { rhythmFor, slantFor } from './rhythm';
import { commitmentTitle, suggestTopic, type SuggestableTopic } from './suggest';

/** Real Block 2 rows from the workbook, in sheet order. */
const BLOCK_2: SuggestableTopic[] = [
  {
    stableKey: 'k/js/scope',
    category: 'JS',
    module: 'Language Core',
    topic: 'Scope & Hoisting',
    subTopic: 'var/let/const',
    priority: 'P0',
    order: 16,
  },
  {
    stableKey: 'k/js/browser-dom',
    category: 'JS',
    module: 'Browser',
    topic: 'DOM & Events',
    subTopic: 'Propagation',
    priority: 'P0',
    order: 22,
  },
  {
    stableKey: 'k/react/testing',
    category: 'React',
    module: 'Testing',
    topic: 'Jest / RTL',
    subTopic: 'Unit vs integration',
    priority: 'P0',
    order: 32,
  },
  {
    stableKey: 'k/mc/modal',
    category: 'Machine Coding',
    module: 'UI Components',
    topic: 'Modal',
    subTopic: 'Focus trap',
    priority: 'P0',
    order: 35,
  },
  {
    stableKey: 'k/mc/file-explorer',
    category: 'Machine Coding',
    module: 'Navigation',
    topic: 'File Explorer',
    subTopic: 'Tree state',
    priority: 'P1',
    order: 41,
  },
  {
    stableKey: 'k/supporting/docker',
    category: 'Supporting',
    module: 'DevOps',
    topic: 'Docker Basics',
    subTopic: 'Images',
    priority: 'P2',
    order: 54,
  },
];

const PHASE_1 = {
  focusCategories: ['JS', 'DSA', 'Machine Coding'],
  focusModules: [],
  revisionOnly: false,
  revisionBias: false,
};

function progress(entries: Record<string, TopicStatus>): Map<string, TopicStatus> {
  return new Map(Object.entries(entries));
}

/** 2026-09-07 is a Monday; 2026-09-13 is the following Sunday. */
const MONDAY = '2026-09-07';
const THURSDAY = '2026-09-10';
const SUNDAY = '2026-09-13';

describe('the sheet dates line up with the weekly rhythm', () => {
  it('reads Monday as machine coding and Sunday as review', () => {
    expect(rhythmFor(MONDAY).label).toBe('Mon');
    expect(slantFor(MONDAY, 'block-2')).toBe('Machine coding');
    expect(rhythmFor(SUNDAY).label).toBe('Sun');
    expect(slantFor(SUNDAY, 'block-2')).toBe('Weak-area review');
  });
});

describe('the day slant', () => {
  it('picks machine coding on Monday, over an equally P0 JS topic earlier in the sheet', () => {
    const { choice } = suggestTopic({
      topics: BLOCK_2,
      progress: progress({}),
      slant: slantFor(MONDAY, 'block-2'),
      phase: PHASE_1,
      date: MONDAY,
    });

    expect(choice?.topic.stableKey).toBe('k/mc/modal');
    expect(choice?.reasons).toContain('today’s slant is Machine coding');
  });

  it('picks React and testing on Thursday', () => {
    const { choice } = suggestTopic({
      topics: BLOCK_2,
      progress: progress({}),
      slant: slantFor(THURSDAY, 'block-2'),
      // Phase 2, where React is in focus.
      phase: { ...PHASE_1, focusCategories: ['Machine Coding', 'React'] },
      date: THURSDAY,
    });

    expect(choice?.topic.stableKey).toBe('k/react/testing');
  });
});

describe('the phase focus', () => {
  it('outranks the day slant when the two disagree', () => {
    // Sunday has no category in its slant, so phase focus is what is left --
    // and a Supporting P2 must not win over an in-focus P0.
    const { choice } = suggestTopic({
      topics: BLOCK_2,
      progress: progress({}),
      slant: '',
      phase: PHASE_1,
      date: MONDAY,
    });

    expect(choice?.topic.category).toBe('JS');
    expect(choice?.reasons).toContain('in this phase’s focus');
  });

  it('falls back to the block order when nothing is in focus', () => {
    // "Applications + interviews" itemises no topics. That is not an error and
    // must not produce an empty morning.
    const { choice } = suggestTopic({
      topics: BLOCK_2,
      progress: progress({}),
      slant: '',
      phase: { focusCategories: [], focusModules: [], revisionOnly: false, revisionBias: false },
      date: MONDAY,
    });

    expect(choice?.topic.stableKey).toBe('k/js/scope');
  });
});

describe('priority and progress', () => {
  it('puts P0 ahead of P1 and P2 within the same slant', () => {
    const { choice } = suggestTopic({
      topics: BLOCK_2,
      progress: progress({ 'k/mc/modal': 'done' }),
      slant: 'Machine coding',
      phase: PHASE_1,
      date: MONDAY,
    });

    // The remaining machine-coding topic, even though it is only P1.
    expect(choice?.topic.stableKey).toBe('k/mc/file-explorer');
  });

  it('never suggests a topic already done', () => {
    const done = Object.fromEntries(BLOCK_2.map((t) => [t.stableKey, 'done' as TopicStatus]));

    const suggestion = suggestTopic({
      topics: BLOCK_2,
      progress: progress(done),
      slant: 'Machine coding',
      phase: PHASE_1,
      date: MONDAY,
    });

    expect(suggestion.choice).toBeNull();
    expect(suggestion.exhausted).toBe(true);
  });

  it('prefers finishing something already started', () => {
    const { choice } = suggestTopic({
      topics: BLOCK_2,
      progress: progress({ 'k/mc/file-explorer': 'in-progress' }),
      slant: 'Machine coding',
      // No phase focus, so priority then started-ness decides.
      phase: null,
      date: MONDAY,
    });

    // Modal is P0 and File Explorer is P1, so priority still wins -- started
    // is a tie-breaker beneath it, not a trump card.
    expect(choice?.topic.stableKey).toBe('k/mc/modal');

    const withoutModal = suggestTopic({
      topics: BLOCK_2.filter((t) => t.stableKey !== 'k/mc/modal'),
      progress: progress({ 'k/mc/file-explorer': 'in-progress' }),
      slant: 'Machine coding',
      phase: null,
      date: MONDAY,
    });

    expect(withoutModal.choice?.reasons).toContain('already started');
  });
});

describe('revision', () => {
  it('prefers a needs-revision topic on Sunday', () => {
    const { choice } = suggestTopic({
      topics: BLOCK_2,
      progress: progress({ 'k/supporting/docker': 'needs-revision' }),
      slant: slantFor(SUNDAY, 'block-2'),
      phase: PHASE_1,
      date: SUNDAY,
    });

    // A P2 Supporting topic, outside the phase focus, still wins -- that is
    // what the Sunday row of the rhythm is for.
    expect(choice?.topic.stableKey).toBe('k/supporting/docker');
    expect(choice?.reasons[0]).toMatch(/marked for revision/);
  });

  it('does not prefer it on a Monday', () => {
    const { choice } = suggestTopic({
      topics: BLOCK_2,
      progress: progress({ 'k/supporting/docker': 'needs-revision' }),
      slant: slantFor(MONDAY, 'block-2'),
      phase: PHASE_1,
      date: MONDAY,
    });

    expect(choice?.topic.stableKey).toBe('k/mc/modal');
  });

  it('studies only gaps in a revision-only phase', () => {
    const { choice, alternatives } = suggestTopic({
      topics: BLOCK_2,
      progress: progress({ 'k/js/browser-dom': 'needs-revision' }),
      slant: 'Machine coding',
      phase: { ...PHASE_1, revisionOnly: true },
      date: MONDAY,
    });

    expect(choice?.topic.stableKey).toBe('k/js/browser-dom');
    // Nothing else is offered: new material is not on the menu in that phase.
    expect(alternatives).toEqual([]);
  });

  it('falls back to ordinary candidates when a revision-only phase has no gaps', () => {
    // An empty morning would be worse than a suggestion the phase did not ask
    // for, and the user can always override.
    const { choice } = suggestTopic({
      topics: BLOCK_2,
      progress: progress({}),
      slant: 'Machine coding',
      phase: { ...PHASE_1, revisionOnly: true },
      date: MONDAY,
    });

    expect(choice).not.toBeNull();
  });
});

describe('the suggestion is never a lock', () => {
  it('offers every other candidate as an alternative', () => {
    const suggestion = suggestTopic({
      topics: BLOCK_2,
      progress: progress({}),
      slant: 'Machine coding',
      phase: PHASE_1,
      date: MONDAY,
    });

    expect(suggestion.alternatives).toHaveLength(BLOCK_2.length - 1);
  });

  it('explains itself', () => {
    const suggestion = suggestTopic({
      topics: BLOCK_2,
      progress: progress({}),
      slant: 'Machine coding',
      phase: PHASE_1,
      date: MONDAY,
    });

    expect(suggestion.choice?.reasons.length).toBeGreaterThan(0);
  });
});

describe('commitmentTitle', () => {
  it('names the topic, so a day in the history is distinguishable', () => {
    expect(commitmentTitle('Frontend Engineering', BLOCK_2[3]!)).toBe(
      'Frontend Engineering: Modal · Focus trap',
    );
  });

  it('falls back to the block area when there is no topic', () => {
    expect(commitmentTitle('DSA', null)).toBe('DSA');
  });
});

describe('a topic that ran out of time yesterday', () => {
  /**
   * `more-time` is the clearest possible statement that the work continues.
   * A block that picks up new material the next morning instead is how a plan
   * produces a trail of half-done topics -- and it would make "I need more
   * time" cost the user something, which is exactly what stops them saying it.
   */
  it('is preferred over the day’s slant and the phase focus', () => {
    const { choice } = suggestTopic({
      topics: BLOCK_2,
      progress: progress({ 'k/supporting/docker': 'in-progress' }),
      // Monday says machine coding; the phase says JS and Machine Coding.
      slant: slantFor(MONDAY, 'block-2'),
      phase: PHASE_1,
      date: MONDAY,
      carriedOver: 'k/supporting/docker',
    });

    // A P2 Supporting topic, off-slant and outside the phase focus, still wins.
    expect(choice?.topic.stableKey).toBe('k/supporting/docker');
    expect(choice?.reasons[0]).toMatch(/ran out of time/);
  });

  it('changes nothing when there is no carry-over', () => {
    const { choice } = suggestTopic({
      topics: BLOCK_2,
      progress: progress({}),
      slant: slantFor(MONDAY, 'block-2'),
      phase: PHASE_1,
      date: MONDAY,
      carriedOver: null,
    });

    expect(choice?.topic.stableKey).toBe('k/mc/modal');
  });

  it('is not preferred once the topic is done', () => {
    // Finished after the session that ran out of time. Nothing to carry.
    const { choice } = suggestTopic({
      topics: BLOCK_2,
      progress: progress({ 'k/supporting/docker': 'done' }),
      slant: slantFor(MONDAY, 'block-2'),
      phase: PHASE_1,
      date: MONDAY,
      carriedOver: 'k/supporting/docker',
    });

    expect(choice?.topic.stableKey).toBe('k/mc/modal');
  });
});
