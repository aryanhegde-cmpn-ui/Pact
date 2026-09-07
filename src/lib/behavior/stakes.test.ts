import { describe, expect, it } from 'vitest';

import {
  MAX_CONSEQUENCE_WINDOW_DAYS,
  createConsequenceSchema,
  type DischargeCondition,
} from '@/lib/schemas/stakes';

import {
  adherenceOver,
  consequenceIsTriggered,
  evaluateStakes,
  expiryFor,
  isDischarged,
  isExpired,
  MINIMUM_WINDOW_DAYS,
  rewardIsEarned,
  type ActiveConsequence,
  type DayRecord,
  type EvaluateAllInput,
} from './stakes';

function days(spec: { done: number; total: number; vacation?: boolean }[]): DayRecord[] {
  return spec.map((entry, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, '0')}`,
    blocksDone: entry.done,
    blocksTotal: entry.total,
    onVacation: entry.vacation ?? false,
  }));
}

const kept = { done: 3, total: 3 };
const missed = { done: 1, total: 3 };
const empty = { done: 0, total: 0 };

describe('adherence is a rate over a window', () => {
  it('counts a day kept only when every block was kept', () => {
    const window = adherenceOver(days([kept, kept, missed, kept, kept, kept]));

    expect(window).toMatchObject({ kept: 5, of: 6 });
    expect(window.rate).toBeCloseTo(5 / 6);
  });

  it('leaves a day with nothing scheduled out of the denominator', () => {
    // Counting it as kept would let an empty week read as perfect adherence.
    const window = adherenceOver(days([kept, empty, kept, kept, kept, kept]));

    expect(window.of).toBe(5);
    expect(window.rate).toBe(1);
  });

  it('never reports a consecutive run', () => {
    /**
     * The whole point. A streak has a cliff -- miss one day at forty and it
     * reads zero -- and gating real-world stakes on a number that collapses
     * for one bad Tuesday is how someone abandons the arrangement rather than
     * the habit.
     */
    const window = adherenceOver(days([kept, kept, missed, kept, kept, kept]));

    expect(Object.keys(window)).toEqual(['kept', 'of', 'rate', 'vacationDays', 'sparse']);
    // Three kept in a row at the end, but the number reported is the rate.
    expect(window.rate).toBeCloseTo(5 / 6);
  });

  it('refuses to act on too little evidence', () => {
    // One kept day out of one is a rate of 1.0. Real stakes should not turn on
    // a single Tuesday.
    const window = adherenceOver(days([kept, kept]));

    expect(window.rate).toBe(1);
    expect(window.sparse).toBe(true);
    expect(MINIMUM_WINDOW_DAYS).toBeGreaterThan(2);
  });
});

describe('vacation days leave the denominator', () => {
  it('does not count them as misses', () => {
    /**
     * The difference between a pause and a lie. Counting them as missed makes
     * the pressure valve cost something, and a valve that costs something is
     * one nobody pulls.
     */
    const window = adherenceOver(
      days([kept, kept, kept, kept, kept, { done: 0, total: 3, vacation: true }]),
    );

    expect(window.of).toBe(5);
    expect(window.rate).toBe(1);
    expect(window.vacationDays).toBe(1);
  });

  it('does not count them as kept either', () => {
    // Counting them as kept would flatter the record, which is the other half
    // of the same lie.
    const window = adherenceOver(
      days([kept, missed, kept, kept, kept, { done: 3, total: 3, vacation: true }]),
    );

    expect(window.kept).toBe(4);
    expect(window.of).toBe(5);
  });

  it('reports how many were excluded, so the exclusion is visible', () => {
    const window = adherenceOver(
      days([kept, { done: 0, total: 3, vacation: true }, { done: 0, total: 3, vacation: true }]),
    );

    expect(window.vacationDays).toBe(2);
  });
});

const RULE = {
  id: 'r1',
  name: 'A thing',
  trigger: 'adherence-threshold' as const,
  triggerConfig: { thresholdRate: 0.7 },
};

const HEALTHY = adherenceOver(days(Array.from({ length: 10 }, () => kept)));
const POOR = adherenceOver(days(Array.from({ length: 10 }, () => missed)));

describe('triggers', () => {
  it('earns a reward at or above the threshold', () => {
    expect(rewardIsEarned(RULE, { adherence: HEALTHY, topicsDone: 0, onVacation: false })).toBe(
      true,
    );
  });

  it('fires a consequence below it', () => {
    expect(
      consequenceIsTriggered(RULE, { adherence: POOR, topicsDone: 0, onVacation: false }),
    ).toBe(true);
  });

  it('does neither on too little evidence', () => {
    const sparse = adherenceOver(days([kept, kept]));

    expect(rewardIsEarned(RULE, { adherence: sparse, topicsDone: 0, onVacation: false })).toBe(
      false,
    );
    expect(
      consequenceIsTriggered(RULE, { adherence: sparse, topicsDone: 0, onVacation: false }),
    ).toBe(false);
  });

  it('never earns a manual-grant reward by evaluation', () => {
    // It is the overseer's decision with no rule. Evaluation must not be able
    // to award it on their behalf.
    const manual = { ...RULE, trigger: 'manual-grant' as const, triggerConfig: {} };

    expect(rewardIsEarned(manual, { adherence: HEALTHY, topicsDone: 0, onVacation: false })).toBe(
      false,
    );
  });

  it('evaluates nothing at all while on vacation', () => {
    expect(rewardIsEarned(RULE, { adherence: HEALTHY, topicsDone: 0, onVacation: true })).toBe(
      false,
    );
    expect(consequenceIsTriggered(RULE, { adherence: POOR, topicsDone: 0, onVacation: true })).toBe(
      false,
    );
  });
});

describe('the bounded window', () => {
  const valid = {
    name: 'No cinema',
    description: 'Nothing at the cinema until it is put right.',
    trigger: 'adherence-threshold' as const,
    triggerConfig: { thresholdRate: 0.7 },
    dischargeCondition: { kind: 'adherence-recovered' as const, thresholdRate: 0.7 },
  };

  it('is one constant, and it is a week', () => {
    expect(MAX_CONSEQUENCE_WINDOW_DAYS).toBe(7);
  });

  it('is enforced at config time, not by the form', () => {
    /**
     * docs/product.md requires the cap in config rather than left to the
     * overseer's discretion. A consequence that outlives its motivating force
     * becomes background resentment.
     */
    expect(createConsequenceSchema.safeParse({ ...valid, windowDays: 8 }).success).toBe(false);
    expect(createConsequenceSchema.safeParse({ ...valid, windowDays: 7 }).success).toBe(true);
  });

  it('caps the expiry even if a stored row held something larger', () => {
    const now = new Date('2026-09-07T00:00:00.000Z');
    const expiry = expiryFor(now, 30, MAX_CONSEQUENCE_WINDOW_DAYS);

    expect(expiry.toISOString()).toBe('2026-09-14T00:00:00.000Z');
  });

  it('requires a threshold when the trigger is an adherence one', () => {
    const without = { ...valid, windowDays: 3, triggerConfig: {} };

    expect(createConsequenceSchema.safeParse(without).success).toBe(false);
  });

  it('does not offer manual-grant as a consequence trigger', () => {
    // Nobody gets a consequence because someone clicked a button.
    const manual = { ...valid, windowDays: 3, trigger: 'manual-grant' };

    expect(createConsequenceSchema.safeParse(manual).success).toBe(false);
  });
});

describe('discharge', () => {
  const recovered: DischargeCondition = { kind: 'adherence-recovered', thresholdRate: 0.7 };

  it('is satisfied by doing the work, not by time', () => {
    expect(
      isDischarged(recovered, {
        adherence: HEALTHY,
        topicsDone: 0,
        triggeringCommitmentResolved: false,
      }),
    ).toBe(true);
  });

  it('is not satisfied while the work is still outstanding', () => {
    expect(
      isDischarged(recovered, {
        adherence: POOR,
        topicsDone: 0,
        triggeringCommitmentResolved: false,
      }),
    ).toBe(false);
  });

  it('ends when the commitment that triggered it is resolved', () => {
    // The source specification's own rule: recovering a missed commitment
    // unlocks its consequence.
    const condition: DischargeCondition = { kind: 'commitment-resolved', commitmentId: 'c1' };

    expect(
      isDischarged(condition, {
        adherence: POOR,
        topicsDone: 0,
        triggeringCommitmentResolved: true,
      }),
    ).toBe(true);
  });

  it('has no branch for dismissal', () => {
    /**
     * The entire mechanism. Every branch of `isDischarged` is the work being
     * put right; a consequence with a dismiss button is a notification, and a
     * notification is what the user learns to close without reading.
     */
    const source = isDischarged.toString();

    expect(source).not.toMatch(/dismiss|acknowledg|snooze/i);
  });
});

describe('expiry is independent of discharge', () => {
  const now = new Date('2026-09-14T12:00:00.000Z');

  it('ends an undischarged consequence at its window', () => {
    expect(isExpired(new Date('2026-09-14T00:00:00.000Z'), now)).toBe(true);
  });

  it('leaves one still inside its window alone', () => {
    expect(isExpired(new Date('2026-09-15T00:00:00.000Z'), now)).toBe(false);
  });

  it('means an undischarged consequence is never permanent', () => {
    const activated = new Date('2026-09-07T00:00:00.000Z');
    const expires = expiryFor(activated, MAX_CONSEQUENCE_WINDOW_DAYS, MAX_CONSEQUENCE_WINDOW_DAYS);

    expect(isExpired(expires, new Date('2026-09-15T00:00:00.000Z'))).toBe(true);
  });
});

// --- The whole pass ---------------------------------------------------------

function input(overrides: Partial<EvaluateAllInput> = {}): EvaluateAllInput {
  return {
    adherence: POOR,
    topicsDone: 0,
    onVacation: false,
    now: new Date('2026-09-10T00:00:00.000Z'),
    rewards: [],
    consequences: [],
    active: null,
    discharge: { adherence: POOR, topicsDone: 0, triggeringCommitmentResolved: false },
    ...overrides,
  };
}

const PENDING = { ...RULE, id: 'c1', status: 'pending' as const };
const ACTIVE: ActiveConsequence = {
  id: 'c0',
  name: 'Already running',
  dischargeCondition: { kind: 'adherence-recovered', thresholdRate: 0.7 },
  expiresAt: new Date('2026-09-20T00:00:00.000Z'),
};

describe('consequences do not stack', () => {
  it('records a second trigger as suppressed rather than activating it', () => {
    /**
     * The rule that stops a bad week compounding into a state nobody can
     * recover from. Two stacked consequences are not twice the motivation;
     * they are the point at which the arrangement stops feeling survivable.
     */
    const decisions = evaluateStakes(input({ consequences: [PENDING], active: ACTIVE }));

    expect(decisions.map((decision) => decision.kind)).toEqual(['suppress-consequence']);
  });

  it('activates only one when several qualify at once', () => {
    const decisions = evaluateStakes(
      input({
        consequences: [PENDING, { ...PENDING, id: 'c2' }, { ...PENDING, id: 'c3' }],
      }),
    );

    expect(decisions.filter((decision) => decision.kind === 'activate-consequence')).toHaveLength(
      1,
    );
    expect(decisions.filter((decision) => decision.kind === 'suppress-consequence')).toHaveLength(
      2,
    );
  });

  it('extends nothing and queues nothing', () => {
    const decisions = evaluateStakes(input({ consequences: [PENDING], active: ACTIVE }));

    // No decision touches the active one's dates.
    expect(decisions.map((decision) => decision.id)).toEqual(['c1']);
  });

  it('frees the slot in the same pass when the active one discharges', () => {
    // A good day can end today's consequence; a bad one starts tomorrow's.
    // Ordering the discharge first is what allows both without stacking.
    const decisions = evaluateStakes(
      input({
        active: ACTIVE,
        adherence: HEALTHY,
        discharge: { adherence: HEALTHY, topicsDone: 0, triggeringCommitmentResolved: false },
        consequences: [PENDING],
      }),
    );

    expect(decisions[0]?.kind).toBe('discharge-consequence');
    // The pending one no longer qualifies at healthy adherence, so it is not
    // activated -- but the slot was freed before it was considered.
    expect(decisions).toHaveLength(1);
  });
});

describe('vacation', () => {
  it('stops further evaluation entirely', () => {
    const decisions = evaluateStakes(
      input({
        onVacation: true,
        consequences: [PENDING],
        rewards: [{ ...RULE, status: 'available' as const }],
      }),
    );

    expect(decisions).toEqual([]);
  });

  it('cannot discharge an active consequence', () => {
    /**
     * Turning vacation on while a consequence is active pauses the clock on
     * further evaluation; it does not clear what is already running. Otherwise
     * vacation mode is the dismiss button by another name.
     */
    const decisions = evaluateStakes(
      input({
        onVacation: true,
        active: ACTIVE,
        adherence: HEALTHY,
        discharge: { adherence: HEALTHY, topicsDone: 0, triggeringCommitmentResolved: true },
      }),
    );

    expect(decisions).toEqual([]);
  });

  it('does not stop an active consequence expiring', () => {
    // Pausing expectations must not extend a penalty already running.
    const decisions = evaluateStakes(
      input({
        onVacation: true,
        active: { ...ACTIVE, expiresAt: new Date('2026-09-09T00:00:00.000Z') },
      }),
    );

    expect(decisions.map((decision) => decision.kind)).toEqual(['expire-consequence']);
  });
});

describe('the reason is always stated', () => {
  it('explains an activation in words', () => {
    /**
     * Required, not decorative. A consequence with no visible cause is
     * arbitrary, and arbitrary stakes get ignored rather than met.
     */
    const [decision] = evaluateStakes(input({ consequences: [PENDING] }));

    expect(decision?.kind).toBe('activate-consequence');
    expect(decision?.reason).toMatch(/Adherence is \d+%/);
    expect(decision?.reason).toMatch(/threshold of 70%/);
  });

  it('explains a suppression too', () => {
    const [decision] = evaluateStakes(input({ consequences: [PENDING], active: ACTIVE }));

    expect(decision?.reason).toMatch(/do not stack/);
  });
});

describe('rewards', () => {
  it('are earned once and not re-earned', () => {
    const decisions = evaluateStakes(
      input({
        adherence: HEALTHY,
        rewards: [
          { ...RULE, id: 'earned', status: 'earned' as const },
          { ...RULE, id: 'claimed', status: 'claimed' as const },
          { ...RULE, id: 'fresh', status: 'available' as const },
        ],
      }),
    );

    expect(decisions.map((decision) => decision.id)).toEqual(['fresh']);
  });
});
