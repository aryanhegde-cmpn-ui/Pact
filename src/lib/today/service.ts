import 'server-only';

import { computeDrift, phaseOn, type Drift } from '@/lib/behavior/drift';
import { listByDateRange, overdueCounts, type CommitmentView } from '@/lib/commitments/service';
import { loadPlanContext, planForBlock } from '@/lib/curriculum/plan';
import { PhaseModel } from '@/lib/db/models/phase';
import { getEnv } from '@/lib/env';
import type { BlockId, PriorityBand, TopicStatus } from '@/lib/schemas/curriculum';
import { slantFor } from '@/lib/curriculum/rhythm';
import { suggestTopic, type RankedTopic } from '@/lib/curriculum/suggest';
import { addDays, toDateKey, type DateKey } from '@/lib/time';

import { dateLine, greetingFor, type Greeting } from './greeting';

/**
 * Everything Today renders, assembled once.
 *
 * The page is a view over this; nothing in a component queries. That is what
 * lets Tomorrow reuse the same shape with a different date, and it is what
 * makes the ring's denominator testable without a browser.
 */

export interface TodayBlockView {
  blockId: BlockId;
  area: string;
  /** Wall clock in APP_TIMEZONE, from the workbook. */
  startTime: string | null;
  endTime: string | null;
  /** The day's cell from the weekly rhythm. */
  slant: string;
  commitment: CommitmentView | null;
  topicKey: string | null;
  topicLabel: string | null;
  /** The workbook's practice instruction, verbatim. */
  targetLabel: string | null;
  reasons: string[];
  alternatives: { stableKey: string; label: string; priority: PriorityBand; status: TopicStatus }[];
  /** `done`, `abandoned`, `in-progress`, `pending`, or `not-generated`. */
  state: string;
}

export interface NextAction {
  commitmentId: string;
  /** Split so a long generated title sets properly instead of wrapping to five lines. */
  heading: string;
  detail: string | null;
  outcome: string;
  estimateMinutes: number;
  window: string | null;
  blockId: BlockId | null;
  /** True when this is the answer to a miss rather than the next block. */
  needsReckoning: boolean;
}

export interface TodayView {
  date: DateKey;
  dateLine: string;
  greeting: Greeting;
  /** Always exactly three when a curriculum exists. The ring's denominator. */
  blocks: TodayBlockView[];
  blocksDone: number;
  /** The single most prominent thing on the page. Null only when nothing is open. */
  next: NextAction | null;
  /** Commitments due today that are NOT blocks. They never enter the ring. */
  alsoToday: CommitmentView[];
  needsReckoning: CommitmentView[];
  overdue: { total: number; needsReckoning: number };
  phase: { number: number; outcome: string } | null;
  drift: Drift | null;
  /** True before any workbook has been imported. */
  noCurriculum: boolean;
  /** Set on Tomorrow when a block for that day is already finished. */
  aheadOfSchedule: boolean;
}

const CLOSED = new Set(['done', 'abandoned']);

/**
 * Assembles one day.
 *
 * `date` is a parameter rather than always "now" so Tomorrow is the same
 * function with a different argument -- two implementations of "what does a
 * day look like" would drift apart within a month.
 */
