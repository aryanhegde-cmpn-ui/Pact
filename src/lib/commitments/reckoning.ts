import 'server-only';

import { isMissed } from '@/lib/behavior/miss';
import { hasReckonedDeadline } from '@/lib/behavior/reckoning';
import { CommitmentError } from '@/lib/commitments/service';
import type { Priority } from '@/lib/schemas/commitment';
import { appendEvent, readEntityEvents } from '@/lib/db/events';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { connectToDatabase } from '@/lib/db/mongoose';
import { cancelPendingForCommitment, enqueueForCommitment } from '@/lib/notifications/queue';
import { getSettings } from '@/lib/notifications/settings';
import { getEnv } from '@/lib/env';
import {
  reckoningSubmissionSchema,
  START_SESSION_MINUTES,
  type RecoveryDetail,
  type ReckoningSubmission,
} from '@/lib/schemas/reckoning';

export interface ReckoningResult {
  /** False when this deadline had already been reckoned with. */
  recorded: boolean;
  action: string | null;
  /** What actually changed, in words, for the surface to confirm back. */
  effect: string;
  /** Commitments created as a side effect (splits, start sessions). */
  createdCommitmentIds: string[];
}

/**
 * Records a reckoning and applies its recovery action.
 *
 * The two halves are inseparable by design: the event log gets the answer, and
 * the commitment gets the consequence. Recording the answer without the
 * consequence is journaling, and journaling does not change what happens next.
 */
export async function submitReckoning(
  commitmentId: string,
  input: ReckoningSubmission,
  now: Date = new Date(),
): Promise<ReckoningResult> {
  const submission = reckoningSubmissionSchema.parse(input);
  await connectToDatabase();

  const commitment = await CommitmentModel.findById(commitmentId).lean();
  if (!commitment) throw new CommitmentError('No such commitment.', 404);

  const history = await readEntityEvents(commitmentId);

  /**
   * Two different "no" answers, deliberately separated.
   *
   * Not missed at all -- not yet due, or already closed -- is a caller error
   * and gets a 409. Missed but ALREADY answered is not an error: it is the
   * second half of a double tap, or a retried request, and the right response
   * is a quiet no-op rather than an error surfaced over a form the user has
   * already submitted successfully.
   */
  if (!isMissed({ dueAt: commitment.dueAt, status: commitment.status }, now)) {
    throw new CommitmentError('This commitment is not awaiting a reckoning.', 409);
  }

  if (hasReckonedDeadline(history, commitment.dueAt)) {
    return {
      recorded: false,
      action: null,
      effect: 'This miss had already been reckoned with.',
      createdCommitmentIds: [],
    };
  }

  /**
   * The missed deadline, used as the event timestamp.
   *
   * Same rule as DEADLINE_MISSED, and for the same two reasons: the log should
   * say which deadline was answered rather than when the form was submitted,
   * and the unique index on (entityId, type, ts) uses it to make a double
   * submission idempotent while still allowing a second reckoning after the
   * commitment is rescheduled and missed again.
   */
  const missedDeadline = commitment.dueAt;

  const submitted = await appendEvent({
    type: 'RECKONING_SUBMITTED',
    entityType: 'commitment',
    entityId: commitmentId,
    ts: missedDeadline,
    source: 'user',
    payload: {
      missedDeadline: missedDeadline.toISOString(),
      originalDueAt: commitment.originalDueAt.toISOString(),
      completed: submission.completed,
      reason: submission.reason ?? null,
      note: submission.note ?? null,
      recovery: submission.recovery?.action ?? null,
      submittedAt: now.toISOString(),
    },
  });

  // An impatient double tap, or a retried request, must not record the same
  // miss being answered twice. The unique index makes the second a no-op.
  if (!submitted.appended) {
    return {
      recorded: false,
      action: null,
      effect: 'This miss had already been reckoned with.',
      createdCommitmentIds: [],
    };
  }

  // --- Step 1: it was actually done, just late ------------------------------
  if (submission.completed) {
    const completedAt = submission.completedAt ?? now;

    await CommitmentModel.updateOne(
      { _id: commitmentId },
      { $set: { status: 'done', completedAt } },
    );

    await appendEvent({
      type: 'COMMITMENT_COMPLETED',
      entityType: 'commitment',
      entityId: commitmentId,
      // The REAL completion time, not `now`. The history has to show
      // completed-after-deadline; recording it at submission time would make a
      // task finished on Tuesday and confessed on Friday look like neither.
      ts: completedAt,
      source: 'user',
      payload: {
        dueAt: commitment.dueAt.toISOString(),
        originalDueAt: commitment.originalDueAt.toISOString(),
        // Recorded explicitly rather than left to be recomputed, so no reader
        // can accidentally present this as on-time.
        lateAgainstDueAt: completedAt.getTime() > commitment.dueAt.getTime(),
        lateAgainstOriginal: completedAt.getTime() > commitment.originalDueAt.getTime(),
        minutesLate: Math.max(
          0,
          Math.round((completedAt.getTime() - commitment.dueAt.getTime()) / 60_000),
        ),
        viaReckoning: true,
      },
    });

    await cancelPendingForCommitment(commitmentId);

    return {
      recorded: true,
      action: null,
      effect: 'Recorded as completed late. The history shows it finished after the deadline.',
      createdCommitmentIds: [],
    };
  }

  // --- Step 3: apply the recovery ------------------------------------------
  const recovery = submission.recovery!;
  const applied = await applyRecovery(commitmentId, commitment, recovery, now);

  await appendEvent({
    type: 'RECOVERY_ACTION_SELECTED',
    entityType: 'commitment',
    entityId: commitmentId,
    ts: now,
    source: 'user',
    payload: {
      action: recovery.action,
      reason: submission.reason,
      missedDeadline: missedDeadline.toISOString(),
      detail: recovery as unknown as Record<string, unknown>,
      createdCommitmentIds: applied.createdCommitmentIds,
    },
  });

  return {
    recorded: true,
    action: recovery.action,
    effect: applied.effect,
    createdCommitmentIds: applied.createdCommitmentIds,
  };
}

