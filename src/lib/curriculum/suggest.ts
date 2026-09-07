import type { PriorityBand, TopicStatus } from '@/lib/schemas/curriculum';
import type { DateKey } from '@/lib/time';

import { isRevisionSlant } from './rhythm';

/**
 * Choosing which topic a block should suggest today.
 *
 * Pure: no I/O, no clock, no database. Everything it needs is an argument, so
 * the choice is deterministic and can be tested against a real curriculum
 * without a connection.
 *
 * ---------------------------------------------------------------------------
 * A SUGGESTION, NEVER A LOCK.
 * ---------------------------------------------------------------------------
 * This returns a ranked list, not a verdict. The top entry becomes the day's
 * default and every other candidate stays available to switch to. That is the
 * whole design: a plan that picks for you and then will not let you change it
 * is one you fight every morning, and a plan you fight is one you stop
 * opening.
 *
 * `reasons` exists for the same purpose. A default the user cannot interrogate
 * is a default the user has no basis to accept.
 * ---------------------------------------------------------------------------
 */

export interface SuggestableTopic {
  stableKey: string;
  category: string;
  module: string;
  topic: string;
  subTopic: string;
  priority: PriorityBand;
  order: number;
}

export interface PhaseFocus {
  focusCategories: readonly string[];
  focusModules: readonly string[];
  revisionOnly: boolean;
  revisionBias: boolean;
}

export interface SuggestionInput {
  /** Already narrowed to one block. */
  topics: readonly SuggestableTopic[];
  /** Status by stable key. A key that is absent counts as `not-started`. */
  progress: ReadonlyMap<string, TopicStatus>;
  /** The day's cell from the weekly rhythm, e.g. "Machine coding". */
  slant: string;
  /** Null outside every phase -- before the plan starts, or after it ends. */
  phase: PhaseFocus | null;
  date: DateKey;
  /**
   * A topic this block's last session ran out of time on.
   *
   * Ranked first, above the phase focus and above the day's slant. A block
   * whose work is genuinely unfinished picking up new material tomorrow is how
   * a plan produces a trail of half-done topics -- and "I need more time" is
   * the clearest possible statement that the work continues.
   */
  carriedOver?: string | null;
}

export interface RankedTopic {
  topic: SuggestableTopic;
  status: TopicStatus;
  /** Why this one ranks where it does, most significant first. */
  reasons: string[];
}

export interface Suggestion {
  /** The default. Null when the block has no unfinished topic at all. */
  choice: RankedTopic | null;
  /** Everything else, in order, for the override picker. */
  alternatives: RankedTopic[];
  /** Set when the block genuinely has nothing left, so the UI can say so. */
  exhausted: boolean;
}

const PRIORITY_RANK: Record<PriorityBand, number> = { P0: 0, P1: 1, P2: 2 };

function matchesAny(value: string, names: readonly string[]): boolean {
  return names.some((name) => name.toLowerCase() === value.toLowerCase());
}

/** Whether the day's slant text points at this topic's category or module. */
function matchesSlant(topic: SuggestableTopic, slant: string): boolean {
  if (slant.trim() === '') return false;

  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mentions = (name: string) => new RegExp(`\\b${escape(name)}\\b`, 'i').test(slant);

  return mentions(topic.category) || mentions(topic.module);
}

export function suggestTopic(input: SuggestionInput): Suggestion {
  const revisionDay = isRevisionSlant(input.slant);
  const revisionFirst = revisionDay || (input.phase?.revisionBias ?? false);

  const statusOf = (topic: SuggestableTopic): TopicStatus =>
    input.progress.get(topic.stableKey) ?? 'not-started';

  /**
   * `done` is out, `needs-revision` is not.
   *
   * Those are different facts, and folding them together is what would make
   * the last phase's "study only gaps that appear" unimplementable.
   */
  let candidates = input.topics.filter((topic) => statusOf(topic) !== 'done');

  /**
   * In a revision-only phase, new material is not on the menu at all.
   *
   * The fallback matters: if nothing is marked for revision, the phase has
   * nothing to say and the block goes back to its ordinary candidates rather
   * than showing an empty morning.
   */
  if (input.phase?.revisionOnly) {
    const revisable = candidates.filter((topic) => statusOf(topic) === 'needs-revision');
    if (revisable.length > 0) candidates = revisable;
  }

  if (candidates.length === 0) {
    return { choice: null, alternatives: [], exhausted: input.topics.length > 0 };
  }

  const ranked = candidates
    .map((topic) => {
      const status = statusOf(topic);
      const reasons: string[] = [];

      const carried = input.carriedOver === topic.stableKey;
      const wantsRevision = revisionFirst && status === 'needs-revision';
      const inPhase =
        input.phase !== null &&
        (matchesAny(topic.category, input.phase.focusCategories) ||
          matchesAny(topic.module, input.phase.focusModules));
      const onSlant = matchesSlant(topic, input.slant);
      const started = status === 'in-progress';

      if (carried) reasons.push('you ran out of time on this last session');
      if (wantsRevision) reasons.push(`marked for revision, and today is ${input.slant}`);
      if (inPhase) reasons.push('in this phase’s focus');
      if (onSlant) reasons.push(`today’s slant is ${input.slant}`);
      if (started) reasons.push('already started');
      if (topic.priority === 'P0') reasons.push('P0, must master');

      return {
        entry: { topic, status, reasons },
        /**
         * The sort key, most significant first. Written as a tuple rather than
         * a weighted score so the precedence is readable and a change to it is
         * a visible change rather than a tuning exercise.
         */
        key: [
          carried ? 0 : 1,
          wantsRevision ? 0 : 1,
          inPhase ? 0 : 1,
          onSlant ? 0 : 1,
          PRIORITY_RANK[topic.priority],
          started ? 0 : 1,
          topic.order,
        ],
      };
    })
    .sort((a, b) => {
      for (let i = 0; i < a.key.length; i += 1) {
        const left = a.key[i] ?? 0;
        const right = b.key[i] ?? 0;
        if (left !== right) return left - right;
      }
      return 0;
    })
    .map((row) => row.entry);

  const [choice, ...alternatives] = ranked;

  return { choice: choice ?? null, alternatives, exhausted: false };
}

/**
 * A one-line title for the commitment a block generates.
 *
 * Names the topic, because "Block 1 · DSA" repeated for 120 days is a row
 * nobody can tell apart in their own history -- and the history is the point.
 */
export function commitmentTitle(blockArea: string, topic: SuggestableTopic | null): string {
  if (!topic) return blockArea;

  const detail = topic.subTopic.trim() === '' ? topic.topic : `${topic.topic} · ${topic.subTopic}`;

  return `${blockArea}: ${detail}`;
}
