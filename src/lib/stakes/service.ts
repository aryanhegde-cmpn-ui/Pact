import 'server-only';

import {
  adherenceOver,
  evaluateStakes,
  expiryFor,
  type AdherenceWindow,
  type DayRecord,
  type StakeDecision,
} from '@/lib/behavior/stakes';
import { OPEN_STATUSES } from '@/lib/schemas/commitment';
import { appendEvent } from '@/lib/db/events';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { ConsequenceModel } from '@/lib/db/models/consequence';
import { CurriculumTopicModel } from '@/lib/db/models/curriculum-topic';
import { RewardModel } from '@/lib/db/models/reward';
import { TopicProgressModel } from '@/lib/db/models/topic-progress';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getEnv } from '@/lib/env';
import {
  ADHERENCE_WINDOW_DAYS,
  claimRewardSchema,
  createConsequenceSchema,
  createRewardSchema,
  editStakeSchema,
  grantRewardSchema,
  MAX_CONSEQUENCE_WINDOW_DAYS,
  type ConsequenceStatus,
  type DischargeCondition,
  type RewardStatus,
  type TriggerConfig,
  type TriggerKind,
} from '@/lib/schemas/stakes';
import { addDays, toDateKey } from '@/lib/time';
import type { z } from 'zod';

import { getVacationState, vacationDaysBetween } from './vacation';

/**
 * Applying the stakes rules.
 *
 * The rules themselves are pure and live in `src/lib/behavior/stakes.ts`. This
 * reads what they need, calls them, and writes what they decide -- so every
 * rule can be argued with in a unit test and none of them is hidden inside a
 * query.
 *
 * Evaluated ON READ, like miss detection and needs-reckoning. Vercel Hobby has
 * one daily cron, so there is no job to do this, and a stake that only fired
 * when a scheduler happened to run would be a stake that fires late.
 */

export class StakesError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const DUPLICATE_KEY = 11_000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === DUPLICATE_KEY
  );
}

// --- Reading the evidence ---------------------------------------------------

/**
 * Adherence over the rolling window, with vacation days removed.
 *
 * Deliberately its own lean read rather than a call into the Progress page's
 * builder: this runs on every dashboard load, and Progress reads sessions,
 * modules, phases and reckonings it does not need.
 */
export async function adherenceWindow(
  ownerId: string,
  now: Date = new Date(),
): Promise<AdherenceWindow> {
  await connectToDatabase();

  const timeZone = getEnv().APP_TIMEZONE;
  const today = toDateKey(now, timeZone);
  const from = addDays(today, -(ADHERENCE_WINDOW_DAYS - 1));

  const [rows, paused] = await Promise.all([
    CommitmentModel.find(
      { ownerId, blockId: { $ne: null }, occurrenceDate: { $gte: from, $lte: today } },
      { occurrenceDate: 1, status: 1 },
    ).lean(),
    vacationDaysBetween(ownerId, from, today),
  ]);

  const byDate = new Map<string, { total: number; done: number }>();
  for (const row of rows) {
    if (!row.occurrenceDate) continue;

    const entry = byDate.get(row.occurrenceDate) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (row.status === 'done') entry.done += 1;
    byDate.set(row.occurrenceDate, entry);
  }

  const days: DayRecord[] = Array.from({ length: ADHERENCE_WINDOW_DAYS }, (_, offset) => {
    const date = addDays(from, offset);
    const entry = byDate.get(date);

    return {
      date,
      blocksDone: entry?.done ?? 0,
      blocksTotal: entry?.total ?? 0,
      onVacation: paused.has(date),
    };
  });

  return adherenceOver(days);
}

async function topicsDone(ownerId: string): Promise<number> {
  const [topics, progress] = await Promise.all([
    CurriculumTopicModel.find({ ownerId, priority: 'P0' }, { stableKey: 1 }).lean(),
    TopicProgressModel.find({ ownerId, status: 'done' }, { stableKey: 1 }).lean(),
  ]);

  const done = new Set(progress.map((row) => row.stableKey));

  return topics.filter((topic) => done.has(topic.stableKey)).length;
}

