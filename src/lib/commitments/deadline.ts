import 'server-only';

import { appendEvent } from '@/lib/db/events';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { changeDeadlineSchema, type ChangeDeadlineInput } from '@/lib/schemas/commitment';
import type { EventSource } from '@/lib/schemas/event';

/**
 * THE ONLY FUNCTION IN THIS CODEBASE PERMITTED TO WRITE `dueAt`.
 *
 * Not a convention -- a structural rule, with a test that fails if any other
 * module writes the field. The reasoning is the product itself:
 *
 * A deadline that can be moved silently is not a deadline. The gap between
 * what someone committed to and what they did is the only thing this app has
 * to show them, and an unlogged reschedule erases it. Requiring a reason makes
 * moving a deadline a decision the user has to articulate, rather than a
 * frictionless drag that happens ten times without ever feeling like anything.
 *
 * `originalDueAt` is never touched here. That is the number the postponement
 * history is measured against.
 */
export async function changeDeadline(
  commitmentId: string,
  input: ChangeDeadlineInput,
  now: Date = new Date(),
  /**
   * Who moved it. Defaults to the user, and exists so synthetic history can go
   * through this same function rather than writing `dueAt` itself -- which
   * would make "one writer" a rule with an exception, and therefore not a rule.
   */
  source: EventSource = 'user',
): Promise<{ previousDueAt: Date; newDueAt: Date }> {
  const { newDueAt, reason } = changeDeadlineSchema.parse(input);

  const existing = await CommitmentModel.findById(commitmentId).lean();
  if (!existing) {
    throw new DeadlineError('No such commitment.');
  }

  if (existing.status === 'done' || existing.status === 'abandoned') {
    // Moving the deadline of something already resolved would rewrite history.
    throw new DeadlineError('This commitment is already closed; its deadline cannot move.');
  }

  const previousDueAt = existing.dueAt;

  if (previousDueAt.getTime() === newDueAt.getTime()) {
    return { previousDueAt, newDueAt };
  }

  await CommitmentModel.updateOne({ _id: commitmentId }, { $set: { dueAt: newDueAt } });

  await appendEvent({
    type: 'DEADLINE_CHANGED',
    entityType: 'commitment',
    entityId: commitmentId,
    ts: now,
    source,
    payload: {
      from: previousDueAt.toISOString(),
      to: newDueAt.toISOString(),
      // Kept against originalDueAt so the total drift is readable from one
      // event without replaying the whole chain.
      originalDueAt: existing.originalDueAt.toISOString(),
      reason,
      // A postponement and a pull-forward are different behaviours.
      direction: newDueAt > previousDueAt ? 'later' : 'earlier',
    },
  });

  return { previousDueAt, newDueAt };
}

export class DeadlineError extends Error {
  override readonly name = 'DeadlineError';
}
