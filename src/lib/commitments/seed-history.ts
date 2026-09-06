import 'server-only';

import { changeDeadline } from '@/lib/commitments/deadline';
import { appendEvent } from '@/lib/db/events';
import { CommitmentModel } from '@/lib/db/models/commitment';
import type { Priority } from '@/lib/schemas/commitment';
import type { DeadlineChangeCategory, MissReason, RecoveryAction } from '@/lib/schemas/reckoning';
import { addDays, toDateKey, zonedTimeToUtc, type DateKey } from '@/lib/time';

/**
 * Synthetic history for developing the behaviour engine against.
 *
 * The patterns are the point. A uniform random history teaches the engine
 * nothing, because the whole job is recognising SHAPES of failure -- the person
 * who always ships but always a day late is a different problem from the person
 * who abandons quietly on Friday afternoons, and both look identical in
 * aggregate completion rate.
 *
 * Every commitment here goes through the same event log as a real one, so what
 * the engine reads is indistinguishable from real history apart from `source`.
 */

export type PatternName =
  'on-track' | 'chronic-postponer' | 'late-night-misser' | 'steady' | 'mixed';

export interface SeedPattern {
  /** Chance a commitment is completed at all. */
  completionRate: number;
  /** Given completion, chance it lands after the deadline. */
  lateRate: number;
  /** Chance the deadline gets moved at least once before resolution. */
  postponeRate: number;
  /** Given a postponement, how many times on average. */
  meanPostponements: number;
  /** Chance an unfinished commitment is explicitly abandoned rather than left open. */
  abandonRate: number;
  /** Of postponements, the share that happen only after the deadline has passed. */
  postponeAfterMissRate: number;
  /** Hours of the local day this persona schedules work into. */
  hours: number[];
}

export const PATTERNS: Record<Exclude<PatternName, 'mixed'>, SeedPattern> = {
  /**
   * A well-behaved history. Most deadlines are met, on time.
   *
   * This fixture exists so that "the detector found nothing" is a result that
   * can be distinguished from "the detector is broken". Every other persona
   * here is pathological by construction, and a pattern-finder run only
   * against those looks identical whether it works or always fires. The
   * correct output for this data is close to silence, and a behavioural
   * feature that produces alarming output against it has a bug.
   *
   * Not zero misses: a history with no misses at all is unrealistic, and would
   * not exercise the miss path at all.
   */
  'on-track': {
    completionRate: 0.97,
    lateRate: 0.04,
    postponeRate: 0.06,
    meanPostponements: 1,
    abandonRate: 0.6,
    // Replans ahead of time when at all, which is not avoidance.
    postponeAfterMissRate: 0,
    hours: [8, 9, 10, 14],
  },

  /**
   * Ships eventually, but the deadline moves repeatedly first. Completion rate
   * looks respectable; the postponement chain is where the truth is.
   */
  'chronic-postponer': {
    completionRate: 0.78,
    lateRate: 0.62,
    postponeRate: 0.72,
    meanPostponements: 2.4,
    abandonRate: 0.35,
    // The signature: the deadline moves because it was already blown.
    postponeAfterMissRate: 0.7,
    hours: [10, 11, 14, 16],
  },

  /**
   * Commits to late-evening work and misses it. The signal is time-of-day, not
   * volume -- daytime commitments in this profile do fine.
   */
  'late-night-misser': {
    completionRate: 0.55,
    lateRate: 0.48,
    postponeRate: 0.3,
    meanPostponements: 1.3,
    abandonRate: 0.2,
    postponeAfterMissRate: 0.45,
    hours: [21, 22, 23],
  },

  /** A control: mostly done, mostly on time. */
  steady: {
    completionRate: 0.92,
    lateRate: 0.12,
    postponeRate: 0.14,
    meanPostponements: 1.1,
    abandonRate: 0.5,
    // Reschedules ahead of time, which is a different behaviour entirely.
    postponeAfterMissRate: 0.1,
    hours: [9, 11, 15],
  },
};

const TITLES = [
  ['Draft the weekly summary', 'The summary is written and sent'],
  ['Review pull requests', 'The review queue is empty'],
  ['Update the budget sheet', 'This month’s figures are entered'],
  ['Call the bank', 'The account question is resolved'],
  ['Write the design note', 'The note is shared with the team'],
  ['Clear the inbox', 'Inbox is at zero'],
  ['Prepare tomorrow’s agenda', 'Tomorrow is planned'],
  ['Fix the failing test', 'CI is green'],
  ['Read the spec', 'I can explain the spec to someone else'],
  ['Book the appointment', 'The appointment is in the calendar'],
] as const;

