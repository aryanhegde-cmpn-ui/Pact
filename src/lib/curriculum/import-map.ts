import type {
  Block,
  BlockId,
  CurriculumTopic,
  InterviewPrepItem,
  Phase,
  PriorityBand,
  Resource,
} from '@/lib/schemas/curriculum';
import {
  blockIdSchema,
  interviewCategorySchema,
  priorityBandSchema,
  resourceTypeSchema,
} from '@/lib/schemas/curriculum';
import type { DateKey } from '@/lib/time';

import { interviewKey, splitBlockCell, topicKey } from './identity';
import { deriveFocus, normalisePhaseDates } from './phases';
import { parsePractice } from './practice';

/**
 * Turning workbook rows into documents.
 *
 * Pure: rows in, documents out. No file reading, no database, no clock -- the
 * anchor year is an argument. `scripts/import-curriculum.ts` does the I/O and
 * calls this, which is what makes the shape of the import testable against the
 * real 60 rows without a connection.
 *
 * Sections are located by their HEADER TEXT rather than by row number. The
 * Daily Plan sheet stacks three tables in one column range, and hardcoded
 * indices would break silently the first time a row is inserted -- silently
 * being the problem: a plan that quietly lost its phases still imports.
 */

/** One spreadsheet row, keyed by column letter. Empty cells are absent. */
export type Row = Record<string, string>;

function cell(row: Row | undefined, column: string): string {
  return (row?.[column] ?? '').trim();
}

export class ImportError extends Error {}

/**
 * Finds the row after a header whose first cell matches, and the rows under it.
 *
 * Stops at the first row that does not look like a body row -- a section title
 * occupies column A alone, so "column B is empty" is the boundary.
 */
function section(rows: Row[], headerFirstCell: string): Row[] {
  const index = rows.findIndex((row) => cell(row, 'A') === headerFirstCell);
  if (index === -1) {
    throw new ImportError(
      `The sheet has no "${headerFirstCell}" header row.\n` +
        'The importer locates each table by its header, so a renamed header is a real change, not a formatting one.',
    );
  }

  const body: Row[] = [];
  for (const row of rows.slice(index + 1)) {
    if (cell(row, 'B') === '') break;
    body.push(row);
  }

  return body;
}

// --- Blocks -----------------------------------------------------------------

/** "7:00–8:00" -> 07:00 and 08:00. Anything else has no fixed window. */
function parseWindow(text: string): { start: string; end: string; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return null;

  const pad = (value: string) => value.padStart(2, '0');
  const start = `${pad(match[1] ?? '')}:${match[2]}`;
  const end = `${pad(match[3] ?? '')}:${match[4]}`;
  const minutes =
    Number(match[3]) * 60 + Number(match[4]) - (Number(match[1]) * 60 + Number(match[2]));

  return minutes > 0 ? { start, end, minutes } : null;
}

export function mapBlocks(dailyPlan: Row[]): Block[] {
  const blocks: Block[] = [];

  for (const [index, row] of section(dailyPlan, 'Time').entries()) {
    const which = cell(row, 'B');

    /**
     * Office is on the sheet and is deliberately NOT a block.
     *
     * It is there so the plan accounts for the whole day, but the generator
     * has nothing to put in it -- and a "Work" block that generated a daily
     * commitment would produce 120 commitments nobody agreed to.
     */
    const blockId = blockIdOf(which);
    if (!blockId) continue;

    const window = parseWindow(cell(row, 'A'));

    blocks.push({
      blockId,
      label: cell(row, 'A') === '' ? which : cell(row, 'A'),
      area: cell(row, 'C'),
      exactActivity: cell(row, 'D'),
      primaryResource: cell(row, 'E'),
      cadence: cell(row, 'F'),
      kind: blockId.startsWith('block-')
        ? 'study'
        : blockId === 'evening-recovery'
          ? 'recovery'
          : 'optional',
      startTime: window?.start ?? null,
      endTime: window?.end ?? null,
      durationMinutes: window?.minutes ?? null,
      order: index,
    });
  }

  const study = blocks.filter((block) => block.kind === 'study');
  if (study.length !== 3) {
    throw new ImportError(
      `Expected three study blocks, found ${study.length}.\n` +
        'The generator creates one daily series per study block, so a missing one is a missing hour every day.',
    );
  }

  return blocks;
}

