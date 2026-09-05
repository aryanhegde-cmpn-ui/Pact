import 'server-only';

import { appendEvent } from '@/lib/db/events';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { SeriesModel } from '@/lib/db/models/series';
import { connectToDatabase } from '@/lib/db/mongoose';
import { CommitmentError } from '@/lib/commitments/service';
import {
  createSeriesSchema,
  updateSeriesSchema,
  type CreateSeriesInput,
  type UpdateSeriesInput,
} from '@/lib/schemas/series';
import { addDays, toDateKey } from '@/lib/time';

export interface SeriesView {
  id: string;
  title: string;
  outcome: string;
  rule: Record<string, unknown>;
  priority: string;
  startDate: string;
  endDate: string | null;
  status: string;
  createdAt: string;
  supersedes: string | null;
}

function toView(row: {
  _id: unknown;
  title: string;
  outcome: string;
  rule?: unknown;
  priority: string;
  startDate: string;
  endDate?: string | null;
  status: string;
  createdAt: Date;
  supersedes?: string | null;
}): SeriesView {
  return {
    id: String(row._id),
    title: row.title,
    outcome: row.outcome,
    rule: (row.rule ?? {}) as Record<string, unknown>,
    priority: row.priority,
    startDate: row.startDate,
    endDate: row.endDate ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    supersedes: row.supersedes ?? null,
  };
}

export async function createSeries(
  input: CreateSeriesInput,
  now: Date = new Date(),
): Promise<SeriesView> {
  const data = createSeriesSchema.parse(input);
  await connectToDatabase();

  const doc = await SeriesModel.create({
    title: data.title,
    outcome: data.outcome,
    rule: data.rule,
    priority: data.priority,
    startDate: data.startDate,
    endDate: data.endDate ?? null,
    status: 'active',
    createdAt: now,
    supersedes: null,
  });

  await appendEvent({
    type: 'SERIES_CREATED',
    entityType: 'series',
    entityId: String(doc._id),
    ts: now,
    source: 'user',
    payload: { title: data.title, rule: data.rule, startDate: data.startDate },
  });

  return toView(doc.toObject());
}

export async function listSeries(): Promise<SeriesView[]> {
  await connectToDatabase();
  const rows = await SeriesModel.find().sort({ createdAt: -1 }).lean();
  return rows.map(toView);
}

/**
 * Editing a series.
 *
 * PAST OCCURRENCES ARE NEVER REWRITTEN. What you committed to last Tuesday is
 * a historical fact; changing your mind today does not change what you said
 * then, and rewriting it would make the behaviour engine's read of your history
 * a lie. There is deliberately no "all occurrences" scope.
 *
 * The two supported scopes:
 *
 *   this-occurrence  -> edit that single Commitment document. The rule is
 *                       untouched, so future occurrences are unaffected.
 *
 *   this-and-future  -> end the current series as of yesterday and start a new
 *                       one from today with the new rule. The old series keeps
 *                       describing exactly the occurrences it produced, and the
 *                       occurrence chain stays auditable through `supersedes`.
 */
export async function updateSeries(
  seriesId: string,
  input: UpdateSeriesInput,
  timeZone: string,
  now: Date = new Date(),
): Promise<SeriesView> {
  const data = updateSeriesSchema.parse(input);
  await connectToDatabase();

  const series = await SeriesModel.findById(seriesId).lean();
  if (!series) throw new CommitmentError('No such series.', 404);

  if (data.scope === 'this-occurrence') {
    const occurrence = await CommitmentModel.findOne({
      seriesId,
      occurrenceDate: data.occurrenceDate,
    }).lean();
    if (!occurrence) throw new CommitmentError('No such occurrence.', 404);

    // Only the descriptive fields. Not dueAt -- that is changeDeadline's alone,
    // even for an occurrence.
    const changes: Record<string, unknown> = {};
    if (data.title !== undefined) changes.title = data.title;
    if (data.outcome !== undefined) changes.outcome = data.outcome;
    if (data.priority !== undefined) changes.priority = data.priority;
    if (Object.keys(changes).length === 0) return toView(series);

    await CommitmentModel.updateOne({ _id: occurrence._id }, { $set: changes });
    await appendEvent({
      type: 'COMMITMENT_EDITED',
      entityType: 'commitment',
      entityId: String(occurrence._id),
      ts: now,
      source: 'user',
      payload: { scope: 'this-occurrence', seriesId, changed: Object.keys(changes) },
    });

    return toView(series);
  }

  // this-and-future: end the old series, start a new one from today.
  const today = toDateKey(now, timeZone);
  const endOfOld = addDays(today, -1);

  await SeriesModel.updateOne(
    { _id: seriesId },
    // If the series had not started yet, do not give it a backwards lifetime.
    {
      $set: { status: 'ended', endDate: endOfOld < series.startDate ? series.startDate : endOfOld },
    },
  );
  await appendEvent({
    type: 'SERIES_ENDED',
    entityType: 'series',
    entityId: seriesId,
    ts: now,
    source: 'user',
    payload: { reason: 'superseded by a this-and-future edit', endDate: endOfOld },
  });

  const replacement = await SeriesModel.create({
    title: data.title ?? series.title,
    outcome: data.outcome ?? series.outcome,
    rule: data.rule ?? series.rule,
    priority: data.priority ?? series.priority,
    startDate: today,
    endDate: series.endDate ?? null,
    status: 'active',
    createdAt: now,
    supersedes: seriesId,
  });

  await appendEvent({
    type: 'SERIES_CREATED',
    entityType: 'series',
    entityId: String(replacement._id),
    ts: now,
    source: 'user',
    payload: { supersedes: seriesId, startDate: today },
  });
  await appendEvent({
    type: 'SERIES_EDITED',
    entityType: 'series',
    entityId: seriesId,
    ts: now,
    source: 'user',
    payload: { scope: 'this-and-future', replacementId: String(replacement._id) },
  });

  return toView(replacement.toObject());
}

/**
 * Ends a series.
 *
 * Deliberately not a delete. Past occurrences stay exactly as they are -- they
 * record what was committed to and what happened, and removing them would
 * delete history to tidy a list. Future occurrences simply stop being
 * materialised, because the materialiser only reads active series.
 */
export async function endSeries(
  seriesId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<{ endedAt: string; futureOccurrencesRemoved: number }> {
  await connectToDatabase();

  const series = await SeriesModel.findById(seriesId).lean();
  if (!series) throw new CommitmentError('No such series.', 404);

  const today = toDateKey(now, timeZone);
  await SeriesModel.updateOne({ _id: seriesId }, { $set: { status: 'ended', endDate: today } });

  // Occurrences already materialised for FUTURE dates are removed: they were
  // generated by a rule that no longer applies, and nothing has happened to
  // them yet, so there is no history to lose. Today's and past ones stay.
  const removal = await CommitmentModel.deleteMany({
    seriesId,
    occurrenceDate: { $gt: today },
    status: 'pending',
    startedAt: null,
  });

  await appendEvent({
    type: 'SERIES_ENDED',
    entityType: 'series',
    entityId: seriesId,
    ts: now,
    source: 'user',
    payload: { endDate: today, futureOccurrencesRemoved: removal.deletedCount ?? 0 },
  });

  return { endedAt: today, futureOccurrencesRemoved: removal.deletedCount ?? 0 };
}
