import 'server-only';

import { completeCommitment, type CommitmentView } from '@/lib/commitments/service';
import { appendEvent } from '@/lib/db/events';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { CurriculumTopicModel } from '@/lib/db/models/curriculum-topic';
import { FocusSessionModel } from '@/lib/db/models/focus-session';
import { connectToDatabase } from '@/lib/db/mongoose';
import { setTopicProgress } from '@/lib/curriculum/service';
import {
  budgetDecisionSchema,
  endSessionSchema,
  startSessionSchema,
  type BudgetDecision,
  type EndSessionInput,
  type SessionKind,
  type TopicProgressReport,
} from '@/lib/schemas/focus';
import type { TargetKind } from '@/lib/schemas/curriculum';

/**
 * Focus sessions.
 *
 * ---------------------------------------------------------------------------
 * THE SERVER HOLDS THE CLOCK.
 * ---------------------------------------------------------------------------
 * `startedAt` is written here and elapsed time is derived from it on every
 * read. `actualMinutes` is computed at the end, on the server, from
 * `endedAt - startedAt`. The browser is never asked how long anything took and
 * could not be believed if it were.
 *
 * That is not paranoia about tampering, it is the ordinary case: a study block
 * is 60 to 90 minutes with the phone locked, and a backgrounded tab's timers
 * are throttled to once a minute or stopped entirely. A client-side counter
 * would report a ninety-minute session as a few minutes and nothing would look
 * wrong.
 * ---------------------------------------------------------------------------
 */

const DUPLICATE_KEY = 11_000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === DUPLICATE_KEY
  );
}

export class SessionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface ActiveSession {
  id: string;
  commitmentId: string;
  commitment: {
    title: string;
    outcome: string;
    estimateMinutes: number;
    dueAt: string;
    blockId: string | null;
  };
  topicKey: string | null;
  topicLabel: string | null;
  /** What the target asks for, so the completion form knows what to ask. */
  topicTargetKind: TargetKind | null;
  topicTargetLabel: string | null;
  kind: SessionKind;
  startedAt: string;
  /** The server's clock at the moment of this response. The client's is not trusted. */
  serverNow: string;
  plannedMinutes: number | null;
  /** Derived here, from the server clock. Never accumulated by the browser. */
  elapsedSeconds: number;
  interruptionCount: number;
  researchBudgetMinutes: number | null;
  /** True once the budget is spent. Only meaningful for a research session. */
  budgetSpent: boolean;
  /** True once the single interruption has been shown. Never shown twice. */
  budgetWarned: boolean;
}

/** Elapsed seconds, from the server clock. The one definition. */
export function elapsedSeconds(startedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
}

/**
 * Minutes a session lasted.
 *
 * Rounded, and never below one: a session that genuinely happened and lasted
 * forty seconds is not zero minutes of work, and a zero would make the
 * estimate-versus-actual history quietly wrong in the direction of flattery.
 */
export function actualMinutes(startedAt: Date, endedAt: Date): number {
  return Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000));
}

async function describeTopic(ownerId: string, topicKey: string | null) {
  if (!topicKey) {
    return { topicLabel: null, topicTargetKind: null, topicTargetLabel: null };
  }

  const topic = await CurriculumTopicModel.findOne({ ownerId, stableKey: topicKey }).lean();
  if (!topic) return { topicLabel: null, topicTargetKind: null, topicTargetLabel: null };

  return {
    topicLabel: topic.subTopic ? `${topic.topic} · ${topic.subTopic}` : topic.topic,
    topicTargetKind: (topic.target?.kind ?? 'other') as TargetKind,
    // The workbook's own words. Never a parsed target dressed up as one.
    topicTargetLabel: topic.practiceRaw,
  };
}

async function toActive(
  session: Record<string, unknown>,
  ownerId: string,
  now: Date,
): Promise<ActiveSession> {
  const commitment = await CommitmentModel.findOne({
    _id: session.commitmentId as string,
    ownerId,
  }).lean();
  if (!commitment) throw new SessionError('The commitment for this session is gone.', 404);

  const topic = await describeTopic(ownerId, (session.topicKey as string | null) ?? null);
  const startedAt = session.startedAt as Date;
  const budget = session.researchBudgetMinutes as number | null;
  const extended = (session.budgetExtendedBy as number | null) ?? 0;

  return {
    id: String(session._id),
    commitmentId: session.commitmentId as string,
    commitment: {
      title: commitment.title,
      outcome: commitment.outcome,
      estimateMinutes: commitment.estimateMinutes,
      dueAt: commitment.dueAt.toISOString(),
      blockId: commitment.blockId ?? null,
    },
    topicKey: (session.topicKey as string | null) ?? null,
    ...topic,
    kind: session.kind as SessionKind,
    startedAt: startedAt.toISOString(),
    serverNow: now.toISOString(),
    plannedMinutes: (session.plannedMinutes as number | null) ?? null,
    elapsedSeconds: elapsedSeconds(startedAt, now),
    interruptionCount: (session.interruptionCount as number) ?? 0,
    researchBudgetMinutes: budget,
    budgetSpent: budget !== null && elapsedSeconds(startedAt, now) >= (budget + extended) * 60,
    // `?? null` because absent and null are the same fact here, and a row
    // written before this field existed has neither.
    budgetWarned: ((session.budgetWarnedAt as Date | null | undefined) ?? null) !== null,
  };
}

