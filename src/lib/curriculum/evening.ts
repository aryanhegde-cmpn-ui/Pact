import type { TopicStatus } from '@/lib/schemas/curriculum';

/**
 * What, if anything, belongs in the evening.
 *
 * Pure: no I/O, no clock. Everything is an argument.
 *
 * ---------------------------------------------------------------------------
 * THE EVENING IS NOT A FOURTH STUDY BLOCK.
 * ---------------------------------------------------------------------------
 * The workbook is unusually explicit about this, and gives the evening two
 * rows rather than one:
 *
 *   Evening | Optional | Finish / Revision | "Only finish an incomplete
 *           |          |                   |  morning task or revise a weak
 *           |          |                   |  topic" | 30-60 min max
 *   Evening | Recovery | Workout + Rest    | "Protect sleep and consistency;
 *           |          |                   |  don't turn every free hour into
 *           |          |                   |  study" | Priority
 *
 * So there are exactly two rules here, and both are prohibitions:
 *
 *   1. NEW MATERIAL NEVER GOES IN THE EVENING. Only finishing something from
 *      this morning, or revising something already marked weak.
 *   2. WHEN THE MORNING WAS COMPLETED, THE EVENING STAYS EMPTY. Not "a lighter
 *      suggestion" -- empty, with the recovery row shown in its place.
 *
 * The second is the one a well-meaning generator breaks. A day where all three
 * blocks were done is exactly the day it is tempting to offer a bonus, and
 * that is precisely the day the sheet says to stop. "Don't turn every free
 * hour into study" is a real instruction from the person who has to live the
 * plan, and a plan that costs its user their sleep is one they abandon in
 * three weeks -- which fails the feature test harder than any missed evening.
 *
 * This module also deliberately does NOT create a commitment. The unfinished
 * morning work already IS a commitment, with its own deadline and its own
 * miss. Generating a second row for the same work would double-count it in
 * every reading of the record.
 * ---------------------------------------------------------------------------
 */

export interface MorningBlock {
  blockId: string;
  area: string;
  commitmentId: string;
  title: string;
  /** `done` and `abandoned` both mean the block is closed for the day. */
  status: string;
}

export interface EveningOption {
  kind: 'finish' | 'revise';
  /** The commitment to return to, for `finish`. */
  commitmentId?: string;
  /** The topic to go back over, for `revise`. */
  stableKey?: string;
  label: string;
}

export interface Evening {
  /** Always true when the morning was completed. The recovery row is the answer. */
  recoveryOnly: boolean;
  /** Why, in the sheet's own terms, so the UI does not have to invent copy. */
  reason: string;
  /** Empty when `recoveryOnly`. Never contains new material. */
  options: EveningOption[];
}

const CLOSED = new Set(['done', 'abandoned']);

export function eveningPlan(input: {
  morning: readonly MorningBlock[];
  /** Topic keys marked `needs-revision`, with a label to show. */
  weakTopics: readonly { stableKey: string; label: string; status: TopicStatus }[];
}): Evening {
  const unfinished = input.morning.filter((block) => !CLOSED.has(block.status));

  if (input.morning.length > 0 && unfinished.length === 0) {
    return {
      recoveryOnly: true,
      reason: 'The morning blocks are done. Workout and rest — the plan lists that as a priority.',
      options: [],
    };
  }

  const options: EveningOption[] = unfinished.map((block) => ({
    kind: 'finish',
    commitmentId: block.commitmentId,
    label: `Finish ${block.area}: ${block.title}`,
  }));

  /**
   * Revision is offered second, and only alongside unfinished work.
   *
   * The sheet's wording is "finish an incomplete morning task OR revise a weak
   * topic" -- both live under the same Optional row, which exists only when
   * the morning did not close.
   */
  for (const topic of input.weakTopics) {
    if (topic.status !== 'needs-revision') continue;
    options.push({ kind: 'revise', stableKey: topic.stableKey, label: `Revise ${topic.label}` });
  }

  return {
    recoveryOnly: false,
    reason:
      unfinished.length > 0
        ? 'One of this morning’s blocks did not close. 30–60 minutes, then stop.'
        : 'Nothing scheduled this morning. 30–60 minutes at most, and only on weak material.',
    options,
  };
}
