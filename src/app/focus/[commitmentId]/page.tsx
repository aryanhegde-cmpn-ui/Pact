import { redirect } from 'next/navigation';

import { FocusSession } from '@/components/focus/focus-session';
import { StartSession } from '@/components/focus/start-session';
import { currentActor } from '@/lib/api/guard';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getActiveSession } from '@/lib/focus/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Session' };

/**
 * The session screen.
 *
 * Deliberately OUTSIDE `(shell)`: no sidebar, no tab bar, no notification
 * badge. A screen with somewhere to go is a screen you go from, and the whole
 * value of a focus session is that for the next ninety minutes there is
 * nowhere else.
 */
export default async function FocusPage({
  params,
}: {
  params: Promise<{ commitmentId: string }>;
}): Promise<React.JSX.Element> {
  const actor = await currentActor();
  if (!actor) redirect('/');

  const { commitmentId } = await params;
  await connectToDatabase();

  const active = await getActiveSession(actor.ownerId);

  /**
   * A session already running for something else wins.
   *
   * Navigating here with another session live would otherwise silently show a
   * start screen for a second one, and the unique index would refuse it at the
   * last moment with an error rather than an explanation.
   */
  if (active) {
    if (active.commitmentId !== commitmentId) redirect(`/focus/${active.commitmentId}`);

    return <FocusSession initial={active} />;
  }

  const commitment = await CommitmentModel.findOne({
    _id: commitmentId,
    ownerId: actor.ownerId,
  }).lean();
  if (!commitment) redirect('/dashboard');

  return (
    <StartSession
      commitment={{
        id: String(commitment._id),
        title: commitment.title,
        outcome: commitment.outcome,
        estimateMinutes: commitment.estimateMinutes,
        dueAt: commitment.dueAt.toISOString(),
        blockId: commitment.blockId ?? null,
        topicKey: commitment.curriculumTopicKey ?? null,
      }}
    />
  );
}
