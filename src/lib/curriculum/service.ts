import 'server-only';

import { computeDrift, phaseOn, type Drift } from '@/lib/behavior/drift';
import { listByDateRange, type CommitmentView } from '@/lib/commitments/service';
import { appendEvent } from '@/lib/db/events';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { CurriculumTopicModel } from '@/lib/db/models/curriculum-topic';
import { InterviewPrepItemModel } from '@/lib/db/models/interview-prep-item';
import { PhaseModel } from '@/lib/db/models/phase';
import { ResourceModel } from '@/lib/db/models/resource';
import { TopicProgressModel } from '@/lib/db/models/topic-progress';
import { getEnv } from '@/lib/env';
import type {
  BlockId,
  PriorityBand,
  TopicStatus,
  correctTargetSchema,
  overrideTopicSchema,
  setTopicProgressSchema,
} from '@/lib/schemas/curriculum';
import { toDateKey, type DateKey } from '@/lib/time';
import type { z } from 'zod';

import { eveningPlan, type Evening } from './evening';
import { loadPlanContext, planForBlock } from './plan';
import { describeTarget } from './practice';
import { rhythmFor, slantFor } from './rhythm';
import { suggestTopic, type RankedTopic } from './suggest';

/**
 * Reads and writes over the imported curriculum.
 *
 * The analysis is all elsewhere and pure -- suggestion, drift, the evening
 * rule. This module is the I/O around it.
 */

export class CurriculumError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// --- The curriculum browser -------------------------------------------------

export interface BrowserTopic {
  stableKey: string;
  topic: string;
  subTopic: string;
  priority: PriorityBand;
  status: TopicStatus;
  resourceName: string;
  link: string;
  practiceRaw: string;
  /** The parsed target, or the raw text when nothing was parsed. */
  targetLabel: string;
  needsReview: boolean;
}

export interface BrowserModule {
  module: string;
  topics: BrowserTopic[];
}

export interface BrowserBlock {
  blockId: BlockId;
  category: string;
  modules: BrowserModule[];
}

/**
 * The curriculum, grouped block then module then topic.
 *
 * Module-then-topic ordering is modelled now rather than later because this
 * view becomes a course-style layout, and retrofitting a hierarchy onto a flat
 * list once components depend on it is the expensive version of this change.
 */
export async function getCurriculumBrowser(ownerId: string): Promise<BrowserBlock[]> {
  const [topics, progress] = await Promise.all([
    CurriculumTopicModel.find({ ownerId }).sort({ order: 1 }).lean(),
    TopicProgressModel.find({ ownerId }).lean(),
  ]);

  const status = new Map(progress.map((row) => [row.stableKey, row.status as TopicStatus]));
  const groups: BrowserBlock[] = [];

  for (const row of topics) {
    const blockId = row.blockId as BlockId;
    let group = groups.find(
      (entry) => entry.blockId === blockId && entry.category === row.category,
    );
    if (!group) {
      group = { blockId, category: row.category, modules: [] };
      groups.push(group);
    }

    let moduleGroup = group.modules.find((entry) => entry.module === row.module);
    if (!moduleGroup) {
      moduleGroup = { module: row.module, topics: [] };
      group.modules.push(moduleGroup);
    }

    const target = {
      kind: row.target?.kind ?? 'other',
      unit: row.target?.unit ?? null,
      targetMin: row.target?.targetMin ?? null,
      targetMax: row.target?.targetMax ?? null,
      needsReview: row.target?.needsReview ?? true,
      reviewReason: row.target?.reviewReason ?? null,
    };

    moduleGroup.topics.push({
      stableKey: row.stableKey,
      topic: row.topic,
      subTopic: row.subTopic,
      priority: row.priority as PriorityBand,
      status: status.get(row.stableKey) ?? 'not-started',
      resourceName: row.resourceName,
      link: row.link,
      practiceRaw: row.practiceRaw,
      targetLabel: describeTarget(target as never, row.practiceRaw),
      needsReview: target.needsReview,
    });
  }

  return groups;
}