const PRIORITIES: Priority[] = ['must-win', 'important', 'maintenance'];

/** Free-text reason paired with the category it belongs to. */
/**
 * Reckoning answers paired with the recovery they lead to.
 *
 * Matched pairs rather than independent draws, so the synthetic history is
 * coherent: "too vague" leading to "schedule a start session" is a shape the
 * real flow would never produce.
 */
/** Concrete next actions, for the recoveries that require one. */
const SEED_NEXT_ACTIONS = [
  'Write the first paragraph',
  'Open the file and list the sections',
  'Send the one email that unblocks it',
  'Sketch the outline on paper',
  'Read the first page of the spec',
] as const;

const SEED_RECKONINGS: readonly (readonly [MissReason, RecoveryAction])[] = [
  ['underestimated', 'reduce-scope'],
  ['too-vague', 'define-next-action'],
  ['avoided', 'schedule-start-session'],
  ['didnt-know-how-to-start', 'define-starting-action'],
  ['waiting-on-someone', 'mark-blocked'],
  ['higher-priority-appeared', 'reduce-scope'],
  ['perfectionism', 'lower-quality-bar'],
  ['forgot', 'schedule-start-session'],
] as const;

const POSTPONEMENT_REASONS: readonly (readonly [string, DeadlineChangeCategory])[] = [
  ['Ran out of time', 'underestimated'],
  ['Underestimated how long it would take', 'underestimated'],
  ['Something else came up', 'priority-changed'],
  ['A more urgent thing landed', 'priority-changed'],
  ['Waiting on someone else', 'blocked-externally'],
  ['Kept putting it off', 'avoidance'],
  ['Did not want to start it', 'avoidance'],
  ['The scope grew', 'scope-changed'],
  ['Replanned the week', 'deliberate-replan'],
] as const;

/**
 * Deterministic PRNG.
 *
 * Seeded so a run is reproducible: debugging the behaviour engine against
 * history that changes every time you regenerate it is not debugging.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export interface SeedOptions {
  /** The primary this synthetic history belongs to. */
  ownerId: string;
  pattern: PatternName;
  days: number;
  perDay: number;
  timeZone: string;
  seed?: number;
  now?: Date;
}

export interface SeedSummary {
  commitments: number;
  events: number;
  completed: number;
  late: number;
  missed: number;
  abandoned: number;
  postponements: number;
}

export async function seedHistory(options: SeedOptions): Promise<SeedSummary> {
  const now = options.now ?? new Date();
  const random = makeRandom(options.seed ?? 20_260_905);
  const summary: SeedSummary = {
    commitments: 0,
    events: 0,
    completed: 0,
    late: 0,
    missed: 0,
    abandoned: 0,
    postponements: 0,
  };

  const today = toDateKey(now, options.timeZone);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

  for (let dayOffset = options.days; dayOffset >= 1; dayOffset -= 1) {
    const date: DateKey = addDays(today, -dayOffset);

    // A person does not commit to the same number of things every day.
    const count = Math.max(1, Math.round(options.perDay * (0.5 + random())));

    for (let i = 0; i < count; i += 1) {
      const pattern =
        options.pattern === 'mixed'
          ? PATTERNS[pick(['chronic-postponer', 'late-night-misser', 'steady'] as const)]
          : PATTERNS[options.pattern];

      await seedOne(date, pattern, options.timeZone, options.ownerId, random, pick, summary);
    }
  }

  return summary;
}