function blockIdOf(cellText: string): BlockId | null {
  const numbered = /^Block\s*([123])$/i.exec(cellText);
  if (numbered) return blockIdSchema.parse(`block-${numbered[1]}`);
  if (/^optional$/i.test(cellText)) return 'evening-optional';
  if (/^recovery$/i.test(cellText)) return 'evening-recovery';

  return null;
}

// --- Topics -----------------------------------------------------------------

export function mapTopics(curriculum: Row[]): CurriculumTopic[] {
  const topics: CurriculumTopic[] = [];

  for (const [index, row] of section(curriculum, 'Block').entries()) {
    const split = splitBlockCell(cell(row, 'A'));
    if (!split) {
      throw new ImportError(
        `Curriculum row ${index + 1}: cannot read the block "${cell(row, 'A')}".\n` +
          'Expected "Block 1 — DSA". A row whose block is unknown must not be filed under a guess.',
      );
    }

    const priority = priorityBandSchema.safeParse(cell(row, 'H'));
    if (!priority.success) {
      throw new ImportError(
        `Curriculum row ${index + 1} ("${cell(row, 'C')}"): priority "${cell(row, 'H')}" is not P0, P1 or P2.\n` +
          'Priority drives which topics drift is measured over, so a wrong default would misreport the whole phase.',
      );
    }

    const moduleName = cell(row, 'B');
    const topic = cell(row, 'C');
    const subTopic = cell(row, 'D');
    const practiceRaw = cell(row, 'G');

    topics.push({
      stableKey: topicKey({ blockId: split.blockId, module: moduleName, topic, subTopic }),
      blockId: split.blockId,
      category: split.category,
      module: moduleName,
      topic,
      subTopic,
      resourceName: cell(row, 'E'),
      link: cell(row, 'F'),
      // Verbatim, always. The parse below never rewrites it.
      practiceRaw,
      target: parsePractice(practiceRaw),
      priority: priority.data as PriorityBand,
      order: index,
    });
  }

  const seen = new Set<string>();
  for (const entry of topics) {
    if (seen.has(entry.stableKey)) {
      throw new ImportError(
        `Two curriculum rows share the key ${entry.stableKey}.\n` +
          'The key is block + module + topic + sub-topic, so a collision means two rows are genuinely indistinguishable — and their progress would be too.',
      );
    }
    seen.add(entry.stableKey);
  }

  return topics;
}

// --- Phases -----------------------------------------------------------------

export function mapPhases(
  dailyPlan: Row[],
  topics: CurriculumTopic[],
  anchorYear: number,
): Phase[] {
  const rows = section(dailyPlan, 'Phase');
  const dates = normalisePhaseDates(
    rows.map((row) => cell(row, 'B')),
    anchorYear,
  );

  const vocabulary = {
    categories: [...new Set(topics.map((topic) => topic.category))],
    modules: [...new Set(topics.map((topic) => topic.module))],
  };

  return rows.map((row, index) => {
    const window = dates[index];
    if (!window) throw new ImportError(`Phase ${index + 1} has no dates.`);

    const phase = {
      primaryFocus: cell(row, 'C'),
      secondaryFocus: cell(row, 'D'),
      rule: cell(row, 'F'),
    };

    return {
      number: Number(cell(row, 'A')) || index + 1,
      datesRaw: cell(row, 'B'),
      startDate: window.startDate,
      endDate: window.endDate,
      ...phase,
      outcome: cell(row, 'E'),
      ...deriveFocus(phase, vocabulary),
    };
  });
}

/**
 * Which calendar year the plan starts in, read from the sheet.
 *
 * The phase cells say "October" and "January" with no year, and the header
 * line says "Switch target: January 2027". Those two together pin it down: the
 * anchor year is whichever one makes the LAST phase land on the stated target.
 *
 * Derived rather than passed in because a year typed on the command line is a
 * year somebody eventually gets wrong, and getting it wrong puts the final
 * phase eleven months in the past -- where every drift reading would report a
 * plan that finished before it began.
 */