// --- The review list --------------------------------------------------------

export interface FlaggedTopic {
  stableKey: string;
  blockId: BlockId;
  module: string;
  topic: string;
  subTopic: string;
  practiceRaw: string;
  reviewReason: string | null;
}

/**
 * Rows whose practice target the parser could not read.
 *
 * This list is the design working, not the design failing: a third of the
 * sheet is prose that has no countable target in it, and every row here is one
 * the parser declined to guess at. Correcting them is a few minutes of work
 * that a confident wrong parse would have hidden forever.
 */
export async function listFlagged(ownerId: string): Promise<FlaggedTopic[]> {
  const rows = await CurriculumTopicModel.find({ ownerId, 'target.needsReview': true })
    .sort({ order: 1 })
    .lean();

  return rows.map((row) => ({
    stableKey: row.stableKey,
    blockId: row.blockId as BlockId,
    module: row.module,
    topic: row.topic,
    subTopic: row.subTopic,
    practiceRaw: row.practiceRaw,
    reviewReason: row.target?.reviewReason ?? null,
  }));
}

export async function correctTarget(
  input: z.infer<typeof correctTargetSchema>,
  ownerId: string,
): Promise<FlaggedTopic[]> {
  if (input.targetMin !== null && input.targetMax !== null && input.targetMax < input.targetMin) {
    throw new CurriculumError('The maximum cannot be below the minimum.');
  }
  if ((input.targetMin === null) !== (input.unit === null)) {
    throw new CurriculumError('A target needs both a number and a unit, or neither.');
  }

  const result = await CurriculumTopicModel.updateOne(
    { ownerId, stableKey: input.stableKey },
    {
      $set: {
        target: {
          kind: input.kind,
          unit: input.unit,
          targetMin: input.targetMin,
          targetMax: input.targetMax,
          // Corrected by a person, so it is no longer under review -- and the
          // next import will leave it alone.
          needsReview: false,
          reviewReason: null,
          correctedByHand: true,
        },
      },
    },
  );

  if (result.matchedCount === 0) throw new CurriculumError('No such topic.', 404);

  return listFlagged(ownerId);
}

// --- Progress ---------------------------------------------------------------

export async function setTopicProgress(
  input: z.infer<typeof setTopicProgressSchema>,
  ownerId: string,
  now: Date = new Date(),
): Promise<{ stableKey: string; status: TopicStatus }> {
  const topic = await CurriculumTopicModel.findOne(
    { ownerId, stableKey: input.stableKey },
    { stableKey: 1 },
  ).lean();
  if (!topic) throw new CurriculumError('No such topic.', 404);

  const existing = await TopicProgressModel.findOne({
    ownerId,
    stableKey: input.stableKey,
  }).lean();

  await TopicProgressModel.updateOne(
    { ownerId, stableKey: input.stableKey },
    {
      $set: {
        status: input.status,
        ...(input.note === undefined ? {} : { note: input.note }),
        updatedAt: now,
        ...(existing?.startedAt || input.status === 'not-started' ? {} : { startedAt: now }),
        ...(existing?.firstDoneAt || input.status !== 'done' ? {} : { firstDoneAt: now }),
      },
      $setOnInsert: { ownerId, stableKey: input.stableKey },
    },
    { upsert: true },
  );

  /**
   * A status change is a state change, so it appends an event.
   *
   * The note is deliberately NOT in the payload. Free text is private by
   * default, and the overseer's read model is built from events -- putting it
   * here would be the quiet way it becomes readable.
   */
  await appendEvent({
    type: 'TOPIC_PROGRESS_CHANGED',
    entityType: 'topic',
    entityId: input.stableKey,
    ownerId,
    ts: now,
    source: 'user',
    payload: { from: existing?.status ?? 'not-started', to: input.status },
  });

  return { stableKey: input.stableKey, status: input.status };
}

