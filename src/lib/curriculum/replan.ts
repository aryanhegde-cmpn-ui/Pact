import 'server-only';

import { appendEvent } from '@/lib/db/events';
import { PhaseModel } from '@/lib/db/models/phase';
import type { replanSchema } from '@/lib/schemas/curriculum';
import { addDays, daysBetween, type DateKey } from '@/lib/time';
import type { z } from 'zod';

import { CurriculumError } from './service';

/**
 * Moving the plan, deliberately.
 *
 * ---------------------------------------------------------------------------
 * THE ONLY WAY THE SCHEDULE CHANGES.
 * ---------------------------------------------------------------------------
 * Nothing re-flows the plan because the user fell behind. `computeDrift`
 * measures the gap and writes nothing; the import will not overwrite a phase
 * that has been moved; and there is no other writer of a phase's dates.
 *
 * Silent re-flowing is the study-plan version of silently moving a deadline,
 * which is the single behaviour this product exists to prevent. It would let a
 * five-month plan quietly become an eight-month one with no moment where
 * anybody noticed -- and there would be nothing left to compare against,
 * because the original schedule is the only thing that makes "behind" mean
 * anything.
 *
 * So this is shaped exactly like `changeDeadline()`: an explicit call, a
 * required reason, and an event recording the before, the after and the delta.
 * ---------------------------------------------------------------------------
 */

export interface ReplanResult {
  moved: { number: number; from: [DateKey, DateKey]; to: [DateKey, DateKey] }[];
  deltaDays: number;
}

export async function replanPhase(
  input: z.infer<typeof replanSchema>,
  ownerId: string,
  now: Date = new Date(),
): Promise<ReplanResult> {
  const phases = await PhaseModel.find({ ownerId }).sort({ number: 1 }).lean();
  const target = phases.find((phase) => phase.number === input.phaseNumber);
  if (!target) throw new CurriculumError('No such phase.', 404);

  if (input.newEndDate < target.startDate) {
    throw new CurriculumError('A phase cannot end before it starts.');
  }

  const deltaDays = daysBetween(target.endDate, input.newEndDate);
  if (deltaDays === 0) {
    // Not an error, but not a re-plan either. Recording one would put a reason
    // in the log against a change that did not happen.
    return { moved: [], deltaDays: 0 };
  }

  /**
   * Later phases shift by the same amount rather than being squeezed.
   *
   * Absorbing the delta by shortening the next phase would be exactly the
   * silent re-flow this function exists to replace: the plan would look the
   * same length while quietly containing less time for the same material.
   */
  const moved: ReplanResult['moved'] = [];

  for (const phase of phases) {
    if (phase.number < input.phaseNumber) continue;

    const from: [DateKey, DateKey] = [phase.startDate, phase.endDate];
    const to: [DateKey, DateKey] =
      phase.number === input.phaseNumber
        ? [phase.startDate, input.newEndDate]
        : [addDays(phase.startDate, deltaDays), addDays(phase.endDate, deltaDays)];

    await PhaseModel.updateOne(
      { ownerId, number: phase.number },
      { $set: { startDate: to[0], endDate: to[1], replannedAt: now } },
    );

    moved.push({ number: phase.number, from, to });
  }

  await appendEvent({
    type: 'PLAN_REPLANNED',
    entityType: 'plan',
    entityId: 'curriculum',
    ownerId,
    ts: now,
    source: 'user',
    payload: {
      phaseNumber: input.phaseNumber,
      deltaDays,
      reason: input.reason,
      moved: moved.map((entry) => ({ number: entry.number, from: entry.from, to: entry.to })),
      /**
       * The dates the plan was first written with, carried in the event.
       *
       * `originalStartDate` is immutable on the document, so the total drift
       * from the original plan stays answerable however many times this runs.
       */
      originalEndDate: target.originalEndDate,
      totalDaysFromOriginal: daysBetween(target.originalEndDate, input.newEndDate),
    },
  });

  return { moved, deltaDays };
}
