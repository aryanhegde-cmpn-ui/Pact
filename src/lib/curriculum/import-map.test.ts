import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readWorkbook } from '../../../scripts/xlsx';

import {
  deriveAnchorYear,
  ImportError,
  mapBlocks,
  mapTopics,
  mapWorkbook,
  type Row,
} from './import-map';

/**
 * Mapped from the real workbook, committed to `data/`.
 *
 * The point of these assertions is that the plan in the database is the plan
 * in the spreadsheet. A fixture would only prove the mapper is self-consistent.
 */
const book = readWorkbook(
  fileURLToPath(
    new URL('../../../data/Aryan_SDE2_Frontend_Study_Plan_Jan2027.xlsx', import.meta.url),
  ),
);

const sheets = {
  dailyPlan: book.get('Daily Plan') ?? [],
  curriculum: book.get('Curriculum') ?? [],
  resources: book.get('Resources') ?? [],
  interviewPrep: book.get('Interview Prep') ?? [],
};

const mapped = mapWorkbook(sheets, 2026);

describe('blocks', () => {
  it('reads the three study windows with their real times', () => {
    expect(mapped.blocks.filter((block) => block.kind === 'study')).toMatchObject([
      {
        blockId: 'block-1',
        area: 'DSA',
        startTime: '07:00',
        endTime: '08:00',
        durationMinutes: 60,
      },
      { blockId: 'block-2', startTime: '08:00', endTime: '09:30', durationMinutes: 90 },
      { blockId: 'block-3', startTime: '09:30', endTime: '10:00', durationMinutes: 30 },
    ]);
  });

  it('keeps both evening rows, and neither is a study block', () => {
    // The generator has to be able to SEE workout and rest. A row it cannot
    // see is a row it will schedule over.
    const evening = mapped.blocks.filter((block) => block.blockId.startsWith('evening'));

    expect(evening.map((block) => [block.blockId, block.kind])).toEqual([
      ['evening-optional', 'optional'],
      ['evening-recovery', 'recovery'],
    ]);
  });

  it('does not turn Office into a block', () => {
    // It is on the sheet so the plan accounts for the whole day. A "Work"
    // block would generate 120 commitments nobody agreed to.
    expect(mapped.blocks.map((block) => block.area)).not.toContain('Work');
  });

  it('carries the exact activity across as written', () => {
    expect(mapped.blocks[0]?.exactActivity).toBe(
      '1–2 problems in JavaScript; identify pattern; solve; log mistakes',
    );
  });

  it('refuses a plan missing a study block', () => {
    const withoutBlock3: Row[] = sheets.dailyPlan.filter((row) => row.B !== 'Block 3');

    expect(() => mapBlocks(withoutBlock3)).toThrow(/three study blocks, found 2/);
  });
});

describe('phases', () => {
  it('normalises the workbook wording to real dates, ending in January 2027', () => {
    expect(mapped.phases.map((phase) => [phase.datesRaw, phase.startDate, phase.endDate])).toEqual([
      ['Sep 7–Sep 30', '2026-09-07', '2026-09-30'],
      ['October', '2026-10-01', '2026-10-31'],
      ['November', '2026-11-01', '2026-11-30'],
      ['December', '2026-12-01', '2026-12-31'],
      ['January', '2027-01-01', '2027-01-31'],
    ]);
  });

  it('resolves each phase’s focus against categories that exist in the curriculum', () => {
    expect(mapped.phases[0]?.focusCategories).toEqual(['DSA', 'JS', 'Machine Coding']);
    expect(mapped.phases[2]?.focusCategories).toEqual(['Machine Coding', 'System Design']);
  });

  it('reads the last phase as revision only, from its own rule', () => {
    expect(mapped.phases[4]).toMatchObject({ revisionOnly: true, revisionBias: true });
    expect(mapped.phases[3]).toMatchObject({ revisionOnly: false, revisionBias: true });
  });

  it('keeps the workbook’s wording alongside the derived dates', () => {
    // "October" is what the user wrote and what they will recognise.
    expect(mapped.phases[1]?.datesRaw).toBe('October');
  });
});