/** The running session, or null. The lock and the timer both read this. */
export async function getActiveSession(
  ownerId: string,
  now: Date = new Date(),
): Promise<ActiveSession | null> {
  await connectToDatabase();

  const session = await FocusSessionModel.findOne({ ownerId, endedAt: null }).lean();
  if (!session) return null;

  return toActive(session as unknown as Record<string, unknown>, ownerId, now);
}

export async function startSession(
  input: unknown,
  ownerId: string,
  now: Date = new Date(),
): Promise<ActiveSession> {
  const parsed = startSessionSchema.parse(input);
  await connectToDatabase();

  const commitment = await CommitmentModel.findOne({
    _id: parsed.commitmentId,
    ownerId,
  }).lean();
  if (!commitment) throw new SessionError('No such commitment.', 404);
  if (commitment.status === 'done' || commitment.status === 'abandoned') {
    throw new SessionError('That commitment is already closed.', 409);
  }

  try {
    const created = await FocusSessionModel.create({
      ownerId,
      commitmentId: parsed.commitmentId,
      topicKey: commitment.curriculumTopicKey ?? null,
      blockId: commitment.blockId ?? null,
      startedAt: now,
      endedAt: null,
      plannedMinutes: parsed.plannedMinutes ?? commitment.estimateMinutes,
      kind: parsed.kind,
      researchBudgetMinutes:
        parsed.kind === 'research' ? (parsed.researchBudgetMinutes ?? null) : null,
      interruptionCount: 0,
      createdAt: now,
    });

    await appendEvent({
      type: 'SESSION_STARTED',
      entityType: 'session',
      entityId: String(created._id),
      ownerId,
      ts: now,
      source: 'user',
      payload: {
        commitmentId: parsed.commitmentId,
        kind: parsed.kind,
        topicKey: commitment.curriculumTopicKey ?? null,
        blockId: commitment.blockId ?? null,
        plannedMinutes: parsed.plannedMinutes ?? commitment.estimateMinutes,
        researchBudgetMinutes: parsed.researchBudgetMinutes ?? null,
      },
    });

    // Started, so the commitment is in progress. Not a status the user sets.
    if (commitment.status === 'pending') {
      await CommitmentModel.updateOne(
        { _id: parsed.commitmentId, ownerId },
        { $set: { status: 'in-progress', startedAt: commitment.startedAt ?? now } },
      );

      await appendEvent({
        type: 'COMMITMENT_STARTED',
        entityType: 'commitment',
        entityId: parsed.commitmentId,
        ownerId,
        ts: now,
        source: 'user',
        payload: { sessionId: String(created._id) },
      });
    }

    const active = await getActiveSession(ownerId, now);
    if (!active) throw new SessionError('The session did not start.', 500);

    return active;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    /**
     * One session at a time, enforced by the unique index rather than by
     * checking first -- which races between the check and the write, and a
     * second tab is exactly the thing that produces that race.
     */
    const running = await getActiveSession(ownerId, now);
    if (running && running.commitmentId === parsed.commitmentId) return running;

    throw new SessionError('A session is already running.', 409);
  }
}

/** Interruptions are counted, not prevented. Cheap, and honest about focus. */
export async function recordInterruption(ownerId: string): Promise<number> {
  await connectToDatabase();

  const result = await FocusSessionModel.findOneAndUpdate(
    { ownerId, endedAt: null },
    { $inc: { interruptionCount: 1 } },
    { returnDocument: 'after' },
  ).lean();

  if (!result) throw new SessionError('No session is running.', 409);

  return result.interruptionCount;
}

/**
 * The research budget's single interruption.
 *
 * One, ever. A budget that nags gets dismissed reflexively, and then it is not
 * a decision point, it is noise -- so `budgetWarnedAt` is set the moment the
 * question is answered and nothing asks again.
 */
