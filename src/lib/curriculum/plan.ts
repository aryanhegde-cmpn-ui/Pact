import 'server-only';

import { phaseOn } from '@/lib/behavior/drift';
import { appendEvent } from '@/lib/db/events';
import { BlockModel } from '@/lib/db/models/block';
import { CurriculumTopicModel } from '@/lib/db/models/curriculum-topic';
import { PhaseModel } from '@/lib/db/models/phase';
import { SeriesModel } from '@/lib/db/models/series';
import { TopicProgressModel } from '@/lib/db/models/topic-progress';
import type { Priority } from '@/lib/schemas/commitment';
import type { BlockId, PriorityBand, TopicStatus } from '@/lib/schemas/curriculum';
/**
 * Imported from its own module, not from `focus/service`.
 *
 * `focus/service` needs `curriculum/service` to advance topic progress, and
 * `curriculum/service` needs this file. Reaching into it from here would close
 * that loop, and a cycle between three modules is how an import resolves to
 * `undefined` at module-init time for reasons nobody can see from the call
 * site. This one function only touches the session model.
 */
import { carriedOverTopics } from '@/lib/focus/carry-over';
import type { DateKey } from '@/lib/time';

/**
 * How far back a `more-time` session still counts as unfinished work.
 *
 * A fortnight. Long enough to cover a week off, short enough that a topic
 * abandoned mid-way in July does not resurface as today's suggestion.
 */
const CARRY_OVER_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

import { slantFor } from './rhythm';
import { commitmentTitle, suggestTopic, type SuggestableTopic } from './suggest';

/**
 * The bridge between the curriculum and the commitment machinery.
 *
 * The three study blocks are ordinary Series. They materialise through the
 * same `materialiseRange`, get the same notifications, produce the same
 * occurrence documents and can be completed, postponed, missed and reckoned
 * about like anything else. Nothing here is a second scheduler, and the
 * curriculum adds no background job -- there is nowhere to run one.
 *
 * What the block series adds is a title. A daily series alone would produce
 * "Frontend Engineering" 150 times, which is a history nobody can read. The
 * suggestion resolves the day's topic at materialisation time and names it.
 */

/** The workbook's priority bands, mapped onto commitment priority. */
const PRIORITY_OF_BAND: Record<PriorityBand, Priority> = {
  P0: 'must-win',
  P1: 'important',
  P2: 'maintenance',
};

export interface PlanContext {
  blocks: {
    blockId: BlockId;
    area: string;
    exactActivity: string;
    durationMinutes: number | null;
  }[];
  phases: {
    number: number;
    startDate: DateKey;
    endDate: DateKey;
    focusCategories: string[];
    focusModules: string[];
    revisionOnly: boolean;
    revisionBias: boolean;
  }[];
  topics: (SuggestableTopic & { blockId: BlockId; practiceRaw: string })[];
  progress: Map<string, TopicStatus>;
  /**
   * Per block, a topic its last session ended `more-time` on.
   *
   * Read once with the rest of the context. Bounded to the last fortnight: a
   * topic left in progress in July is not what today's block is continuing.
   */
  carriedOver: Map<string, string>;
}

/**
 * Everything the suggestion needs, read once per pass.
 *
 * One set of queries for a whole materialisation rather than one per
 * occurrence: materialising a fortnight of three blocks is 42 occurrences, and
 * a per-occurrence read would be 126 round trips against an M0 cluster.
 *
 * Returns null when no curriculum has been imported, which is the state every
 * installation starts in. The block series then behave like ordinary daily
 * series, which is correct rather than broken.
 */
export async function loadPlanContext(
  ownerId: string,
  now: Date = new Date(),
): Promise<PlanContext | null> {
  const [blocks, phases, topics, progress, carriedOver] = await Promise.all([
    BlockModel.find({ ownerId }).sort({ order: 1 }).lean(),
    PhaseModel.find({ ownerId }).sort({ number: 1 }).lean(),
    CurriculumTopicModel.find({ ownerId }).sort({ order: 1 }).lean(),
    TopicProgressModel.find({ ownerId }).lean(),
    carriedOverTopics(ownerId, new Date(now.getTime() - CARRY_OVER_WINDOW_MS)),
  ]);

  if (topics.length === 0) return null;

  return {
    blocks: blocks.map((block) => ({
      blockId: block.blockId as BlockId,
      area: block.area,
      exactActivity: block.exactActivity,
      durationMinutes: block.durationMinutes ?? null,
    })),
    phases: phases.map((phase) => ({
      number: phase.number,
      startDate: phase.startDate,
      endDate: phase.endDate,
      focusCategories: [...phase.focusCategories],
      focusModules: [...phase.focusModules],
      revisionOnly: phase.revisionOnly,
      revisionBias: phase.revisionBias,
    })),
    topics: topics.map((topic) => ({
      stableKey: topic.stableKey,
      blockId: topic.blockId as BlockId,
      category: topic.category,
      module: topic.module,
      topic: topic.topic,
      subTopic: topic.subTopic,
      priority: topic.priority as PriorityBand,
      order: topic.order,
      practiceRaw: topic.practiceRaw,
    })),
    progress: new Map(progress.map((row) => [row.stableKey, row.status as TopicStatus])),
    carriedOver,
  };
}

