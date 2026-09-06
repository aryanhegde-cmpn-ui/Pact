import 'server-only';

import { appendEvent } from '@/lib/db/events';
import { BlockModel } from '@/lib/db/models/block';
import { CurriculumTopicModel } from '@/lib/db/models/curriculum-topic';
import { InterviewPrepItemModel } from '@/lib/db/models/interview-prep-item';
import { PhaseModel } from '@/lib/db/models/phase';
import { ResourceModel } from '@/lib/db/models/resource';

import type { MappedWorkbook } from './import-map';

/**
 * Writing an imported workbook into the database.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENT, AND IT NEVER TOUCHES PROGRESS.
 * ---------------------------------------------------------------------------
 * Re-running this updates definitions and changes nothing the user recorded
 * about their own work. That is not a nicety: an import that could lose
 * progress is an import nobody dares re-run, and a curriculum that cannot be
 * re-imported is one that drifts out of sync with the spreadsheet it came
 * from until the two are different plans.
 *
 * `topicprogress` is a separate collection keyed on `stableKey`, and nothing
 * in this module writes to it. There is a test asserting exactly that.
 *
 * Two things this deliberately does NOT overwrite, even though it wrote them:
 *
 *   - A phase whose dates were moved by an explicit re-plan. Re-importing
 *     would silently undo a decision someone made and recorded a reason for.
 *   - A practice target corrected by hand from the review list. The whole
 *     point of that list is that the parse was wrong; re-applying the same
 *     wrong parse would make correcting it pointless.
 *
 * Both are reported, so "unchanged" never quietly means "refused".
 * ---------------------------------------------------------------------------
 */

export interface Counts {
  created: number;
  updated: number;
  unchanged: number;
}

export interface ImportReport {
  blocks: Counts;
  phases: Counts;
  topics: Counts;
  resources: Counts;
  interviewPrep: Counts;
  /** Topics whose practice target the parser could not read. */
  flagged: number;
  /**
   * Keys in the database that the workbook no longer has.
   *
   * Reported, NEVER deleted. A removed row may still have progress and history
   * against it, and deleting the definition would leave that progress pointing
   * at nothing while looking like it had simply never happened.
   */
  orphaned: string[];
  /** Phases left alone because a re-plan had moved them. */
  keptReplannedPhases: number[];
  /** Topics whose target was left alone because a person had corrected it. */
  keptCorrectedTargets: string[];
  dryRun: boolean;
}

function emptyCounts(): Counts {
  return { created: 0, updated: 0, unchanged: 0 };
}

/**
 * A comparison that does not depend on key order.
 *
 * Mongoose returns subdocuments with the schema's field order and an object
 * literal has the author's, so a plain `JSON.stringify` comparison reports a
 * change on every run for anything nested -- which would make "unchanged"
 * always zero and the report useless.
 */
function stable(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));

    return `{${entries.map(([key, entry]) => `${key}:${stable(entry)}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

/** Compares only the fields the import owns, so an unrelated field is not "changed". */
function differs(existing: Record<string, unknown>, next: Record<string, unknown>): boolean {
  return Object.keys(next).some((key) => stable(existing[key]) !== stable(next[key]));
}

interface UpsertPlan<T> {
  rows: T[];
  /** The field or fields identifying a row within an owner. */
  keyFields: string[];
  keyOf: (row: T) => Record<string, unknown>;
  /** The fields the import writes on every run. */
  fieldsOf: (row: T) => Record<string, unknown>;
  /** Fields written only when the row is first created. */
  onInsert?: (row: T) => Record<string, unknown>;
}

