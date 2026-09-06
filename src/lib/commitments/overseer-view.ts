import 'server-only';

import { adherenceRate } from '@/lib/behavior/reckoning';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { EventModel } from '@/lib/db/models/event';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getSettings } from '@/lib/notifications/settings';
import {
  DEADLINE_CATEGORY_LABELS,
  MISS_REASON_LABELS,
  type DeadlineChangeCategory,
  type MissReason,
} from '@/lib/schemas/reckoning';

/**
 * The overseer's read model.
 *
 * A PURPOSE-BUILT projection, not a filtered event log. The overseer has no
 * `events:read` capability at all, and that is deliberate: filtering a
 * general-purpose log per role means every future event type is exposed by
 * default and has to be remembered about. A projection is the opposite —
 * nothing appears here unless someone put it here.
 *
 * Free text is excluded unless the primary has opted in. Structured categories
 * are always included, because that is where the accountability value is:
 * "missed, avoidance, three times" is the actionable fact. The free text is
 * where the primary is honest with themselves, and they will be less honest if
 * they know it is read.
 */

export interface OverseerCommitment {
  id: string;
  title: string;
  status: string;
  dueAt: string;
  originalDueAt: string;
  completedAt: string | null;
  /** True when finished after its deadline. Never softened. */
  late: boolean;
  deadlineChanges: number;
  /** Present only when the primary has enabled note sharing. */
  notes?: string;
}

export interface OverseerReckoning {
  commitmentId: string;
  commitmentTitle: string;
  at: string;
  /** Always visible. */
  reason: MissReason | null;
  reasonLabel: string | null;
  recoveryAction: string | null;
  /** Present only when the primary has enabled note sharing. */
  note?: string;
}

export interface OverseerSnapshot {
  adherence: { kept: number; of: number; rate: number };
  recentCompletions: OverseerCommitment[];
  recentMisses: OverseerCommitment[];
  reckonings: OverseerReckoning[];
  deadlineChanges: {
    category: DeadlineChangeCategory;
    label: string;
    count: number;
  }[];
  /**
   * Deadline changes predating the category requirement.
   *
   * Reported separately rather than counted as a category: a phantom bucket
   * competing for "most common" would misreport the actual pattern.
   */
  legacyChanges: number;
  /** So the surface can say why free text is absent rather than looking broken. */
  notesShared: boolean;
}

const RECENT = 25;

export async function buildOverseerSnapshot(
  ownerId: string,
  now: Date = new Date(),
): Promise<OverseerSnapshot> {
  await connectToDatabase();

  const settings = await getSettings(ownerId);
  const notesShared = settings.shareNotesWithOverseer;

  const [completed, missedOpen, reckoningEvents, changeEvents] = await Promise.all([
    CommitmentModel.find({ ownerId, status: 'done' })
      .sort({ completedAt: -1 })
      .limit(RECENT)
      .lean(),
    CommitmentModel.find({
      ownerId,
      status: { $in: ['pending', 'in-progress', 'blocked'] },
      dueAt: { $lt: now },
    })
      .sort({ dueAt: 1 })
      .limit(RECENT)
      .lean(),
    EventModel.find({ ownerId, type: 'RECKONING_SUBMITTED' }).sort({ ts: -1 }).limit(RECENT).lean(),
    EventModel.find({ ownerId, type: 'DEADLINE_CHANGED' }).sort({ ts: -1 }).limit(200).lean(),
  ]);

  const titles = new Map<string, string>();
  for (const row of [...completed, ...missedOpen]) titles.set(String(row._id), row.title);

  // Any reckoned commitment not already loaded, so its title can be shown.
  const missingIds = reckoningEvents.map((event) => event.entityId).filter((id) => !titles.has(id));
  if (missingIds.length > 0) {
    const extra = await CommitmentModel.find(
      { _id: { $in: missingIds }, ownerId },
      { title: 1 },
    ).lean();
    for (const row of extra) titles.set(String(row._id), row.title);
  }

  const toView = (row: (typeof completed)[number]): OverseerCommitment => ({
    id: String(row._id),
    title: row.title,
    status: row.status,
    dueAt: row.dueAt.toISOString(),
    originalDueAt: row.originalDueAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    late: row.completedAt ? row.completedAt.getTime() > row.dueAt.getTime() : false,
    deadlineChanges: 0,
    // Spread conditionally: the field is ABSENT rather than empty when not
    // shared, so a client cannot mistake "" for "they wrote nothing".
    ...(notesShared && row.notes ? { notes: row.notes } : {}),
  });

  /**
   * Rows predating the category requirement are counted separately, not as a
   * category. A `null` bucket competing for "most common" would misreport the
   * pattern, and calling it a category would imply one was chosen and left
   * blank.
   */
  const categoryCounts = new Map<DeadlineChangeCategory, number>();
  let legacyChanges = 0;
  for (const event of changeEvents) {
    const category = (event.payload as { category?: DeadlineChangeCategory })?.category;
    if (!category) {
      legacyChanges += 1;
      continue;
    }
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }

  return {
    adherence: adherenceRate(
      completed.map((row) => ({
        onTime: row.completedAt ? row.completedAt.getTime() <= row.dueAt.getTime() : false,
      })),
    ),
    recentCompletions: completed.map(toView),
    recentMisses: missedOpen.map(toView),
    reckonings: reckoningEvents.map((event) => {
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const reason = (payload.reason as MissReason | null) ?? null;

      return {
        commitmentId: event.entityId,
        commitmentTitle: titles.get(event.entityId) ?? 'A commitment',
        at: (payload.submittedAt as string | undefined) ?? event.ts.toISOString(),
        reason,
        reasonLabel: reason ? MISS_REASON_LABELS[reason] : null,
        recoveryAction: (payload.recovery as string | null) ?? null,
        ...(notesShared && payload.note ? { note: String(payload.note) } : {}),
      };
    }),
    deadlineChanges: [...categoryCounts.entries()]
      .map(([category, count]) => ({
        category,
        label: DEADLINE_CATEGORY_LABELS[category],
        count,
      }))
      .sort((a, b) => b.count - a.count),
    legacyChanges,
    notesShared,
  };
}