// --- Evaluation -------------------------------------------------------------

export interface StakesState {
  onVacation: boolean;
  vacationSince: string | null;
  adherence: AdherenceWindow;
  topicsDone: number;
  rewards: {
    id: string;
    name: string;
    description: string;
    trigger: TriggerKind;
    status: RewardStatus;
    earnedAt: string | null;
  }[];
  consequences: {
    id: string;
    name: string;
    description: string;
    trigger: TriggerKind;
    status: ConsequenceStatus;
    windowDays: number;
    activatedAt: string | null;
    expiresAt: string | null;
    dischargeCondition: DischargeCondition;
    /** Why it fired, in words. Required by the surface. */
    activationReason: string | null;
    /** What ends it, in words. */
    dischargeLabel: string;
  }[];
  /** The one active consequence, if any. */
  active: StakesState['consequences'][number] | null;
  /** Earned and not yet claimed. */
  claimable: StakesState['rewards'];
}

/**
 * Evaluates and applies, then returns the state.
 *
 * Called from the Today read. Applying before returning is what makes the
 * status line true at the moment it is rendered rather than one page load
 * behind.
 */
export async function evaluateAndGetStakes(
  ownerId: string,
  now: Date = new Date(),
): Promise<StakesState> {
  await connectToDatabase();

  const [vacation, adherence, done, rewards, consequences] = await Promise.all([
    getVacationState(ownerId, now),
    adherenceWindow(ownerId, now),
    topicsDone(ownerId),
    RewardModel.find({ ownerId }).sort({ createdAt: 1 }).lean(),
    ConsequenceModel.find({ ownerId }).sort({ createdAt: 1 }).lean(),
  ]);

  const activeRow = consequences.find((row) => row.status === 'active') ?? null;

  /**
   * Whether the commitment that triggered the active consequence is closed.
   *
   * Read only when a condition actually names one, so the ordinary case costs
   * no query.
   */
  let triggeringCommitmentResolved = false;
  const namedCommitment = activeRow?.dischargeCondition?.commitmentId ?? null;
  if (namedCommitment) {
    const commitment = await CommitmentModel.findOne(
      { _id: namedCommitment, ownerId },
      { status: 1 },
    ).lean();

    triggeringCommitmentResolved =
      commitment !== null && !OPEN_STATUSES.includes(commitment.status as never);
  }

  const decisions = evaluateStakes({
    adherence,
    topicsDone: done,
    onVacation: vacation.on,
    now,
    rewards: rewards.map((row) => ({
      id: String(row._id),
      name: row.name,
      trigger: row.trigger as TriggerKind,
      triggerConfig: toConfig(row.triggerConfig),
      status: row.status as RewardStatus,
    })),
    consequences: consequences.map((row) => ({
      id: String(row._id),
      name: row.name,
      trigger: row.trigger as TriggerKind,
      triggerConfig: toConfig(row.triggerConfig),
      status: row.status as ConsequenceStatus,
    })),
    active: activeRow
      ? {
          id: String(activeRow._id),
          name: activeRow.name,
          dischargeCondition: toCondition(activeRow.dischargeCondition),
          expiresAt: activeRow.expiresAt ?? null,
        }
      : null,
    discharge: { adherence, topicsDone: done, triggeringCommitmentResolved },
  });

  if (decisions.length > 0) await applyDecisions(decisions, ownerId, now, consequences);

  return readState(ownerId, now);
}

