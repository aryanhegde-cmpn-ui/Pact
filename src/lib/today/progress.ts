import 'server-only';

import { computeDrift } from '@/lib/behavior/drift';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { CurriculumTopicModel } from '@/lib/db/models/curriculum-topic';
import { EventModel } from '@/lib/db/models/event';
import { FocusSessionModel } from '@/lib/db/models/focus-session';
import { PhaseModel } from '@/lib/db/models/phase';
import { TopicProgressModel } from '@/lib/db/models/topic-progress';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getEnv } from '@/lib/env';
import type { PriorityBand, TopicStatus } from '@/lib/schemas/curriculum';
import { MISS_REASON_LABELS, type MissReason } from '@/lib/schemas/reckoning';
import { addDays, toDateKey, type DateKey } from '@/lib/time';

/**
 * History.
 *
 * ---------------------------------------------------------------------------
 * ADHERENCE IS A RATE OVER A WINDOW. NOT A STREAK.
 * ---------------------------------------------------------------------------
 * "17 of the last 21 days" is the headline, and there is no consecutive-day
 * counter anywhere near it. A consecutive count has a cliff: miss one day at
 * forty and it reads zero, which is a lie about adherence and the documented
 * trigger for abandoning the app entirely. It also rewards the wrong thing --
 * protecting a run means avoiding hard commitments rather than keeping them.
 *
 * docs/product.md permits a consecutive count as a SECONDARY stat. It is
 * computed here and returned, deliberately named `currentRun` rather than
 * "streak", and it gates nothing. If it ever becomes a headline, that is a
 * product regression and there is a test that fails on it.
 *
 * None of this appears on Today. Today is the warm surface and this is the
 * cold one; putting a trend line above the morning's work would make the first
 * thing seen each day a judgement of the last three weeks.
 * ---------------------------------------------------------------------------
 */

/** The rolling window. Three weeks: long enough to survive one bad day. */
export const ADHERENCE_WINDOW_DAYS = 21;

export interface DayAdherence {
  date: DateKey;
  blocksDone: number;
  blocksTotal: number;
  /** True when every block that existed that day was kept. */
  kept: boolean;
}

export interface ProgressView {
  window: { days: number; kept: number; of: number; rate: number };
  /**
   * Consecutive days kept, right now.
   *
   * A secondary stat, by name and by placement. It gates nothing.
   */
  currentRun: number;
  days: DayAdherence[];
  topicsByModule: {
    module: string;
    category: string;
    total: number;
    done: number;
    needsRevision: number;
    inProgress: number;
  }[];
  estimateVsActual: {
    sessions: number;
    plannedMinutes: number;
    actualMinutes: number;
    /** actual / planned. Above 1 means the estimates are optimistic. */
    ratio: number | null;
  };
  /** Where the time went, by session kind. The planning-versus-execution split. */
  timeByKind: { kind: string; minutes: number }[];
  phases: { number: number; elapsed: number; done: number; status: string }[];
  reckoningReasons: { reason: MissReason; label: string; count: number }[];
}

