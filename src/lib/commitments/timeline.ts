import 'server-only';

import { summarisePostponements, type ReckoningEvent } from '@/lib/behavior/reckoning';
import { readEntityEvents } from '@/lib/db/events';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { EventModel } from '@/lib/db/models/event';
import { connectToDatabase } from '@/lib/db/mongoose';
import { CommitmentError } from '@/lib/commitments/service';
import {
  DEADLINE_CATEGORY_LABELS,
  MISS_REASON_LABELS,
  RECOVERY_ACTION_LABELS,
  type DeadlineChangeCategory,
  type MissReason,
  type RecoveryAction,
} from '@/lib/schemas/reckoning';

export interface TimelineEntry {
  ts: string;
  type: string;
  /** One line. The timeline is evidence, not a feed. */
  line: string;
  /** Emphasises the entries that carry the behavioural signal. */
  significant: boolean;
}

export interface Timeline {
  commitmentId: string;
  title: string;
  entries: TimelineEntry[];
  postponements: ReturnType<typeof summarisePostponements>;
}

/**
 * A commitment's history, chronologically, one line per event.
 *
 * This is the evidence base. Every claim the app makes about someone's
 * behaviour has to be traceable to lines here, which is the difference between
 * an accountability tool and an opinion.
 */
export async function buildTimeline(commitmentId: string): Promise<Timeline> {
  await connectToDatabase();

  const commitment = await CommitmentModel.findById(commitmentId).lean();
  if (!commitment) throw new CommitmentError('No such commitment.', 404);

  const events = await readEntityEvents(commitmentId);

  return {
    commitmentId,
    title: commitment.title,
    /**
     * Ordered by when things actually HAPPENED, not by `ts`.
     *
     * `ts` is deliberately not the wall-clock moment for every type: a miss
     * and its reckoning are both stamped at the missed DEADLINE, because that
     * is what the uniqueness key needs and what the behaviour engine should
     * read. Sorting a narrative by that puts "reckoned" before "committed" and
     * the whole point of the timeline -- showing the sequence -- is lost.
     *
     * So the display uses the recorded observation time where the event
     * carries one, and falls back to `ts` where it does not.
     */
    entries: [...events]
      .sort((a, b) => occurredAt(a).getTime() - occurredAt(b).getTime())
      .map(toEntry),
    postponements: summarisePostponements(
      events as ReckoningEvent[],
      commitment.originalDueAt,
      commitment.dueAt,
    ),
  };
}

/**
 * When an event actually happened, for display ordering.
 *
 * `submittedAt` for a reckoning, `noticedAt` for a lazily-detected miss --
 * both recorded in the payload precisely so `ts` could keep its other meaning.
 */
function occurredAt(event: { ts: Date; payload: Record<string, unknown> }): Date {
  const recorded = event.payload?.submittedAt ?? event.payload?.noticedAt;

  return typeof recorded === 'string' ? new Date(recorded) : event.ts;
}

function toEntry(event: {
  ts: Date;
  type: string;
  payload: Record<string, unknown>;
}): TimelineEntry {
  const { type, payload } = event;
  // Displayed at its occurrence time, matching the sort, so the column reads
  // monotonically rather than appearing shuffled.
  const base = { ts: occurredAt(event).toISOString(), type };

  switch (type) {
    case 'COMMITMENT_CREATED':
      return { ...base, line: 'Committed', significant: false };

    case 'DEADLINE_SET':
      return { ...base, line: `Deadline set for ${short(payload.dueAt)}`, significant: false };

    case 'DEADLINE_CHANGED': {
      const category = payload.category as DeadlineChangeCategory | undefined;
      const label = category ? DEADLINE_CATEGORY_LABELS[category] : 'no category';
      const delta = Number(payload.deltaDaysFromPrevious ?? 0);
      const move = delta >= 0 ? `+${delta}d` : `${delta}d`;

      return {
        ...base,
        line: `Deadline moved to ${short(payload.to)} (${move}) — ${label}: "${payload.reason}"`,
        significant: true,
      };
    }

    case 'DEADLINE_MISSED':
      return { ...base, line: 'Deadline missed', significant: true };

    case 'COMMITMENT_STARTED':
      return { ...base, line: 'Started', significant: false };

    case 'SESSION_SCHEDULED':
      return {
        ...base,
        line: `${payload.minutes}-minute start session scheduled`,
        significant: true,
      };

    case 'RECKONING_SUBMITTED': {
      const reason = payload.reason as MissReason | undefined;
      const completed = payload.completed === true;

      return {
        ...base,
        line: completed
          ? 'Reckoned: it had been done, late'
          : `Reckoned: ${reason ? MISS_REASON_LABELS[reason] : 'no reason given'}`,
        significant: true,
      };
    }

    case 'RECOVERY_ACTION_SELECTED': {
      const action = payload.action as RecoveryAction | undefined;

      return {
        ...base,
        line: `Recovery: ${action ? RECOVERY_ACTION_LABELS[action] : 'none'}`,
        significant: true,
      };
    }

    case 'COMMITMENT_COMPLETED': {
      const late = payload.lateAgainstDueAt === true;
      const minutes = Number(payload.minutesLate ?? 0);

      return {
        ...base,
        // Never rendered as a plain "Completed" when it was late. The whole
        // point is that the record does not flatter.
        line: late ? `Completed — ${formatLate(minutes)} late` : 'Completed on time',
        significant: late,
      };
    }

    case 'COMMITMENT_ABANDONED':
      return { ...base, line: `Abandoned — "${payload.reason}"`, significant: true };

    case 'COMMITMENT_EDITED':
      return {
        ...base,
        line: `Edited (${(payload.changed as string[])?.join(', ')})`,
        significant: false,
      };

    default:
      return { ...base, line: type, significant: false };
  }
}