async function upsertAll<T>(
  model: {
    find: (filter: Record<string, unknown>) => { lean: () => Promise<Record<string, unknown>[]> };
    updateOne: (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => Promise<unknown>;
  },
  ownerId: string,
  plan: UpsertPlan<T>,
  dryRun: boolean,
): Promise<Counts> {
  const counts = emptyCounts();
  const existing = await model.find({ ownerId }).lean();

  const identity = (row: Record<string, unknown>) =>
    plan.keyFields.map((field) => String(row[field])).join('\u0000');

  const byKey = new Map(existing.map((row) => [identity(row), row]));

  for (const row of plan.rows) {
    const key = plan.keyOf(row);
    const fields = plan.fieldsOf(row);
    const current = byKey.get(identity(key));

    if (!current) {
      counts.created += 1;
      if (!dryRun) {
        await model.updateOne(
          { ownerId, ...key },
          { $set: fields, $setOnInsert: { ownerId, ...key, ...(plan.onInsert?.(row) ?? {}) } },
          { upsert: true },
        );
      }
      continue;
    }

    if (!differs(current, fields)) {
      counts.unchanged += 1;
      continue;
    }

    counts.updated += 1;
    if (!dryRun) await model.updateOne({ ownerId, ...key }, { $set: fields }, {});
  }

  return counts;
}

export async function importCurriculum(
  mapped: MappedWorkbook,
  ownerId: string,
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<ImportReport> {
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? new Date();

  const blocks = await upsertAll(
    BlockModel,
    ownerId,
    {
      rows: mapped.blocks,
      keyFields: ['blockId'],
      keyOf: (block) => ({ blockId: block.blockId }),
      fieldsOf: ({ blockId: _blockId, ...rest }) => ({ ...rest }),
    },
    dryRun,
  );

  // --- phases, minus any a re-plan has moved ---------------------------------
  const existingPhases = await PhaseModel.find({ ownerId }).lean();
  const replanned = new Set(
    existingPhases.filter((phase) => phase.replannedAt !== null).map((phase) => phase.number),
  );

  const phases = await upsertAll(
    PhaseModel,
    ownerId,
    {
      rows: mapped.phases,
      keyFields: ['number'],
      keyOf: (phase) => ({ number: phase.number }),
      fieldsOf: (phase) => {
        const { number: _number, startDate, endDate, ...rest } = phase;

        // A re-plan is a recorded decision. Re-importing must not undo it.
        return replanned.has(phase.number) ? { ...rest } : { ...rest, startDate, endDate };
      },
      onInsert: (phase) => ({
        originalStartDate: phase.startDate,
        originalEndDate: phase.endDate,
      }),
    },
    dryRun,
  );

  // --- topics, minus any target corrected by hand ---------------------------
  const existingTopics = await CurriculumTopicModel.find({ ownerId }).lean();
  const corrected = new Set(
    existingTopics
      .filter((topic) => (topic.target as { correctedByHand?: boolean })?.correctedByHand)
      .map((topic) => topic.stableKey),
  );

  const topics = await upsertAll(
    CurriculumTopicModel,
    ownerId,
    {
      rows: mapped.topics,
      keyFields: ['stableKey'],
      keyOf: (topic) => ({ stableKey: topic.stableKey }),
      fieldsOf: (topic) => {
        const { stableKey: _key, target, ...rest } = topic;
        if (corrected.has(topic.stableKey)) return { ...rest };

        return { ...rest, target: { ...target, correctedByHand: false } };
      },
    },
    dryRun,
  );

  const resources = await upsertAll(
    ResourceModel,
    ownerId,
    {
      rows: mapped.resources,
      keyFields: ['name'],
      keyOf: (resource) => ({ name: resource.name }),
      fieldsOf: ({ name: _name, ...rest }) => ({ ...rest }),
    },
    dryRun,
  );

  const interviewPrep = await upsertAll(
    InterviewPrepItemModel,
    ownerId,
    {
      rows: mapped.interviewPrep,
      keyFields: ['stableKey'],
      keyOf: (item) => ({ stableKey: item.stableKey }),
      fieldsOf: ({ stableKey: _key, ...rest }) => ({ ...rest }),
    },
    dryRun,
  );

  const incoming = new Set(mapped.topics.map((topic) => topic.stableKey));
  const orphaned = existingTopics
    .map((topic) => topic.stableKey)
    .filter((key) => !incoming.has(key));

  const report: ImportReport = {
    blocks,
    phases,
    topics,
    resources,
    interviewPrep,
    flagged: mapped.topics.filter((topic) => topic.target.needsReview).length,
    orphaned,
    keptReplannedPhases: mapped.phases
      .map((phase) => phase.number)
      .filter((number) => replanned.has(number)),
    keptCorrectedTargets: mapped.topics
      .map((topic) => topic.stableKey)
      .filter((key) => corrected.has(key)),
    dryRun,
  };

  /**
   * The import is a state change, so it appends an event like every other one.
   *
   * Without it, "why does the plan say November?" has no answer beyond the
   * current contents of a spreadsheet on somebody's laptop.
   */
  if (!dryRun) {
    await appendEvent({
      type: 'CURRICULUM_IMPORTED',
      entityType: 'plan',
      entityId: 'curriculum',
      ownerId,
      ts: now,
      source: 'user',
      payload: {
        topics: mapped.topics.length,
        created: topics.created,
        updated: topics.updated,
        flagged: report.flagged,
        orphaned: orphaned.length,
        phases: mapped.phases.map((phase) => [phase.number, phase.startDate, phase.endDate]),
      },
    });
  }

  return report;
}