/** Reads the state without evaluating. For surfaces that must not have side effects. */
export async function readState(ownerId: string, now: Date = new Date()): Promise<StakesState> {
  await connectToDatabase();

  const [vacation, adherence, done, rewards, consequences] = await Promise.all([
    getVacationState(ownerId, now),
    adherenceWindow(ownerId, now),
    topicsDone(ownerId),
    RewardModel.find({ ownerId }).sort({ createdAt: 1 }).lean(),
    ConsequenceModel.find({ ownerId }).sort({ createdAt: 1 }).lean(),
  ]);

  const rewardViews = rewards.map((row) => ({
    id: String(row._id),
    name: row.name,
    description: row.description,
    trigger: row.trigger as TriggerKind,
    status: row.status as RewardStatus,
    earnedAt: row.earnedAt?.toISOString() ?? null,
  }));

  const consequenceViews = consequences.map((row) => ({
    id: String(row._id),
    name: row.name,
    description: row.description,
    trigger: row.trigger as TriggerKind,
    status: row.status as ConsequenceStatus,
    windowDays: row.windowDays,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    dischargeCondition: toCondition(row.dischargeCondition),
    activationReason: row.activationReason ?? null,
    dischargeLabel: describeDischarge(toCondition(row.dischargeCondition)),
  }));

  return {
    onVacation: vacation.on,
    vacationSince: vacation.since,
    adherence,
    topicsDone: done,
    rewards: rewardViews,
    consequences: consequenceViews,
    active: consequenceViews.find((row) => row.status === 'active') ?? null,
    claimable: rewardViews.filter((row) => row.status === 'earned'),
  };
}

function toConfig(
  raw: { thresholdRate?: number | null; topicsDone?: number | null } | null | undefined,
): TriggerConfig {
  return {
    ...(raw?.thresholdRate === null || raw?.thresholdRate === undefined
      ? {}
      : { thresholdRate: raw.thresholdRate }),
    ...(raw?.topicsDone === null || raw?.topicsDone === undefined
      ? {}
      : { topicsDone: raw.topicsDone }),
  };
}

function toCondition(
  raw:
    | {
        kind: string;
        thresholdRate?: number | null;
        commitmentId?: string | null;
        topicsDone?: number | null;
      }
    | null
    | undefined,
): DischargeCondition {
  // A row written before a field existed has neither; absent and null are the
  // same fact here.
  if (!raw) return { kind: 'adherence-recovered' };

  return {
    kind: raw.kind as DischargeCondition['kind'],
    ...(raw.thresholdRate === null || raw.thresholdRate === undefined
      ? {}
      : { thresholdRate: raw.thresholdRate }),
    ...(raw.commitmentId === null || raw.commitmentId === undefined
      ? {}
      : { commitmentId: raw.commitmentId }),
    ...(raw.topicsDone === null || raw.topicsDone === undefined
      ? {}
      : { topicsDone: raw.topicsDone }),
  };
}

function describeDischarge(condition: DischargeCondition): string {
  const percent = (value: number) => `${Math.round(value * 100)}%`;

  switch (condition.kind) {
    case 'adherence-recovered':
      return `Get adherence back to ${percent(condition.thresholdRate ?? 0)} over the last three weeks.`;
    case 'commitment-resolved':
      return 'Finish or answer for the commitment that triggered it.';
    case 'milestone-reached':
      return `Finish ${condition.topicsDone ?? 0} must-master topics.`;
  }
}