export async function buildProgress(
  ownerId: string,
  now: Date = new Date(),
): Promise<ProgressView> {
  await connectToDatabase();

  const timeZone = getEnv().APP_TIMEZONE;
  const today = toDateKey(now, timeZone);
  const from = addDays(today, -(ADHERENCE_WINDOW_DAYS - 1));

  const [blockRows, topics, progressRows, sessions, phaseRows, reckonings] = await Promise.all([
    CommitmentModel.find(
      { ownerId, blockId: { $ne: null }, occurrenceDate: { $gte: from, $lte: today } },
      { occurrenceDate: 1, status: 1, blockId: 1 },
    ).lean(),
    CurriculumTopicModel.find({ ownerId }).sort({ order: 1 }).lean(),
    TopicProgressModel.find({ ownerId }).lean(),
    FocusSessionModel.find(
      { ownerId, endedAt: { $ne: null } },
      { plannedMinutes: 1, actualMinutes: 1, kind: 1, outcome: 1 },
    )
      .sort({ endedAt: -1 })
      .limit(200)
      .lean(),
    PhaseModel.find({ ownerId }).sort({ number: 1 }).lean(),
    EventModel.find({ ownerId, type: 'RECKONING_SUBMITTED' }, { payload: 1 })
      .sort({ ts: -1 })
      .limit(200)
      .lean(),
  ]);

  // --- adherence -------------------------------------------------------------
  const byDate = new Map<DateKey, { total: number; done: number }>();
  for (const row of blockRows) {
    const key = row.occurrenceDate;
    if (!key) continue;

    const entry = byDate.get(key) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (row.status === 'done') entry.done += 1;
    byDate.set(key, entry);
  }

  const days: DayAdherence[] = Array.from({ length: ADHERENCE_WINDOW_DAYS }, (_, offset) => {
    const date = addDays(from, offset);
    const entry = byDate.get(date);

    return {
      date,
      blocksDone: entry?.done ?? 0,
      blocksTotal: entry?.total ?? 0,
      // A day with no blocks is not a kept day. Counting it as one would let an
      // empty week read as perfect adherence.
      kept: entry !== undefined && entry.total > 0 && entry.done === entry.total,
    };
  });

  const withBlocks = days.filter((day) => day.blocksTotal > 0);
  const kept = withBlocks.filter((day) => day.kept).length;

  /**
   * Days kept in an unbroken run ending today.
   *
   * Counted backwards from the most recent day that HAD blocks, so a rest day
   * with nothing scheduled neither breaks the run nor extends it.
   */
  let currentRun = 0;
  for (const day of [...withBlocks].reverse()) {
    if (!day.kept) break;
    currentRun += 1;
  }

  // --- topics ----------------------------------------------------------------
  const status = new Map(progressRows.map((row) => [row.stableKey, row.status as TopicStatus]));
  const modules = new Map<string, ProgressView['topicsByModule'][number]>();

  for (const topic of topics) {
    const key = `${topic.category}/${topic.module}`;
    const entry = modules.get(key) ?? {
      module: topic.module,
      category: topic.category,
      total: 0,
      done: 0,
      needsRevision: 0,
      inProgress: 0,
    };

    entry.total += 1;
    const state = status.get(topic.stableKey) ?? 'not-started';
    if (state === 'done') entry.done += 1;
    if (state === 'needs-revision') entry.needsRevision += 1;
    if (state === 'in-progress') entry.inProgress += 1;

    modules.set(key, entry);
  }

  // --- sessions --------------------------------------------------------------
  const planned = sessions.reduce((sum, row) => sum + (row.plannedMinutes ?? 0), 0);
  const actual = sessions.reduce((sum, row) => sum + (row.actualMinutes ?? 0), 0);

  const kinds = new Map<string, number>();
  for (const row of sessions) {
    kinds.set(row.kind, (kinds.get(row.kind) ?? 0) + (row.actualMinutes ?? 0));
  }

  // --- reasons ---------------------------------------------------------------
  const reasons = new Map<MissReason, number>();
  for (const event of reckonings) {
    const reason = (event.payload as { reason?: MissReason })?.reason;
    if (!reason) continue;
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  const driftTopics = topics.map((topic) => ({
    stableKey: topic.stableKey,
    priority: topic.priority as PriorityBand,
    category: topic.category,
    module: topic.module,
  }));

  return {
    window: {
      days: ADHERENCE_WINDOW_DAYS,
      kept,
      of: withBlocks.length,
      rate: withBlocks.length === 0 ? 0 : kept / withBlocks.length,
    },
    currentRun,
    days,
    topicsByModule: [...modules.values()].filter((entry) => entry.total > 0),
    estimateVsActual: {
      sessions: sessions.length,
      plannedMinutes: planned,
      actualMinutes: actual,
      ratio: planned === 0 ? null : actual / planned,
    },
    timeByKind: [...kinds.entries()]
      .map(([kind, minutes]) => ({ kind, minutes }))
      .sort((a, b) => b.minutes - a.minutes),
    phases: phaseRows.map((phase) => {
      const drift = computeDrift(
        {
          number: phase.number,
          startDate: phase.startDate,
          endDate: phase.endDate,
          focusCategories: phase.focusCategories,
          focusModules: phase.focusModules,
        },
        driftTopics,
        status,
        today,
      );

      return {
        number: phase.number,
        elapsed: drift.elapsedFraction,
        done: drift.doneFraction,
        status: drift.status,
      };
    }),
    reckoningReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, label: MISS_REASON_LABELS[reason], count }))
      .sort((a, b) => b.count - a.count),
  };
}
