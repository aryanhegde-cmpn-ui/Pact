import { describe, expect, it } from 'vitest';

import { deriveFocus, normalisePhaseDates, parseDatesCell } from './phases';

/** The workbook's five Dates cells, verbatim and in order. */
const CELLS = ['Sep 7–Sep 30', 'October', 'November', 'December', 'January'];

describe('normalisePhaseDates', () => {
  it('turns the workbook cells into the plan Sep 2026 to Jan 2027', () => {
    expect(normalisePhaseDates(CELLS, 2026)).toEqual([
      { startDate: '2026-09-07', endDate: '2026-09-30' },
      { startDate: '2026-10-01', endDate: '2026-10-31' },
      { startDate: '2026-11-01', endDate: '2026-11-30' },
      { startDate: '2026-12-01', endDate: '2026-12-31' },
      // The whole point: January is the year AFTER the others.
      { startDate: '2027-01-01', endDate: '2027-01-31' },
    ]);
  });

  it('rolls the year over without anybody hardcoding it', () => {
    // Nothing in the input says 2027. The rule is only that phases move
    // forward, so a month earlier than the last one is next year.
    const [, january] = normalisePhaseDates(['December', 'January'], 2030);

    expect(january).toEqual({ startDate: '2031-01-01', endDate: '2031-01-31' });
  });

  it('ends a bare month on its real last day, leap years included', () => {
    expect(normalisePhaseDates(['February'], 2028)[0]?.endDate).toBe('2028-02-29');
    expect(normalisePhaseDates(['February'], 2027)[0]?.endDate).toBe('2027-02-28');
  });

  it('throws on a cell it cannot read, naming the phase', () => {
    // A skipped phase would leave a hole in the schedule that drift silently
    // reads as "nothing was planned then".
    expect(() => normalisePhaseDates(['October', 'sometime in spring'], 2026)).toThrow(/Phase 2/);
  });
});

describe('parseDatesCell', () => {
  it('accepts abbreviated and full month names', () => {
    expect(parseDatesCell('Sep 7–Sep 30')).toMatchObject({ startMonth: 8, endMonth: 8 });
    expect(parseDatesCell('September 7 - September 30')).toMatchObject({ startDay: 7, endDay: 30 });
  });

  it('rejects a one- or two-letter month rather than guessing', () => {
    // "Ja" could be January; "Ma" could be March or May. Neither is a fact.
    expect(parseDatesCell('Ma')).toBeNull();
  });
});

describe('deriveFocus', () => {
  const VOCABULARY = {
    categories: ['DSA', 'JS', 'Performance', 'React', 'Machine Coding', 'Supporting', 'Resume'],
    modules: ['Arrays', 'Browser', 'Testing', 'Async', 'Web Vitals'],
  };

  it('resolves the workbook focus text against names that actually exist', () => {
    expect(
      deriveFocus(
        {
          primaryFocus: 'JS + DSA foundations',
          secondaryFocus: 'Machine coding basics',
          rule: 'Hands-on > passive watching',
        },
        VOCABULARY,
      ),
    ).toMatchObject({
      focusCategories: ['DSA', 'JS', 'Machine Coding'],
      focusModules: [],
      revisionOnly: false,
      revisionBias: false,
    });
  });

  it('finds a MODULE named in the focus text, not only a category', () => {
    // "Browser / performance" points at one of each. Matching categories alone
    // would lose the browser half of a whole phase.
    const focus = deriveFocus(
      {
        primaryFocus: 'Machine coding + React architecture',
        secondaryFocus: 'Browser / performance',
        rule: 'Build from blank screen',
      },
      VOCABULARY,
    );

    expect(focus.focusCategories).toEqual(['Performance', 'React', 'Machine Coding']);
    expect(focus.focusModules).toEqual(['Browser']);
  });

  it('reads "Study only gaps that appear" as revision only', () => {
    expect(
      deriveFocus(
        {
          primaryFocus: 'Applications + interviews',
          secondaryFocus: 'Targeted revision',
          rule: 'Study only gaps that appear',
        },
        VOCABULARY,
      ),
    ).toMatchObject({ revisionOnly: true, revisionBias: true });
  });

  it('reads "DSA revision" as a bias, not a prohibition on new material', () => {
    const focus = deriveFocus(
      {
        primaryFocus: 'Mocks + resume deep dives',
        secondaryFocus: 'DSA revision',
        rule: 'Timed practice',
      },
      VOCABULARY,
    );

    expect(focus).toMatchObject({ revisionBias: true, revisionOnly: false });
    expect(focus.focusCategories).toContain('Resume');
  });

  it('matches nothing when the phase is not about itemised material', () => {
    // Not an error. "Applications + interviews" is a real phase with no topics
    // of its own, and the suggestion falls back to the block order.
    const focus = deriveFocus(
      { primaryFocus: 'Applications + interviews', secondaryFocus: '', rule: '' },
      VOCABULARY,
    );

    expect(focus.focusCategories).toEqual([]);
    expect(focus.focusModules).toEqual([]);
  });
});