// --- Today ------------------------------------------------------------------

export interface TodayBlock {
  blockId: BlockId;
  area: string;
  /** The day's cell from the weekly rhythm, e.g. "Machine coding". */
  slant: string;
  /** The generated occurrence, once it exists. */
  commitment: CommitmentView | null;
  /** The topic this block is currently for. */
  topicKey: string | null;
  /** Why the plan suggested it. */
  reasons: string[];
  /** Everything else it could be, for the override. */
  alternatives: { stableKey: string; label: string; priority: PriorityBand; status: TopicStatus }[];
}

export interface StudyToday {
  date: DateKey;
  rhythm: { label: string; output: string };
  blocks: TodayBlock[];
  evening: Evening;
  phase: { number: number; startDate: DateKey; endDate: DateKey; outcome: string } | null;
  drift: Drift | null;
  /** True when no workbook has been imported yet. */
  empty: boolean;
}

export async function getStudyToday(ownerId: string, now: Date = new Date()): Promise<StudyToday> {
  const timeZone = getEnv().APP_TIMEZONE;
  const date = toDateKey(now, timeZone);
  const rhythm = rhythmFor(date);

  const context = await loadPlanContext(ownerId);
  if (!context) {
    return {
      date,
      rhythm: { label: rhythm.label, output: rhythm.output },
      blocks: [],
      evening: eveningPlan({ morning: [], weakTopics: [] }),
      phase: null,
      drift: null,
      empty: true,
    };
  }

  // Reading is what materialises the block occurrences. There is no scheduler.
  const todays = await listByDateRange(date, date, timeZone, ownerId, now);
  const phaseRows = await PhaseModel.find({ ownerId }).sort({ number: 1 }).lean();
  const phase = phaseOn(phaseRows, date);

  const studyBlocks = context.blocks.filter((block) => block.blockId.startsWith('block-'));

  /**
   * Refresh a suggestion that has gone stale.
   *
   * Occurrences materialise up to a fortnight ahead, and the suggestion for
   * each day is computed against the progress that existed when the occurrence
   * was created. Do the Modal build on Tuesday and Friday's occurrence still
   * names it -- a plan telling you to do something you have already finished.
   *
   * Only when the topic is now DONE, only while the occurrence is still open,
   * and never over a choice the user made themselves. Re-suggesting on every
   * read would silently revert this morning's override.
   */
  await Promise.all(
    todays
      .filter(
        (row) =>
          row.blockId !== null &&
          row.curriculumTopicKey !== null &&
          !row.topicOverridden &&
          (row.status === 'pending' || row.status === 'in-progress') &&
          context.progress.get(row.curriculumTopicKey) === 'done',
      )
      .map(async (row) => {
        const refreshed = planForBlock(context, row.blockId as BlockId, date);
        if (!refreshed || refreshed.curriculumTopicKey === row.curriculumTopicKey) return;

        await CommitmentModel.updateOne(
          { _id: row.id, ownerId },
          {
            $set: {
              curriculumTopicKey: refreshed.curriculumTopicKey,
              title: refreshed.title,
              outcome: refreshed.outcome,
            },
          },
        );

        row.curriculumTopicKey = refreshed.curriculumTopicKey;
        row.title = refreshed.title;
        row.outcome = refreshed.outcome;
      }),
  );

  const blocks: TodayBlock[] = studyBlocks.map((block) => {
    const commitment = todays.find((row) => row.blockId === block.blockId) ?? null;
    const suggestion = suggestTopic({
      topics: context.topics.filter((topic) => topic.blockId === block.blockId),
      progress: context.progress,
      slant: slantFor(date, block.blockId),
      phase: phaseOn(context.phases, date),
      date,
    });

    const plan = planForBlock(context, block.blockId, date);

    return {
      blockId: block.blockId,
      area: block.area,
      slant: slantFor(date, block.blockId),
      commitment,
      /**
       * The commitment's own topic wins over a fresh suggestion.
       *
       * Once an occurrence exists it carries the answer, including an override
       * the user made this morning. Re-suggesting on every read would silently
       * revert that as soon as anything about the day changed.
       */
      topicKey: commitment?.curriculumTopicKey ?? plan?.curriculumTopicKey ?? null,
      reasons: commitment?.curriculumTopicKey ? [] : (plan?.reasons ?? []),
      alternatives: [suggestion.choice, ...suggestion.alternatives]
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
    };
  });

  const weakTopics = context.topics
    .filter((topic) => context.progress.get(topic.stableKey) === 'needs-revision')
    .map((topic) => ({
      stableKey: topic.stableKey,
      label: topic.topic,
      status: 'needs-revision' as const,
    }));

  return {
    date,
    rhythm: { label: rhythm.label, output: rhythm.output },
    blocks,
    evening: eveningPlan({
      morning: blocks
        .filter((block) => block.commitment)
        .map((block) => ({
          blockId: block.blockId,
          area: block.area,
          commitmentId: block.commitment?.id ?? '',
          title: block.commitment?.title ?? '',
          status: block.commitment?.status ?? 'pending',
        })),
      weakTopics,
    }),
    phase: phase
      ? {
          number: phase.number,
          startDate: phase.startDate,
          endDate: phase.endDate,
          outcome: phase.outcome,
        }
      : null,
    drift: phase
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
    empty: false,
  };
}