export interface BlockPlan {
  title: string;
  outcome: string;
  estimateMinutes: number | null;
  priority: Priority | null;
  curriculumTopicKey: string | null;
  reasons: string[];
}

/**
 * What a block should look like on a given day.
 *
 * Pure given a context: the date is an argument and nothing here reads a clock
 * or touches the database.
 */
export function planForBlock(
  context: PlanContext,
  blockId: BlockId,
  date: DateKey,
): BlockPlan | null {
  const block = context.blocks.find((entry) => entry.blockId === blockId);
  if (!block) return null;

  const suggestion = suggestTopic({
    topics: context.topics.filter((topic) => topic.blockId === blockId),
    progress: context.progress,
    slant: slantFor(date, blockId),
    phase: phaseOn(context.phases, date),
    date,
    carriedOver: context.carriedOver.get(blockId) ?? null,
  });

  const chosen = suggestion.choice;
  if (!chosen) {
    // Every topic in this block is done. The block still happens -- the sheet
    // says daily -- it just has nothing left to name.
    return {
      title: block.area,
      outcome: block.exactActivity,
      estimateMinutes: block.durationMinutes,
      priority: null,
      curriculumTopicKey: null,
      reasons: ['every topic in this block is done'],
    };
  }

  const topic = context.topics.find((entry) => entry.stableKey === chosen.topic.stableKey);

  return {
    title: commitmentTitle(block.area, chosen.topic),
    /**
     * The topic's own practice instruction becomes the outcome.
     *
     * This is what makes a plan-generated commitment specific enough to skip
     * the manual guardrails: "8-10 representative problems" is already an
     * outcome you can verify, so there is nothing for the guard to catch.
     * Falls back to the block's exact activity when the sheet gave no
     * instruction -- never to a generic "study".
     */
    outcome: topic?.practiceRaw?.trim() || block.exactActivity,
    /**
     * The BLOCK's length, not the topic's.
     *
     * Tempting to use the topic's own duration -- the sheet says "45-60 min
     * build" and "5-min verbal framework", and those are real numbers. They
     * are the size of the OUTPUT, though, not the time committed: block 3 is
     * half an hour, and a five-minute estimate on it would make the morning
     * look twenty-five minutes cheaper than it is. A plan that under-reports
     * its own cost is the plan you fall behind on without ever seeing why.
     *
     * The practice target is not lost -- it is the outcome, immediately above.
     */
    estimateMinutes: block.durationMinutes,
    priority: PRIORITY_OF_BAND[chosen.topic.priority],
    curriculumTopicKey: chosen.topic.stableKey,
    reasons: chosen.reasons,
  };
}

/**
 * Creates the daily series for each study block, once.
 *
 * Idempotent: a block already carrying a series is left alone, so this can run
 * on every import. The series is what the existing materialiser picks up; this
 * function schedules nothing itself.
 */
export async function ensureBlockSeries(
  ownerId: string,
  startDate: DateKey,
  now: Date = new Date(),
): Promise<{ created: number; existing: number }> {
  const blocks = await BlockModel.find({ ownerId, kind: 'study' }).sort({ order: 1 }).lean();

  let created = 0;
  let existing = 0;

  for (const block of blocks) {
    if (block.seriesId) {
      existing += 1;
      continue;
    }

    // Defensive: a block whose window could not be read must not become a
    // series with a made-up time.
    if (!block.startTime || !block.durationMinutes) continue;

    const series = await SeriesModel.create({
      title: block.area,
      ownerId,
      outcome: block.exactActivity,
      rule: {
        frequency: 'daily',
        interval: 1,
        byWeekday: [],
        timeOfDay: block.endTime ?? block.startTime,
        estimateMinutes: block.durationMinutes,
      },
      priority: 'important',
      startDate,
      endDate: null,
      status: 'active',
      createdAt: now,
      blockId: block.blockId,
    });

    await appendEvent({
      type: 'SERIES_CREATED',
      entityType: 'series',
      entityId: String(series._id),
      ownerId,
      ts: now,
      source: 'system',
      payload: { blockId: block.blockId, from: 'curriculum import' },
    });

    await BlockModel.updateOne(
      { ownerId, blockId: block.blockId },
      { $set: { seriesId: String(series._id) } },
    );

    created += 1;
  }

  return { created, existing };
}