export function deriveAnchorYear(dailyPlan: Row[]): number {
  const header = dailyPlan.map((row) => cell(row, 'A')).find((text) => /switch target/i.test(text));

  const target = /switch target:\s*([A-Za-z]+)\s+(\d{4})/i.exec(header ?? '');
  if (!target) {
    throw new ImportError(
      'The Daily Plan sheet has no "Switch target: <Month> <Year>" line.\n' +
        'That line is what dates the phases: the sheet writes them as bare month names.',
    );
  }

  const targetMonth = (target[1] ?? '').slice(0, 3).toLowerCase();
  const targetYear = Number(target[2]);
  const cells = section(dailyPlan, 'Phase').map((row) => cell(row, 'B'));

  // The plan is months, not decades. Two candidates is already generous.
  for (const anchor of [targetYear, targetYear - 1, targetYear - 2]) {
    const last = normalisePhaseDates(cells, anchor).at(-1);
    if (!last) continue;

    const [year, month] = last.startDate.split('-');
    const name = new Date(Date.UTC(2000, Number(month) - 1, 1))
      .toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })
      .slice(0, 3)
      .toLowerCase();

    if (Number(year) === targetYear && name === targetMonth) return anchor;
  }

  throw new ImportError(
    `No start year makes the last phase land on ${target[1]} ${targetYear}.\n` +
      'Either the phase list or the switch-target line is wrong.',
  );
}

// --- Resources --------------------------------------------------------------

export function mapResources(resources: Row[]): Resource[] {
  return section(resources, 'Type').map((row, index) => {
    const type = resourceTypeSchema.safeParse(cell(row, 'A'));
    if (!type.success) {
      throw new ImportError(
        `Resource row ${index + 1}: type "${cell(row, 'A')}" is not Core, Optional, Practice or Reference.`,
      );
    }

    return {
      name: cell(row, 'B'),
      type: type.data,
      use: cell(row, 'C'),
      link: cell(row, 'D'),
      // Half of these say, in effect, do not finish this. Kept verbatim so the
      // UI shows the instruction rather than a progress bar.
      howToUse: cell(row, 'E'),
      order: index,
    };
  });
}

// --- Interview prep ---------------------------------------------------------

/**
 * The date serious rehearsal opens.
 *
 * Read from the sheet's own note -- "Serious rehearsal from November" -- and
 * resolved against the imported phases, so it moves when the plan moves. A
 * hardcoded November, or an `if (month >= 11)` in a component, would be silently
 * wrong the first time a re-plan shifts the phases.
 */
export function rehearsalStart(interviewPrep: Row[], phases: Phase[]): DateKey {
  const note = interviewPrep.map((row) => cell(row, 'A')).find((text) => /rehearsal/i.test(text));

  const month = /\bfrom\s+([A-Za-z]+)/i.exec(note ?? '')?.[1]?.toLowerCase();
  if (month) {
    const match = phases.find((phase) =>
      new Date(`${phase.startDate}T00:00:00Z`)
        .toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })
        .toLowerCase()
        .startsWith(month.slice(0, 3)),
    );
    if (match) return match.startDate;
  }

  /**
   * No note, or a month with no phase: fall back to the third phase.
   *
   * Not to today. A gate that defaults to open is a gate that is not there,
   * and the whole point of this field is that rehearsal has a start date.
   */
  const fallback = phases[2] ?? phases.at(-1);
  if (!fallback) throw new ImportError('Cannot date interview rehearsal: there are no phases.');

  return fallback.startDate;
}

export function mapInterviewPrep(
  interviewPrep: Row[],
  rehearsalFrom: DateKey,
): InterviewPrepItem[] {
  return section(interviewPrep, 'Category').map((row, index) => {
    const category = interviewCategorySchema.safeParse(cell(row, 'A'));
    if (!category.success) {
      throw new ImportError(
        `Interview prep row ${index + 1}: unknown category "${cell(row, 'A')}".`,
      );
    }

    const topic = cell(row, 'B');

    return {
      stableKey: interviewKey({ category: category.data, topic }),
      category: category.data,
      topic,
      whatToMaster: cell(row, 'C'),
      practice: cell(row, 'D'),
      rehearsalFrom,
      order: index,
    };
  });
}

// --- The whole workbook -----------------------------------------------------

export interface MappedWorkbook {
  blocks: Block[];
  phases: Phase[];
  topics: CurriculumTopic[];
  resources: Resource[];
  interviewPrep: InterviewPrepItem[];
}

export function mapWorkbook(
  sheets: {
    dailyPlan: Row[];
    curriculum: Row[];
    resources: Row[];
    interviewPrep: Row[];
  },
  anchorYear: number,
): MappedWorkbook {
  const topics = mapTopics(sheets.curriculum);
  const phases = mapPhases(sheets.dailyPlan, topics, anchorYear);

  return {
    blocks: mapBlocks(sheets.dailyPlan),
    phases,
    topics,
    resources: mapResources(sheets.resources),
    interviewPrep: mapInterviewPrep(
      sheets.interviewPrep,
      rehearsalStart(sheets.interviewPrep, phases),
    ),
  };
}