/**
 * Swaps the topic a generated commitment is for.
 *
 * ---------------------------------------------------------------------------
 * DOES NOT TOUCH `dueAt`.
 * ---------------------------------------------------------------------------
 * Changing what you are studying at 8am is not changing when the block is. If
 * this ever needed to move the deadline it would have to go through
 * `changeDeadline()` like everything else, which requires a category and a
 * reason -- and the source scanner enforces that there is no other way.
 * ---------------------------------------------------------------------------
 */
export async function overrideTopic(
  input: z.infer<typeof overrideTopicSchema>,
  ownerId: string,
  now: Date = new Date(),
): Promise<void> {
  const commitment = await CommitmentModel.findOne({ _id: input.commitmentId, ownerId }).lean();
  if (!commitment) throw new CurriculumError('No such commitment.', 404);
  if (!commitment.blockId) {
    throw new CurriculumError('That commitment is not part of the study plan.');
  }

  const context = await loadPlanContext(ownerId);
  if (!context) throw new CurriculumError('No curriculum has been imported.', 409);

  const block = context.blocks.find((entry) => entry.blockId === commitment.blockId);
  if (!block) throw new CurriculumError('That block is not in the curriculum.', 409);

  // Captured BEFORE the write. Reading it back afterwards would record the new
  // value as the old one, and the event's whole job is to say what changed.
  const previousKey = commitment.curriculumTopicKey ?? null;

  if (input.stableKey === null) {
    await CommitmentModel.updateOne(
      { _id: input.commitmentId, ownerId },
      {
        $set: {
          curriculumTopicKey: null,
          title: block.area,
          outcome: block.exactActivity,
          topicOverridden: true,
        },
      },
    );
  } else {
    const topic = context.topics.find((entry) => entry.stableKey === input.stableKey);
    if (!topic) throw new CurriculumError('No such topic.', 404);
    if (topic.blockId !== commitment.blockId) {
      // Block 1 is an hour of DSA. Putting a machine-coding build in it would
      // make the block's own record meaningless.
      throw new CurriculumError('That topic belongs to a different block.');
    }

    const label = topic.subTopic.trim() === '' ? topic.topic : `${topic.topic} · ${topic.subTopic}`;

    await CommitmentModel.updateOne(
      { _id: input.commitmentId, ownerId },
      {
        $set: {
          curriculumTopicKey: topic.stableKey,
          title: `${block.area}: ${label}`,
          outcome: topic.practiceRaw.trim() || block.exactActivity,
          topicOverridden: true,
        },
      },
    );
  }

  await appendEvent({
    type: 'PLAN_TOPIC_OVERRIDDEN',
    entityType: 'commitment',
    entityId: input.commitmentId,
    ownerId,
    ts: now,
    source: 'user',
    payload: { from: previousKey, to: input.stableKey },
  });
}