async function applyDecisions(
  decisions: StakeDecision[],
  ownerId: string,
  now: Date,
  consequences: { _id: unknown; windowDays: number }[],
): Promise<void> {
  for (const decision of decisions) {
    switch (decision.kind) {
      case 'earn-reward': {
        // Conditional on still being available: two concurrent reads must not
        // both earn it and write two events.
        const result = await RewardModel.updateOne(
          { _id: decision.id, ownerId, status: 'available' },
          { $set: { status: 'earned', earnedAt: now } },
        );

        if ((result.modifiedCount ?? 0) > 0) {
          await appendEvent({
            type: 'REWARD_EARNED',
            entityType: 'stake',
            entityId: decision.id,
            ownerId,
            ts: now,
            source: 'system',
            payload: { reason: decision.reason },
          });
        }
        break;
      }

      case 'activate-consequence': {
        const row = consequences.find((entry) => String(entry._id) === decision.id);
        const expiresAt = expiryFor(now, row?.windowDays ?? 1, MAX_CONSEQUENCE_WINDOW_DAYS);

        try {
          const result = await ConsequenceModel.updateOne(
            { _id: decision.id, ownerId, status: 'pending' },
            {
              $set: {
                status: 'active',
                activatedAt: now,
                expiresAt,
                activationReason: decision.reason,
              },
            },
          );

          if ((result.modifiedCount ?? 0) > 0) {
            await appendEvent({
              type: 'CONSEQUENCE_ACTIVATED',
              entityType: 'stake',
              entityId: decision.id,
              ownerId,
              ts: now,
              source: 'system',
              payload: { reason: decision.reason, expiresAt: expiresAt.toISOString() },
            });
          }
        } catch (error) {
          /**
           * The unique partial index refused it: another invocation activated
           * something first. That is the no-stacking rule working, not a
           * failure -- and it is why the rule is an index rather than the
           * in-memory check above, which two concurrent reads both pass.
           */
          if (!isDuplicateKeyError(error)) throw error;

          await appendEvent({
            type: 'CONSEQUENCE_SUPPRESSED',
            entityType: 'stake',
            entityId: decision.id,
            ownerId,
            ts: now,
            source: 'system',
            payload: { reason: 'Another consequence became active first.' },
          });
        }
        break;
      }

      case 'suppress-consequence':
        await appendEvent({
          type: 'CONSEQUENCE_SUPPRESSED',
          entityType: 'stake',
          entityId: decision.id,
          ownerId,
          ts: now,
          source: 'system',
          payload: { reason: decision.reason },
        });
        break;

      case 'discharge-consequence': {
        const result = await ConsequenceModel.updateOne(
          { _id: decision.id, ownerId, status: 'active' },
          { $set: { status: 'discharged', dischargedAt: now } },
        );

        if ((result.modifiedCount ?? 0) > 0) {
          await appendEvent({
            type: 'CONSEQUENCE_DISCHARGED',
            entityType: 'stake',
            entityId: decision.id,
            ownerId,
            ts: now,
            source: 'system',
            payload: { reason: decision.reason },
          });
        }
        break;
      }

      case 'expire-consequence': {
        const result = await ConsequenceModel.updateOne(
          { _id: decision.id, ownerId, status: 'active' },
          { $set: { status: 'expired' } },
        );

        if ((result.modifiedCount ?? 0) > 0) {
          await appendEvent({
            type: 'CONSEQUENCE_EXPIRED',
            entityType: 'stake',
            entityId: decision.id,
            ownerId,
            ts: now,
            source: 'system',
            payload: { reason: decision.reason },
          });
        }
        break;
      }
    }
  }
}

// --- Configuration, by the overseer only ------------------------------------

export async function createReward(
  input: unknown,
  ownerId: string,
  createdBy: string,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const parsed = createRewardSchema.parse(input);
  await connectToDatabase();

  const created = await RewardModel.create({
    ownerId,
    createdBy,
    ...parsed,
    triggerConfig: {
      thresholdRate: parsed.triggerConfig.thresholdRate ?? null,
      topicsDone: parsed.triggerConfig.topicsDone ?? null,
    },
    status: 'available',
    createdAt: now,
  });

  await appendEvent({
    type: 'REWARD_CONFIGURED',
    entityType: 'stake',
    entityId: String(created._id),
    ownerId,
    ts: now,
    source: 'user',
    payload: { name: parsed.name, trigger: parsed.trigger, createdBy },
  });

  return { id: String(created._id) };
}

