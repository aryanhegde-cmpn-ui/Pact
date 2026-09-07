import 'server-only';

import { CommitmentModel } from '@/lib/db/models/commitment';
import { connectToDatabase } from '@/lib/db/mongoose';
import { loadPlanContext } from '@/lib/curriculum/plan';
import { rhythmFor } from '@/lib/curriculum/rhythm';
import { getEnv } from '@/lib/env';
import type { BlockId } from '@/lib/schemas/curriculum';
import { addDays, toDateKey, type DateKey } from '@/lib/time';

/**
 * Seven days, readable without opening any of them.
 *
 * That constraint decides the shape. A week view you have to expand day by day
 * is a worse calendar; the value here is seeing the SHAPE of the week -- which
 * days the rhythm makes heavy, where the blocks went, and where the gaps are.
 * So every day is one row, and one row holds the date, the day's slant and
 * three marks.
 *
 * It reads the commitments that already exist and does NOT materialise. A week
 * view is a read, and materialising a fortnight because someone glanced at
 * Thursday would make browsing the plan write to it.
 */

export interface WeekBlock {
  blockId: BlockId;
  area: string;
  startTime: string | null;
  /** `done`, `abandoned`, `in-progress`, `pending`, or `not-generated`. */
  state: string;
  topicLabel: string | null;
}

export interface WeekDay {
  date: DateKey;
  /** Mon, Tue... from the workbook's own rhythm table. */
  label: string;
  /** The rhythm's Output column: what the day is meant to produce. */
  output: string;
  /** Per-block slant, in block order. */
  slants: string[];
  blocks: WeekBlock[];
  blocksDone: number;
  /** Non-block commitments due that day. Counted, not listed. */
  otherDue: number;
  isToday: boolean;
  isPast: boolean;
}

export async function buildWeek(ownerId: string, now: Date = new Date()): Promise<WeekDay[]> {
  await connectToDatabase();

  const timeZone = getEnv().APP_TIMEZONE;
  const today = toDateKey(now, timeZone);
  const context = await loadPlanContext(ownerId, now);

  /**
   * The week starts today, not on Monday.
   *
   * A Monday-anchored week spends Sunday showing six days that have already
   * happened. What is useful on a Thursday is Thursday to Wednesday.
   */
  const days = Array.from({ length: 7 }, (_, offset) => addDays(today, offset));
  const last = days[6] ?? today;

  const rows = await CommitmentModel.find({
    ownerId,
    dueAt: {
      $gte: new Date(`${today}T00:00:00.000Z`),
      // Widened either side, then filtered to the exact local day below: the
      // stored field is a UTC instant and the window is local dates.
      $lt: new Date(new Date(`${last}T00:00:00.000Z`).getTime() + 2 * 86_400_000),
    },
  })
    .sort({ dueAt: 1 })
    .lean();

  const byDay = new Map<DateKey, typeof rows>();
  for (const row of rows) {
    const key = toDateKey(row.dueAt, timeZone);
    byDay.set(key, [...(byDay.get(key) ?? []), row]);
  }

  const studyBlocks = (context?.blocks ?? []).filter((block) => block.blockId.startsWith('block-'));
  const topicLabels = new Map(
    (context?.topics ?? []).map((topic) => [
      topic.stableKey,
      topic.subTopic.trim() === '' ? topic.topic : `${topic.topic} · ${topic.subTopic}`,
    ]),
  );

  return days.map((date) => {
    const rhythm = rhythmFor(date);
    const dayRows = byDay.get(date) ?? [];

    const blocks: WeekBlock[] = studyBlocks.map((block) => {
      const commitment = dayRows.find((row) => row.blockId === block.blockId);

      return {
        blockId: block.blockId,
        area: block.area,
        startTime: block.startTime,
        state: commitment?.status ?? 'not-generated',
        topicLabel: commitment?.curriculumTopicKey
          ? (topicLabels.get(commitment.curriculumTopicKey) ?? null)
          : null,
      };
    });

    return {
      date,
      label: rhythm.label,
      output: rhythm.output,
      slants: [rhythm.dsa, rhythm.frontend, rhythm.systemDesign],
      blocks,
      blocksDone: blocks.filter((block) => block.state === 'done').length,
      otherDue: dayRows.filter((row) => !row.blockId).length,
      isToday: date === today,
      isPast: date < today,
    };
  });
}