export interface PostponementRow {
  id: string;
  title: string;
  status: string;
  changes: number;
  totalDaysPostponed: number;
  mostCommonCategory: DeadlineChangeCategory | null;
  mostCommonCategoryLabel: string | null;
  interventionCandidate: boolean;
  dueAt: string;
  originalDueAt: string;
}

export interface PostponementGroups {
  once: PostponementRow[];
  twice: PostponementRow[];
  /** Three or more. Worth a conversation, not another reschedule. */
  chronic: PostponementRow[];
}

/**
 * Commitments whose deadline has moved, grouped by how often.
 *
 * The grouping is the point. One postponement is life; three is a pattern, and
 * the honest response to a pattern is not a fourth new date.
 */
export async function listPostponements(): Promise<PostponementGroups> {
  await connectToDatabase();

  // Only entities that actually have a deadline change, so this does not scan
  // the whole collection to find the handful that matter.
  const changed = await EventModel.aggregate<{ _id: string }>([
    { $match: { type: 'DEADLINE_CHANGED' } },
    { $group: { _id: '$entityId' } },
  ]);

  const ids = changed.map((row) => row._id);
  if (ids.length === 0) return { once: [], twice: [], chronic: [] };

  const commitments = await CommitmentModel.find({ _id: { $in: ids } }).lean();
  const events = await EventModel.find(
    { entityId: { $in: ids }, type: 'DEADLINE_CHANGED' },
    { entityId: 1, ts: 1, type: 1, payload: 1 },
  )
    .sort({ ts: 1 })
    .lean();

  const byEntity = new Map<string, ReckoningEvent[]>();
  for (const event of events) {
    const list = byEntity.get(event.entityId) ?? [];
    list.push({
      ts: event.ts,
      type: event.type as ReckoningEvent['type'],
      payload: event.payload as Record<string, unknown>,
    });
    byEntity.set(event.entityId, list);
  }

  const rows: PostponementRow[] = commitments.map((commitment) => {
    const id = String(commitment._id);
    const summary = summarisePostponements(
      byEntity.get(id) ?? [],
      commitment.originalDueAt,
      commitment.dueAt,
    );

    return {
      id,
      title: commitment.title,
      status: commitment.status,
      changes: summary.changes,
      totalDaysPostponed: summary.totalDaysPostponed,
      mostCommonCategory: summary.mostCommonCategory,
      mostCommonCategoryLabel: summary.mostCommonCategory
        ? DEADLINE_CATEGORY_LABELS[summary.mostCommonCategory]
        : null,
      interventionCandidate: summary.interventionCandidate,
      dueAt: commitment.dueAt.toISOString(),
      originalDueAt: commitment.originalDueAt.toISOString(),
    };
  });

  // Sorted by total days postponed: the commitment that has drifted furthest
  // is the one worth looking at first, not the one moved most recently.
  const byDrift = (a: PostponementRow, b: PostponementRow) =>
    b.totalDaysPostponed - a.totalDaysPostponed;

  return {
    once: rows.filter((row) => row.changes === 1).sort(byDrift),
    twice: rows.filter((row) => row.changes === 2).sort(byDrift),
    chronic: rows.filter((row) => row.changes >= 3).sort(byDrift),
  };
}

function short(iso: unknown): string {
  if (typeof iso !== 'string') return 'unknown';
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

function formatLate(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}
