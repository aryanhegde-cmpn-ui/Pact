import { redirect } from 'next/navigation';

import { ReviewList } from '@/components/study/review-list';
import { currentActor } from '@/lib/api/guard';
import { gateDuringRecovery } from '@/lib/commitments/recovery-gate';
import { listFlagged } from '@/lib/curriculum/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Review targets' };

export default async function ReviewPage(): Promise<React.JSX.Element> {
  const actor = await currentActor();
  if (!actor) redirect('/');

  /**
   * Recovery mode takes this surface away, not just the dashboard.
   *
   * A planner is a whole surface for deciding what to do next, offered to
   * someone who already has more than they can keep. Reading it while behind
   * is how a backlog becomes a bigger plan.
   */
  await gateDuringRecovery(actor.ownerId);

  const flagged = await listFlagged(actor.ownerId);

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Review targets</h1>
        <p className="text-text/50 mt-2xs text-sm">
          {flagged.length} row{flagged.length === 1 ? '' : 's'} the importer could not read a target
          from. Nothing was guessed — a wrong silent parse is worse than an obvious gap.
        </p>
      </header>

      <ReviewList initial={flagged} />
    </div>
  );
}