async function seedOne(
  date: DateKey,
  pattern: SeedPattern,
  timeZone: string,
  ownerId: string,
  random: () => number,
  pick: <T>(items: readonly T[]) => T,
  summary: SeedSummary,
): Promise<void> {
  const [title, outcome] = pick(TITLES);
  const hour = pick(pattern.hours);
  const originalDueAt = zonedTimeToUtc(date, `${String(hour).padStart(2, '0')}:00`, timeZone);
  const estimateMinutes = pick([15, 30, 45, 60, 90, 120]);
  const createdAt = new Date(originalDueAt.getTime() - (2 + random() * 20) * 3_600_000);

  const doc = await CommitmentModel.create({
    title,
    outcome,
    dueAt: originalDueAt,
    originalDueAt,
    estimateMinutes,
    status: 'pending',
    priority: pick(PRIORITIES),
    seriesId: null,
    occurrenceDate: null,
    createdAt,
    startedAt: null,
    completedAt: null,
    notes: '',
    synthetic: true,
    ownerId,
  });

  const entityId = String(doc._id);
  summary.commitments += 1;

  await appendEvent({
    type: 'COMMITMENT_CREATED',
    entityType: 'commitment',
    entityId,
    ownerId,
    ts: createdAt,
    source: 'seed',
    payload: { title, outcome, estimateMinutes },
  });
  await appendEvent({
    type: 'DEADLINE_SET',
    entityType: 'commitment',
    entityId,
    ownerId,
    ts: createdAt,
    source: 'seed',
    payload: { dueAt: originalDueAt.toISOString() },
  });
  summary.events += 2;

  // --- postponements ------------------------------------------------------
  let dueAt = originalDueAt;
  if (random() < pattern.postponeRate) {
    const times = Math.max(1, Math.round(pattern.meanPostponements * (0.5 + random())));

    for (let n = 0; n < times; n += 1) {
      const previous = dueAt;

      /**
       * Roughly half of postponements happen AFTER the deadline has already
       * passed, which is the characteristic shape of a chronic postponer:
       * the deadline is not moved in anticipation, it is moved in response to
       * having already blown it.
       *
       * That produces a DEADLINE_MISSED against the old deadline as well as
       * the final one -- the multi-miss history the behaviour engine has to be
       * able to see. Only possible since the uniqueness key gained `ts`.
       */
      const movedAfterMissing = random() < pattern.postponeAfterMissRate;

      if (movedAfterMissing) {
        await appendEvent({
          type: 'DEADLINE_MISSED',
          entityType: 'commitment',
          entityId,
          ownerId,
          ts: previous,
          source: 'seed',
          payload: { dueAt: previous.toISOString(), postponedAfterwards: true },
        });
        summary.missed += 1;
        summary.events += 1;
      }

      const movedAt = movedAfterMissing
        ? new Date(previous.getTime() + (0.5 + random() * 8) * 3_600_000)
        : new Date(previous.getTime() - random() * 3_600_000);
      dueAt = new Date(previous.getTime() + (12 + random() * 36) * 3_600_000);

      /**
       * A missed deadline must be reckoned with before it can move.
       *
       * That is the product rule, and the seed obeys it rather than working
       * around it -- synthetic history that could not have been produced by
       * the real app is worse than none, because the behaviour engine would
       * learn from a shape the app cannot generate.
       *
       * It is also the more realistic sequence: you miss it, you answer for
       * it, and then you pick a new date. And it gives the engine the
       * reckoning data it needs, which a bare postponement chain does not.
       */
      if (movedAfterMissing) {
        const [reckonReason, recoveryAction] = pick(SEED_RECKONINGS);
        const reckonedAt = new Date(previous.getTime() + 0.25 * 3_600_000);

        await appendEvent({
          type: 'RECKONING_SUBMITTED',
          entityType: 'commitment',
          entityId,
          ownerId,
          // Stamped at the missed deadline, like the miss itself: that is what
          // the uniqueness key means and what makes a second miss recordable.
          ts: previous,
          source: 'seed',
          payload: {
            missedDeadline: previous.toISOString(),
            completed: false,
            reason: reckonReason,
            note: null,
            recovery: recoveryAction,
            submittedAt: reckonedAt.toISOString(),
          },
        });
        await appendEvent({
          type: 'RECOVERY_ACTION_SELECTED',
          entityType: 'commitment',
          entityId,
          ownerId,
          ts: reckonedAt,
          source: 'seed',
          payload: { action: recoveryAction, reason: reckonReason },
        });
        /**
         * Apply the recovery's effect, not just its record.
         *
         * `define-next-action` GATES rescheduling until the field is set --
         * that is the whole point of it. Recording the choice without the
         * effect produces history the real app could not have created, and
         * the deadline change immediately below would be refused.
         */
        if (
          recoveryAction === 'define-next-action' ||
          recoveryAction === 'define-starting-action'
        ) {
          await CommitmentModel.updateOne(
            { _id: entityId, ownerId },
            { $set: { nextAction: pick(SEED_NEXT_ACTIONS) } },
          );
        }

        summary.events += 2;
      }

      // Through the one permitted writer, exactly as a real postponement is.
      // Seeding is not a licence to write `dueAt` directly.
      /**
       * Reason and category are picked together, so the postponement view has
       * something coherent to summarise. A persona whose categories are random
       * cannot demonstrate "this person always says avoidance", which is the
       * pattern that view exists to surface.
       */
      const [reason, category] = pick(POSTPONEMENT_REASONS);

      await changeDeadline(
        entityId,
        { newDueAt: dueAt, reason, category },
        ownerId,
        movedAt,
        'seed',
      );
      void previous;
      summary.postponements += 1;
      summary.events += 1;
    }
  }

  // --- resolution ---------------------------------------------------------
  const completed = random() < pattern.completionRate;

  if (completed) {
    const late = random() < pattern.lateRate;
    const completedAt = late
      ? new Date(dueAt.getTime() + (0.5 + random() * 30) * 3_600_000)
      : new Date(dueAt.getTime() - random() * estimateMinutes * 60_000);
    const startedAt = new Date(completedAt.getTime() - estimateMinutes * 60_000 * (0.6 + random()));

    await CommitmentModel.updateOne(
      { _id: entityId, ownerId },
      { $set: { status: 'done', startedAt, completedAt } },
    );

    await appendEvent({
      type: 'COMMITMENT_STARTED',
      entityType: 'commitment',
      entityId,
      ownerId,
      ts: startedAt,
      source: 'seed',
      payload: {},
    });

    if (late) {
      // The miss is a fact in its own right and is logged at the deadline,
      // even though the work was eventually finished.
      await appendEvent({
        type: 'DEADLINE_MISSED',
        entityType: 'commitment',
        entityId,
        ownerId,
        ts: dueAt,
        source: 'seed',
        payload: { dueAt: dueAt.toISOString() },
      });
      summary.missed += 1;
      summary.late += 1;
      summary.events += 1;
    }

    await appendEvent({
      type: 'COMMITMENT_COMPLETED',
      entityType: 'commitment',
      entityId,
      ownerId,
      ts: completedAt,
      source: 'seed',
      payload: {
        dueAt: dueAt.toISOString(),
        originalDueAt: originalDueAt.toISOString(),
        lateAgainstDueAt: late,
        lateAgainstOriginal: completedAt > originalDueAt,
        workedMinutes: Math.round((completedAt.getTime() - startedAt.getTime()) / 60_000),
      },
    });

    summary.completed += 1;
    summary.events += 2;
    return;
  }

  // Not completed: the deadline passed.
  await appendEvent({
    type: 'DEADLINE_MISSED',
    entityType: 'commitment',
    entityId,
    ownerId,
    ts: dueAt,
    source: 'seed',
    payload: { dueAt: dueAt.toISOString() },
  });
  summary.missed += 1;
  summary.events += 1;

  if (random() < pattern.abandonRate) {
    const abandonedAt = new Date(dueAt.getTime() + (1 + random() * 48) * 3_600_000);

    await CommitmentModel.updateOne({ _id: entityId, ownerId }, { $set: { status: 'abandoned' } });
    await appendEvent({
      type: 'COMMITMENT_ABANDONED',
      entityType: 'commitment',
      entityId,
      ownerId,
      ts: abandonedAt,
      source: 'seed',
      payload: {
        reason: pick(['No longer relevant', 'Decided not to', 'Overtaken by events']),
        dueAt: dueAt.toISOString(),
      },
    });

    summary.abandoned += 1;
    summary.events += 1;
  }
  // Otherwise it stays pending and overdue -- which is itself a pattern worth
  // having in the data.
}

/**
 * There is deliberately NO cleanup function here.
 *
 * Removing seeded rows would mean an update-or-delete path against the event
 * log inside `src/`, and the append-only guarantee is only worth anything if it
 * has no exceptions -- an escape hatch "just for fixtures" is exactly how one
 * appears in application code six months later. Resetting a development
 * database is `npm run seed:history -- --reset`, which drops the collections
 * outright from the script, refuses to run in production, and is a database
 * reset rather than a rewrite of history.
 */