export async function decideBudget(
  input: unknown,
  ownerId: string,
  now: Date = new Date(),
): Promise<ActiveSession> {
  const decision: BudgetDecision = budgetDecisionSchema.parse(input);
  await connectToDatabase();

  const session = await FocusSessionModel.findOne({ ownerId, endedAt: null }).lean();
  if (!session) throw new SessionError('No session is running.', 409);
  if (session.budgetWarnedAt) {
    // Already answered. A retried request is not an error.
    const active = await getActiveSession(ownerId, now);
    if (!active) throw new SessionError('No session is running.', 409);

    return active;
  }

  await FocusSessionModel.updateOne(
    { ownerId, _id: session._id, endedAt: null },
    {
      $set: {
        budgetWarnedAt: now,
        ...(decision.decision === 'execute'
          ? { kind: 'execution' }
          : {
              budgetExtendedBy: (session.budgetExtendedBy ?? 0) + decision.extraMinutes,
              budgetJustification: decision.justification,
            }),
      },
    },
  );

  await appendEvent({
    type: 'RESEARCH_BUDGET_SPENT',
    entityType: 'session',
    entityId: String(session._id),
    ownerId,
    ts: now,
    source: 'user',
    payload: {
      budgetMinutes: session.researchBudgetMinutes,
      decision: decision.decision,
      ...(decision.decision === 'extend'
        ? { extraMinutes: decision.extraMinutes, justification: decision.justification }
        : {}),
    },
  });

  const active = await getActiveSession(ownerId, now);
  if (!active) throw new SessionError('No session is running.', 409);

  return active;
}

export interface EndSessionResult {
  actualMinutes: number;
  plannedMinutes: number | null;
  outcome: EndSessionInput['outcome'];
  /** What the session did, in words, for the surface to confirm back. */
  effect: string;
  commitment: CommitmentView | null;
  /** Set when a block session advanced its topic. */
  topicStatus: string | null;
}

/**
 * Translates a progress report into a topic status.
 *
 * `more-time` never reaches here: a session that ran out of time leaves the
 * topic in-progress, which is the truth about it and the reason it is
 * preferred for that block tomorrow.
 */
function topicStatusFor(
  targetKind: TargetKind | null,
  report: TopicProgressReport | undefined,
): 'in-progress' | 'done' | 'needs-revision' {
  if (report?.needsRevision) return 'needs-revision';

  if (targetKind === 'problems') {
    // Any problems at all is progress; the target's own count decides done,
    // and the user says so by not asking for more time.
    return (report?.problemsSolved ?? 0) > 0 ? 'done' : 'in-progress';
  }

  if (targetKind === 'build') return report?.buildFinished ? 'done' : 'in-progress';

  return 'done';
}