interface StoredCommitment {
  _id: unknown;
  title: string;
  outcome: string;
  dueAt: Date;
  originalDueAt: Date;
  estimateMinutes: number;
  priority: Priority;
  status: string;
}

/**
 * Turns a recovery choice into a change the system can observe.
 *
 * Every branch writes something. If a branch here ever becomes a no-op, the
 * option it serves has stopped being a recovery and become a feeling.
 */
async function applyRecovery(
  commitmentId: string,
  commitment: StoredCommitment,
  recovery: RecoveryDetail,
  now: Date,
): Promise<{ effect: string; createdCommitmentIds: string[] }> {
  switch (recovery.action) {
    case 'reduce-scope': {
      await CommitmentModel.updateOne(
        { _id: commitmentId },
        { $set: { outcome: recovery.newOutcome, estimateMinutes: recovery.newEstimateMinutes } },
      );
      return {
        effect: `Scope cut. The outcome is now "${recovery.newOutcome}" at ${recovery.newEstimateMinutes} min.`,
        createdCommitmentIds: [],
      };
    }

    case 'split': {
      // Created now, not planned. A split that produces no documents is an
      // intention to split.
      const created: string[] = [];
      for (const part of recovery.parts) {
        const doc = await CommitmentModel.create({
          title: part.title,
          outcome: part.outcome,
          dueAt: part.dueAt,
          originalDueAt: part.dueAt,
          estimateMinutes: part.estimateMinutes,
          status: 'pending',
          priority: commitment.priority,
          createdAt: now,
        });
        created.push(String(doc._id));

        await appendEvent({
          type: 'COMMITMENT_CREATED',
          entityType: 'commitment',
          entityId: String(doc._id),
          ts: now,
          source: 'user',
          payload: { splitFrom: commitmentId, title: part.title },
        });
        await appendEvent({
          type: 'DEADLINE_SET',
          entityType: 'commitment',
          entityId: String(doc._id),
          ts: now,
          source: 'user',
          payload: { dueAt: part.dueAt.toISOString(), splitFrom: commitmentId },
        });

        await enqueueForCommitment(
          {
            id: String(doc._id),
            title: part.title,
            outcome: part.outcome,
            dueAt: part.dueAt,
            estimateMinutes: part.estimateMinutes,
            priority: commitment.priority,
          },
          await getSettings(),
          getEnv().APP_TIMEZONE,
          now,
        );
      }

      // The original is closed by the split: leaving it open would double-count
      // the same work and leave a permanently unreckonable parent.
      await CommitmentModel.updateOne(
        { _id: commitmentId },
        { $set: { status: 'abandoned', splitInto: created } },
      );
      await appendEvent({
        type: 'COMMITMENT_ABANDONED',
        entityType: 'commitment',
        entityId: commitmentId,
        ts: now,
        source: 'user',
        payload: { reason: 'Split into smaller commitments', splitInto: created },
      });
      await cancelPendingForCommitment(commitmentId);

      return {
        effect: `Split into ${created.length} commitments. The original is closed.`,
        createdCommitmentIds: created,
      };
    }

    case 'define-next-action': {
      await CommitmentModel.updateOne(
        { _id: commitmentId },
        { $set: { nextAction: recovery.nextAction } },
      );
      return {
        effect: `Next action set: "${recovery.nextAction}". It can be rescheduled now.`,
        createdCommitmentIds: [],
      };
    }

    case 'define-starting-action': {
      await CommitmentModel.updateOne(
        { _id: commitmentId },
        {
          $set: {
            nextAction: recovery.nextAction,
            // The starting action IS the commitment now. A 25-minute start you
            // will actually begin beats a two-hour block you will not.
            estimateMinutes: recovery.startingMinutes,
          },
        },
      );
      return {
        effect: `Starting action set: "${recovery.nextAction}" (${recovery.startingMinutes} min).`,
        createdCommitmentIds: [],
      };
    }

    case 'schedule-start-session': {
      const endsAt = new Date(recovery.startAt.getTime() + START_SESSION_MINUTES * 60_000);
      const doc = await CommitmentModel.create({
        title: `Start: ${commitment.title}`,
        outcome: `${START_SESSION_MINUTES} minutes of work on "${commitment.title}" has happened`,
        dueAt: endsAt,
        originalDueAt: endsAt,
        estimateMinutes: START_SESSION_MINUTES,
        status: 'pending',
        priority: commitment.priority,
        createdAt: now,
        startSessionFor: commitmentId,
      });

      await appendEvent({
        type: 'SESSION_SCHEDULED',
        entityType: 'commitment',
        entityId: commitmentId,
        ts: now,
        source: 'user',
        payload: {
          sessionId: String(doc._id),
          startAt: recovery.startAt.toISOString(),
          minutes: START_SESSION_MINUTES,
        },
      });
      await appendEvent({
        type: 'COMMITMENT_CREATED',
        entityType: 'commitment',
        entityId: String(doc._id),
        ts: now,
        source: 'user',
        payload: { startSessionFor: commitmentId },
      });

      await enqueueForCommitment(
        {
          id: String(doc._id),
          title: `Start: ${commitment.title}`,
          outcome: `${START_SESSION_MINUTES} minutes of work has happened`,
          dueAt: endsAt,
          estimateMinutes: START_SESSION_MINUTES,
          priority: commitment.priority,
        },
        await getSettings(),
        getEnv().APP_TIMEZONE,
        now,
      );

      return {
        effect: `A ${START_SESSION_MINUTES}-minute start session is on today's list.`,
        createdCommitmentIds: [String(doc._id)],
      };
    }

    case 'mark-blocked': {
      await CommitmentModel.updateOne(
        { _id: commitmentId },
        {
          $set: {
            status: 'blocked',
            blockedOn: recovery.blockedOn,
            followUpDate: recovery.followUpDate,
          },
        },
      );
      return {
        effect: `Blocked on ${recovery.blockedOn}. Follow up on ${recovery.followUpDate.toISOString().slice(0, 10)}.`,
        createdCommitmentIds: [],
      };
    }

    case 'lower-quality-bar': {
      await CommitmentModel.updateOne(
        { _id: commitmentId },
        // The lower bar becomes the outcome, so "done" now means the smaller
        // thing rather than the standard that caused the miss.
        { $set: { outcome: recovery.newOutcome } },
      );
      return {
        effect: `Quality bar lowered. Done now means: "${recovery.newOutcome}".`,
        createdCommitmentIds: [],
      };
    }

    case 'abandon': {
      await CommitmentModel.updateOne({ _id: commitmentId }, { $set: { status: 'abandoned' } });
      await appendEvent({
        type: 'COMMITMENT_ABANDONED',
        entityType: 'commitment',
        entityId: commitmentId,
        ts: now,
        source: 'user',
        payload: {
          reason: recovery.abandonReason ?? 'Abandoned during reckoning',
          viaReckoning: true,
        },
      });
      await cancelPendingForCommitment(commitmentId);

      return { effect: 'Abandoned, with the reason recorded.', createdCommitmentIds: [] };
    }

    case 'link-displacing-commitment': {
      await CommitmentModel.updateOne(
        { _id: commitmentId },
        { $set: { displacedBy: recovery.displacedBy } },
      );
      return {
        effect: 'Linked to the commitment that displaced it.',
        createdCommitmentIds: [],
      };
    }

    default: {
      // Exhaustiveness: a new action added to the schema without a branch here
      // is a compile error, not a silent no-op.
      const never: never = recovery;
      throw new CommitmentError(`Unhandled recovery action: ${JSON.stringify(never)}`, 400);
    }
  }
}
