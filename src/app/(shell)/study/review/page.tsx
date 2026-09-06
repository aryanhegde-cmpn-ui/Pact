import { redirect } from 'next/navigation';

import { ReviewList } from '@/components/study/review-list';
import { currentActor } from '@/lib/api/guard';
import { listFlagged } from '@/lib/curriculum/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Review targets' };

export default async function ReviewPage(): Promise<React.JSX.Element> {
  const actor = await currentActor();
  if (!actor) redirect('/');

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