export async function endSession(
  input: unknown,
  ownerId: string,
  now: Date = new Date(),
): Promise<EndSessionResult> {
  const parsed = endSessionSchema.parse(input);
  await connectToDatabase();

  const session = await FocusSessionModel.findOne({ ownerId, endedAt: null }).lean();
  if (!session) throw new SessionError('No session is running.', 409);

  const minutes = actualMinutes(session.startedAt, now);
  const commitmentId = session.commitmentId;

  /**
   * Claimed before anything else happens.
   *
   * A conditional update on `endedAt: null`, so two tabs ending the same
   * session cannot both complete the commitment and both write events. The
   * loser sees `modifiedCount: 0`.
   */
  const claimed = await FocusSessionModel.updateOne(
    { ownerId, _id: session._id, endedAt: null },
    {
      $set: {
        endedAt: now,
        // From the server clock. Never sent by the client.
        actualMinutes: minutes,
        outcome: parsed.outcome,
        notes: 'note' in parsed ? (parsed.note ?? '') : '',
        ...(parsed.outcome === 'blocked'
          ? { blockerKind: parsed.blockerKind, blocker: parsed.blocker }
          : {}),
      },
    },
  );

  if ((claimed.modifiedCount ?? 0) === 0) throw new SessionError('No session is running.', 409);

  await appendEvent({
    type: 'SESSION_ENDED',
    entityType: 'session',
    entityId: String(session._id),
    ownerId,
    ts: now,
    source: 'user',
    payload: {
      commitmentId,
      outcome: parsed.outcome,
      kind: session.kind,
      actualMinutes: minutes,
      plannedMinutes: session.plannedMinutes,
      interruptionCount: session.interruptionCount,
      topicKey: session.topicKey,
      blockId: session.blockId,
    },
  });

  let commitment: CommitmentView | null = null;
  let topicStatus: string | null = null;
  let effect: string;

  switch (parsed.outcome) {
    case 'done': {
      commitment = await completeCommitment(commitmentId, ownerId, now);
      if (parsed.note) {
        await CommitmentModel.updateOne(
          { _id: commitmentId, ownerId },
          { $set: { notes: parsed.note } },
        );
      }

      /**
       * A block session advances its topic. This is the whole reason the block
       * is the commitment and the topic is the content: without it, finishing
       * a block says nothing about the material and the two never connect.
       */
      if (session.topicKey) {
        const topic = await describeTopic(ownerId, session.topicKey);
        const status = topicStatusFor(topic.topicTargetKind, parsed.topicProgress);
        topicStatus = status;

        await setTopicProgress(
          {
            stableKey: session.topicKey,
            status,
            ...(parsed.topicProgress?.note ? { note: parsed.topicProgress.note } : {}),
          },
          ownerId,
          now,
        );

        await appendEvent({
          type: 'PROGRESS_LOGGED',
          entityType: 'topic',
          entityId: session.topicKey,
          ownerId,
          ts: now,
          source: 'user',
          payload: {
            sessionId: String(session._id),
            minutes,
            status: topicStatus,
            problemsSolved: parsed.topicProgress?.problemsSolved ?? null,
            buildFinished: parsed.topicProgress?.buildFinished ?? null,
          },
        });
      }

      effect = `Done in ${minutes} minutes against an estimate of ${session.plannedMinutes ?? '—'}.`;
      break;
    }

    case 'more-time': {
      /**
       * NOT A FAILURE. The commitment stays open, its estimate is corrected,
       * and the topic stays in-progress -- which is what makes it the preferred
       * suggestion for that block tomorrow.
       *
       * Nothing here completes, abandons, or records a miss. An app that
       * penalised this would teach the user to stop reporting it, and then
       * every estimate in the history would be fiction.
       */
      await CommitmentModel.updateOne(
        { _id: commitmentId, ownerId },
        { $set: { estimateMinutes: parsed.revisedEstimateMinutes, status: 'in-progress' } },
      );

      if (session.topicKey) {
        topicStatus = 'in-progress';
        await setTopicProgress(
          { stableKey: session.topicKey, status: 'in-progress' },
          ownerId,
          now,
        );
      }

      await appendEvent({
        type: 'PROGRESS_LOGGED',
        entityType: 'commitment',
        entityId: commitmentId,
        ownerId,
        ts: now,
        source: 'user',
        payload: {
          sessionId: String(session._id),
          minutes,
          previousEstimateMinutes: session.plannedMinutes,
          revisedEstimateMinutes: parsed.revisedEstimateMinutes,
          topicKey: session.topicKey,
          note: parsed.note ?? null,
        },
      });

      effect = `${minutes} minutes of work logged. Estimate revised to ${parsed.revisedEstimateMinutes}.`;
      break;
    }

    case 'blocked': {
      await CommitmentModel.updateOne(
        { _id: commitmentId, ownerId },
        {
          $set: {
            status: 'blocked',
            ...(parsed.blockerKind === 'person' ? { blockedOn: parsed.blocker } : {}),
            ...(parsed.followUpAt ? { followUpDate: parsed.followUpAt } : {}),
          },
        },
      );

      await appendEvent({
        type: 'TASK_BLOCKED',
        entityType: 'commitment',
        entityId: commitmentId,
        ownerId,
        ts: now,
        source: 'user',
        payload: {
          sessionId: String(session._id),
          blockerKind: parsed.blockerKind,
          blocker: parsed.blocker,
          minutes,
        },
      });

      /**
       * A blocker that is a person gets a follow-up, because "waiting on
       * someone" with no date attached is how a commitment sits blocked for a
       * month with nobody having chased anything.
       */
      if (parsed.blockerKind === 'person' && parsed.createFollowUp && parsed.followUpAt) {
        const follow = await CommitmentModel.create({
          title: `Chase ${parsed.blocker}`,
          outcome: `${parsed.blocker} has replied about it`,
          dueAt: parsed.followUpAt,
          originalDueAt: parsed.followUpAt,
          estimateMinutes: 10,
          status: 'pending',
          priority: 'important',
          ownerId,
          createdAt: now,
          notes: '',
        });

        await appendEvent({
          type: 'COMMITMENT_CREATED',
          entityType: 'commitment',
          entityId: String(follow._id),
          ownerId,
          ts: now,
          source: 'system',
          payload: { followUpFor: commitmentId, blocker: parsed.blocker },
        });
      }

      effect = `Blocked on ${parsed.blocker}. ${minutes} minutes recorded.`;
      break;
    }
  }

  return {
    actualMinutes: minutes,
    plannedMinutes: session.plannedMinutes ?? null,
    outcome: parsed.outcome,
    effect,
    commitment,
    topicStatus,
  };
}