// --- Phases -----------------------------------------------------------------

export interface PhaseView {
  number: number;
  datesRaw: string;
  startDate: DateKey;
  endDate: DateKey;
  originalStartDate: DateKey;
  originalEndDate: DateKey;
  replanned: boolean;
  primaryFocus: string;
  secondaryFocus: string;
  outcome: string;
  rule: string;
  current: boolean;
  drift: Drift;
}

export async function getPhaseView(ownerId: string, now: Date = new Date()): Promise<PhaseView[]> {
  const timeZone = getEnv().APP_TIMEZONE;
  const date = toDateKey(now, timeZone);

  const [phases, topics, progress] = await Promise.all([
    PhaseModel.find({ ownerId }).sort({ number: 1 }).lean(),
    CurriculumTopicModel.find({ ownerId }).lean(),
    TopicProgressModel.find({ ownerId }).lean(),
  ]);

  const status = new Map(progress.map((row) => [row.stableKey, row.status as TopicStatus]));
  const driftTopics = topics.map((topic) => ({
    stableKey: topic.stableKey,
    priority: topic.priority as PriorityBand,
    category: topic.category,
    module: topic.module,
  }));

  return phases.map((phase) => ({
    number: phase.number,
    datesRaw: phase.datesRaw,
    startDate: phase.startDate,
    endDate: phase.endDate,
    originalStartDate: phase.originalStartDate,
    originalEndDate: phase.originalEndDate,
    replanned: phase.replannedAt !== null,
    primaryFocus: phase.primaryFocus,
    secondaryFocus: phase.secondaryFocus,
    outcome: phase.outcome,
    rule: phase.rule,
    current: date >= phase.startDate && date <= phase.endDate,
    drift: computeDrift(
      {
        number: phase.number,
        startDate: phase.startDate,
        endDate: phase.endDate,
        focusCategories: phase.focusCategories,
        focusModules: phase.focusModules,
      },
      driftTopics,
      status,
      date,
    ),
  }));
}

// --- Resources and interview prep ------------------------------------------

/**
 * The resource library.
 *
 * Returns what each resource is and how the workbook says to use it. No
 * counts, no percentages, nothing that could be rendered as a progress bar --
 * see the playlist rule in `src/lib/schemas/curriculum.ts`.
 */
export async function listResources(ownerId: string) {
  const rows = await ResourceModel.find({ ownerId }).sort({ order: 1 }).lean();

  return rows.map((row) => ({
    name: row.name,
    type: row.type,
    use: row.use,
    link: row.link,
    howToUse: row.howToUse,
  }));
}

export interface InterviewPrepView {
  stableKey: string;
  category: string;
  topic: string;
  whatToMaster: string;
  practice: string;
  rehearsalFrom: DateKey;
  /** False before the gate: collect examples now, rehearse later. */
  rehearsalOpen: boolean;
}

export async function listInterviewPrep(
  ownerId: string,
  now: Date = new Date(),
): Promise<InterviewPrepView[]> {
  const date = toDateKey(now, getEnv().APP_TIMEZONE);
  const rows = await InterviewPrepItemModel.find({ ownerId }).sort({ order: 1 }).lean();

  return rows.map((row) => ({
    stableKey: row.stableKey,
    category: row.category,
    topic: row.topic,
    whatToMaster: row.whatToMaster,
    practice: row.practice,
    rehearsalFrom: row.rehearsalFrom,
    // The gate is a date on the document, so the UI renders a fact rather than
    // deciding one.
    rehearsalOpen: date >= row.rehearsalFrom,
  }));
}