export async function buildDay(
  ownerId: string,
  date: DateKey,
  now: Date = new Date(),
): Promise<TodayView> {
  const timeZone = getEnv().APP_TIMEZONE;
  const today = toDateKey(now, timeZone);
  const isToday = date === today;

  const context = await loadPlanContext(ownerId, now);

  // Reading is what materialises the day's occurrences. There is no scheduler.
  const commitments = await listByDateRange(date, date, timeZone, ownerId, now);

  const studyBlocks = (context?.blocks ?? []).filter((block) => block.blockId.startsWith('block-'));

  const blocks: TodayBlockView[] = studyBlocks.map((block) => {
    const commitment = commitments.find((row) => row.blockId === block.blockId) ?? null;
    const slant = slantFor(date, block.blockId);

    const suggestion = context
      ? suggestTopic({
          topics: context.topics.filter((topic) => topic.blockId === block.blockId),
          progress: context.progress,
          slant,
          phase: phaseOn(context.phases, date),
          date,
          carriedOver: context.carriedOver.get(block.blockId) ?? null,
        })
      : null;

    const plan = context ? planForBlock(context, block.blockId, date) : null;
    const topicKey = commitment?.curriculumTopicKey ?? plan?.curriculumTopicKey ?? null;
    const topic = context?.topics.find((entry) => entry.stableKey === topicKey) ?? null;

    return {
      blockId: block.blockId,
      area: block.area,
      startTime: block.startTime,
      endTime: block.endTime,
      slant,
      commitment,
      topicKey,
      topicLabel: topic
        ? topic.subTopic.trim() === ''
          ? topic.topic
          : `${topic.topic} · ${topic.subTopic}`
        : null,
      targetLabel: topic?.practiceRaw ?? null,
      // Once an occurrence exists it carries the answer, including an override.
      reasons: commitment?.curriculumTopicKey ? [] : (plan?.reasons ?? []),
      alternatives: [suggestion?.choice ?? null, ...(suggestion?.alternatives ?? [])]
        .filter((entry): entry is RankedTopic => entry !== null)
        .map((entry) => ({
          stableKey: entry.topic.stableKey,
          label:
            entry.topic.subTopic.trim() === ''
              ? entry.topic.topic
              : `${entry.topic.topic} · ${entry.topic.subTopic}`,
          priority: entry.topic.priority,
          status: entry.status,
        })),
      state: commitment?.status ?? 'not-generated',
    };
  });

  const blocksDone = blocks.filter((block) => block.commitment?.status === 'done').length;

  const blockIds = new Set(blocks.map((block) => block.blockId));
  const alsoToday = commitments.filter(
    (row) => row.blockId === null || !blockIds.has(row.blockId as BlockId),
  );

  const needsReckoning = commitments.filter((row) => row.needsReckoning);

  const [overdue, phaseRows] = await Promise.all([
    overdueCounts(ownerId, now),
    PhaseModel.find({ ownerId }).sort({ number: 1 }).lean(),
  ]);

  const phase = phaseOn(phaseRows, date);

  return {
    date,
    dateLine: dateLine(date),
    greeting: greetingFor({
      date,
      // Tomorrow has no "now"; it is greeted as the start of its window, which
      // is the state it will actually be in when it arrives.
      minutes: isToday ? minutesOfDay(now, timeZone) : 7 * 60,
      blocksDone,
      blocksTotal: blocks.length,
    }),
    blocks,
    blocksDone,
    next: pickNext(blocks, alsoToday, needsReckoning),
    alsoToday,
    needsReckoning,
    overdue: { total: overdue.total, needsReckoning: overdue.needsReckoning },
    phase: phase ? { number: phase.number, outcome: phase.outcome } : null,
    drift:
      phase && context
        ? computeDrift(
            {
              number: phase.number,
              startDate: phase.startDate,
              endDate: phase.endDate,
              focusCategories: phase.focusCategories,
              focusModules: phase.focusModules,
            },
            context.topics,
            context.progress,
            date,
          )
        : null,
    noCurriculum: context === null,
    /**
     * Recognised, as a message, never as a badge.
     *
     * Finishing tomorrow's work today is a real thing to notice -- docs/
     * product.md keeps it explicitly. What it must not become is a collectible,
     * so it is a boolean the surface turns into one sentence and nothing else.
     */
    aheadOfSchedule: !isToday && date > today && blocksDone > 0,
  };
}

function minutesOfDay(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);

  return hour * 60 + minute;
}

/**
 * The one thing to do next.
 *
 * Order: an unanswered miss, then the first open block, then anything else due.
 * A miss wins because it sorts above everything else everywhere in this app --
 * and because the next action is the largest element on the page, putting a
 * cheerful "start Block 2" there while three deadlines sit unanswered would be
 * the warm surface softening an accountability one.
 */
function pickNext(
  blocks: TodayBlockView[],
  alsoToday: CommitmentView[],
  needsReckoning: CommitmentView[],
): NextAction | null {
  const miss = needsReckoning[0];
  if (miss) {
    return {
      commitmentId: miss.id,
      heading: miss.title,
      detail: null,
      outcome: miss.outcome,
      estimateMinutes: miss.estimateMinutes,
      window: null,
      blockId: null,
      needsReckoning: true,
    };
  }

  const block = blocks.find((entry) => entry.commitment && !CLOSED.has(entry.commitment.status));
  if (block?.commitment) {
    const [heading, detail] = splitTopicLabel(block.area, block.topicLabel);

    return {
      commitmentId: block.commitment.id,
      heading,
      detail,
      outcome: block.targetLabel ?? block.commitment.outcome,
      estimateMinutes: block.commitment.estimateMinutes,
      window: block.startTime && block.endTime ? `${block.startTime}–${block.endTime}` : null,
      blockId: block.blockId,
      needsReckoning: false,
    };
  }

  const other = alsoToday.find((row) => !CLOSED.has(row.status));
  if (other) {
    return {
      commitmentId: other.id,
      heading: other.title,
      detail: null,
      outcome: other.outcome,
      estimateMinutes: other.estimateMinutes,
      window: null,
      blockId: null,
      needsReckoning: false,
    };
  }

  return null;
}

/**
 * Splits a block's identity from its topic detail.
 *
 * A plan-generated title is "Frontend Engineering: Interview Process · Clarify
 * scope; model data; components; services; performance; security; a11y" -- 96
 * characters. Set whole at display size on a 390px screen that is five lines
 * and the next action stops looking like one thing. The heading takes the area
 * and the topic; the sub-topic drops to body size underneath.
 */
export function splitTopicLabel(
  area: string,
  topicLabel: string | null,
): [heading: string, detail: string | null] {
  if (!topicLabel) return [area, null];

  const [topic, ...rest] = topicLabel.split(' · ');

  return [`${area}: ${topic}`, rest.length > 0 ? rest.join(' · ') : null];
}

/** Tomorrow, for the Tomorrow tab. */
export async function buildTomorrow(ownerId: string, now: Date = new Date()): Promise<TodayView> {
  const timeZone = getEnv().APP_TIMEZONE;

  return buildDay(ownerId, addDays(toDateKey(now, timeZone), 1), now);
}