export async function createConsequence(
  input: unknown,
  ownerId: string,
  createdBy: string,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const parsed = createConsequenceSchema.parse(input);
  await connectToDatabase();

  const created = await ConsequenceModel.create({
    ownerId,
    createdBy,
    name: parsed.name,
    description: parsed.description,
    trigger: parsed.trigger,
    triggerConfig: {
      thresholdRate: parsed.triggerConfig.thresholdRate ?? null,
      topicsDone: parsed.triggerConfig.topicsDone ?? null,
    },
    windowDays: parsed.windowDays,
    dischargeCondition: {
      kind: parsed.dischargeCondition.kind,
      thresholdRate: parsed.dischargeCondition.thresholdRate ?? null,
      commitmentId: parsed.dischargeCondition.commitmentId ?? null,
      topicsDone: parsed.dischargeCondition.topicsDone ?? null,
    },
    status: 'pending',
    createdAt: now,
  });

  await appendEvent({
    type: 'CONSEQUENCE_CONFIGURED',
    entityType: 'stake',
    entityId: String(created._id),
    ownerId,
    ts: now,
    source: 'user',
    payload: {
      name: parsed.name,
      trigger: parsed.trigger,
      windowDays: parsed.windowDays,
      dischargeKind: parsed.dischargeCondition.kind,
      createdBy,
    },
  });

  return { id: String(created._id) };
}

/**
 * Editing.
 *
 * Name and description only. Status is derived from triggers, discharge and
 * expiry, and letting it be set by hand would make "discharged" something an
 * overseer could grant rather than something the primary earns.
 */
export async function editStake(
  kind: 'reward' | 'consequence',
  id: string,
  input: unknown,
  ownerId: string,
): Promise<void> {
  const parsed = editStakeSchema.parse(input);
  await connectToDatabase();

  // Branched rather than assigned to a union: the two models' `updateOne`
  // signatures are not compatible with each other, and a cast here would be
  // hiding that rather than answering it.
  const result =
    kind === 'reward'
      ? await RewardModel.updateOne({ _id: id, ownerId }, { $set: parsed })
      : await ConsequenceModel.updateOne({ _id: id, ownerId }, { $set: parsed });

  if ((result.matchedCount ?? 0) === 0) throw new StakesError('No such stake.', 404);
}

/** The overseer granting a `manual-grant` reward. */
export async function grantReward(
  input: unknown,
  ownerId: string,
  now: Date = new Date(),
): Promise<void> {
  const { rewardId } = grantRewardSchema.parse(input);
  await connectToDatabase();

  const result = await RewardModel.updateOne(
    { _id: rewardId, ownerId, trigger: 'manual-grant', status: 'available' },
    { $set: { status: 'earned', earnedAt: now } },
  );

  if ((result.modifiedCount ?? 0) === 0) {
    throw new StakesError('That reward is not available to grant.', 409);
  }

  await appendEvent({
    type: 'REWARD_EARNED',
    entityType: 'stake',
    entityId: rewardId,
    ownerId,
    ts: now,
    source: 'user',
    payload: { reason: 'Granted by the overseer.' },
  });
}

/**
 * The primary claiming a reward they have earned.
 *
 * The one stake action the primary may take, and it can only move `earned` to
 * `claimed`. It cannot earn anything: the condition on `status: 'earned'` is
 * what stops a claim request being a way to award yourself.
 */
export async function claimReward(
  input: unknown,
  ownerId: string,
  now: Date = new Date(),
): Promise<void> {
  const { rewardId } = claimRewardSchema.parse(input);
  await connectToDatabase();

  const result = await RewardModel.updateOne(
    { _id: rewardId, ownerId, status: 'earned' },
    { $set: { status: 'claimed', claimedAt: now } },
  );

  if ((result.modifiedCount ?? 0) === 0) {
    throw new StakesError('That reward has not been earned.', 409);
  }

  await appendEvent({
    type: 'REWARD_CLAIMED',
    entityType: 'stake',
    entityId: rewardId,
    ownerId,
    ts: now,
    source: 'user',
    payload: {},
  });
}

export type EditStakeInput = z.infer<typeof editStakeSchema>;
