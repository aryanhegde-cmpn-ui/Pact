import 'server-only';

import { needsReckoning } from '@/lib/behavior/reckoning';
import { appendEvent, readEntityEvents } from '@/lib/db/events';
import { getEnv } from '@/lib/env';
import { reenqueueForCommitment } from '@/lib/notifications/queue';
import { getSettings } from '@/lib/notifications/settings';
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
  const { newDueAt, reason, category } = changeDeadlineSchema.parse(input);

  const existing = await CommitmentModel.findById(commitmentId).lean();
  if (!existing) {
    throw new DeadlineError('No such commitment.');
  }

  if (existing.status === 'done' || existing.status === 'abandoned') {
    // Moving the deadline of something already resolved would rewrite history.
    throw new DeadlineError('This commitment is already closed; its deadline cannot move.');
  }

  const history = await readEntityEvents(commitmentId);

  /**
   * AN UNRECKONED MISS CANNOT BE RESCHEDULED.
   *
   * This is the point of the whole feature. Rescheduling a missed commitment
   * without answering for it is exactly the frictionless drag that lets a
   * deadline move ten times without anyone ever deciding anything -- and it
   * leaves the postponement history looking like a series of neutral replans
   * rather than a pattern of avoidance.
   *
   * The gate is on the CURRENT deadline: a previous reckoning answered a
   * previous deadline and does not discharge this one.
   */
  if (needsReckoning({ dueAt: existing.dueAt, status: existing.status }, history, now)) {
    throw new DeadlineError(
      'This deadline has already passed and has not been reckoned with. ' +
        'Answer what happened first -- what was missed, why, and what changes. ' +
        'Then the deadline can move.',
      'needs-reckoning',
    );
  }

  /**
   * A "too vague" reckoning requires a concrete next action before the
   * commitment can be rescheduled. Without this the recovery is advice; with
   * it, it is a precondition.
   */
  if (requiresNextAction(history) && !existing.nextAction) {
    throw new DeadlineError(
      'This was missed because it was too vague. Define the concrete next ' +
        'action before giving it a new deadline.',
      'needs-next-action',
    );
  }

  const previousDueAt = existing.dueAt;

  if (previousDueAt.getTime() === newDueAt.getTime()) {
    return { previousDueAt, newDueAt };
  }

  await CommitmentModel.updateOne({ _id: commitmentId }, { $set: { dueAt: newDueAt } });

  const priorChanges = history.filter((event) => event.type === 'DEADLINE_CHANGED').length;

  await appendEvent({
    type: 'DEADLINE_CHANGED',
    entityType: 'commitment',
    entityId: commitmentId,
    ts: now,
    source,
    payload: {
      // The full record, so one event answers "how far has this drifted and
      // why" without replaying the chain.
      originalDueAt: existing.originalDueAt.toISOString(),
      from: previousDueAt.toISOString(),
      to: newDueAt.toISOString(),
      /** Days added against the deadline first committed to, not the last hop. */
      deltaDaysFromOriginal: Math.round(
        (newDueAt.getTime() - existing.originalDueAt.getTime()) / 86_400_000,
      ),
      deltaDaysFromPrevious: Math.round(
        (newDueAt.getTime() - previousDueAt.getTime()) / 86_400_000,
      ),
      category,
      reason,
      note: reason,
      /** How many times it had already moved. The fourth move reads differently to the first. */
      priorChangeCount: priorChanges,
      // A postponement and a pull-forward are different behaviours.
      direction: newDueAt > previousDueAt ? 'later' : 'earlier',
    },
  });

  /**
   * Re-point the notification queue at the new deadline.
   *
   * This is the single most likely bug in the notification feature, and it
   * fails quietly: the deadline moves, the old DEADLINE_APPROACHING stays
   * queued, and the user is notified about a deadline that no longer exists
   * while hearing nothing about the one that does. Cancel-and-re-enqueue
   * rather than update-in-place, because the schedule is derived from the
   * deadline and recomputing is the only way a stale row cannot survive.
   *
   * After the commitment write, so a failure here cannot leave `dueAt`
   * unchanged while the queue has already moved on.
   */
  await reenqueueForCommitment(
    {
      id: commitmentId,
      title: existing.title,
      outcome: existing.outcome,
      dueAt: newDueAt,
      estimateMinutes: existing.estimateMinutes,
      priority: existing.priority,
      leadMinutes: existing.leadMinutes ?? null,
    },
    await getSettings(),
    getEnv().APP_TIMEZONE,
    now,
  );

  return { previousDueAt, newDueAt };
}

export class DeadlineError extends Error {
  override readonly name = 'DeadlineError';

  constructor(
    message: string,
    /** Lets a surface route the user somewhere useful rather than just showing text. */
    readonly code: 'needs-reckoning' | 'needs-next-action' | 'generic' = 'generic',
  ) {
    super(message);
  }
}

/**
 * Whether the most recent reckoning demanded a next action.
 *
 * Read from the log rather than a flag, so it stays true to what was actually
 * chosen and cannot drift.
 */
function requiresNextAction(
  history: readonly { type: string; payload?: Record<string, unknown> }[],
): boolean {
  const recoveries = history.filter((event) => event.type === 'RECOVERY_ACTION_SELECTED');
  const latest = recoveries.at(-1);

  return latest?.payload?.action === 'define-next-action';
}