describe('topics', () => {
  it('imports all 60 rows', () => {
    expect(mapped.topics).toHaveLength(60);
  });

  it('splits the Block column into a block and a category', () => {
    // "Block 2 — Machine Coding" is one block and one category within it.
    // Treating the whole cell as the block would give block 2 six 8am windows.
    expect(mapped.topics.filter((topic) => topic.blockId === 'block-2')).toHaveLength(37);
    expect([...new Set(mapped.topics.map((topic) => topic.category))]).toEqual([
      'DSA',
      'JS',
      'Performance',
      'React',
      'Machine Coding',
      'System Design',
      'Supporting',
      'Resume',
    ]);
  });

  it('keeps practiceRaw verbatim', () => {
    const arrays = mapped.topics[0];

    expect(arrays?.practiceRaw).toBe('8–10 representative problems');
    // Parsed alongside, never instead of.
    expect(arrays?.target).toMatchObject({ kind: 'problems', targetMin: 8, targetMax: 10 });
  });

  it('flags what it could not parse rather than inventing a target', () => {
    const flagged = mapped.topics.filter((topic) => topic.target.needsReview);

    expect(flagged).toHaveLength(21);
    for (const topic of flagged) {
      expect(topic.target.targetMin).toBeNull();
      // The raw instruction survives, which is the only thing that still says
      // what the row actually asks for.
      expect(topic.practiceRaw).not.toBe('');
    }
  });

  it('gives every row a distinct stable key', () => {
    const keys = new Set(mapped.topics.map((topic) => topic.stableKey));

    expect(keys.size).toBe(mapped.topics.length);
  });

  it('builds the key from what a row IS, not where it sits', () => {
    expect(mapped.topics[0]?.stableKey).toBe(
      'block-1/arrays/arrays/traversal-prefix-suffix-frequency-maps',
    );
  });

  it('refuses a row whose block it cannot read', () => {
    const broken: Row[] = sheets.curriculum.map((row) =>
      row.A === 'Block 1 — DSA' ? { ...row, A: 'Whenever' } : row,
    );

    expect(() => mapTopics(broken)).toThrow(/cannot read the block/);
  });

  it('refuses a row whose priority is not a band', () => {
    const broken: Row[] = sheets.curriculum.map((row) =>
      row.H === 'P0' ? { ...row, H: 'High' } : row,
    );

    // Priority decides what drift is measured over. A silent default would
    // misreport a whole phase.
    expect(() => mapTopics(broken)).toThrow(/not P0, P1 or P2/);
  });

  it('refuses two rows that would share a key', () => {
    const duplicated = [...sheets.curriculum, sheets.curriculum[3] as Row];

    expect(() => mapTopics(duplicated)).toThrow(ImportError);
  });
});

describe('resources', () => {
  it('imports all thirteen with their type and instructions', () => {
    expect(mapped.resources).toHaveLength(13);
    expect(mapped.resources[0]).toMatchObject({
      name: 'Namaste DSA Sheet',
      type: 'Core',
      howToUse: "Daily; don't finish as a course",
    });
  });

  it('carries no progress of any kind', () => {
    // A resource is a pool. See the playlist rule.
    for (const resource of mapped.resources) {
      expect(Object.keys(resource).sort()).toEqual([
        'howToUse',
        'link',
        'name',
        'order',
        'type',
        'use',
      ]);
    }
  });
});

describe('interview prep', () => {
  it('imports all fourteen', () => {
    expect(mapped.interviewPrep).toHaveLength(14);
  });

  it('dates the rehearsal gate from the sheet’s own note, resolved against a phase', () => {
    // "Serious rehearsal from November", and November is phase 3.
    for (const item of mapped.interviewPrep) {
      expect(item.rehearsalFrom).toBe('2026-11-01');
    }
    expect(mapped.phases[2]?.startDate).toBe('2026-11-01');
  });

  it('never dates the gate to today', () => {
    // A gate that defaults to open is not a gate.
    const withoutNote: Row[] = sheets.interviewPrep.filter(
      (row) => !/rehearsal/i.test(row.A ?? ''),
    );
    const fallback = mapWorkbook({ ...sheets, interviewPrep: withoutNote }, 2026);

    expect(fallback.interviewPrep[0]?.rehearsalFrom).toBe('2026-11-01');
  });
});

describe('sections are found by header, not by row number', () => {
  it('still reads the phases when a row is inserted above them', () => {
    const shifted: Row[] = [{ A: 'A NOTE SOMEONE ADDED' }, ...sheets.dailyPlan];

    expect(mapWorkbook({ ...sheets, dailyPlan: shifted }, 2026).phases).toHaveLength(5);
  });

  it('fails loudly when a header is renamed', () => {
    const renamed: Row[] = sheets.dailyPlan.map((row) =>
      row.A === 'Phase' ? { ...row, A: 'Stage' } : row,
    );

    // A renamed header is a real change to the plan's shape. Quietly importing
    // a curriculum with no phases would leave drift measuring nothing.
    expect(() => mapWorkbook({ ...sheets, dailyPlan: renamed }, 2026)).toThrow(/no "Phase" header/);
  });
});

describe('deriveAnchorYear', () => {
  it('reads the start year from the switch target, not from the clock', () => {
    // The sheet says "Switch target: January 2027" and its last phase is
    // January, so the plan starts in 2026. Nothing here consults today's date:
    // running the import in 2027 must not shift the whole plan forward.
    expect(deriveAnchorYear(sheets.dailyPlan)).toBe(2026);
  });

  it('refuses to guess when the target line is missing', () => {
    const withoutTarget: Row[] = sheets.dailyPlan.filter(
      (row) => !/switch target/i.test(row.A ?? ''),
    );

    expect(() => deriveAnchorYear(withoutTarget)).toThrow(/Switch target/);
  });

  it('refuses when no year makes the phases reach the target', () => {
    const impossible: Row[] = sheets.dailyPlan.map((row) =>
      /switch target/i.test(row.A ?? '') ? { ...row, A: 'Switch target: March 2027' } : row,
    );

    expect(() => deriveAnchorYear(impossible)).toThrow(/No start year/);
  });
});
