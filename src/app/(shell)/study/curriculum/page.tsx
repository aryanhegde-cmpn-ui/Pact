import { redirect } from 'next/navigation';

import { CurriculumBrowser } from '@/components/study/curriculum-browser';
import { currentActor } from '@/lib/api/guard';
import { gateDuringRecovery } from '@/lib/commitments/recovery-gate';
import { getCurriculumBrowser, listResources } from '@/lib/curriculum/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Curriculum' };

export default async function CurriculumPage(): Promise<React.JSX.Element> {
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

  const [blocks, resources] = await Promise.all([
    getCurriculumBrowser(actor.ownerId),
    listResources(actor.ownerId),
  ]);

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Curriculum</h1>
        <p className="text-text/50 mt-2xs text-sm">
          Block, then module, then topic — the order of the sheet.
        </p>
      </header>

      {blocks.length === 0 ? (
        <p className="text-text/50 text-sm">Nothing imported yet.</p>
      ) : (
        <CurriculumBrowser initial={blocks} resources={resources} />
      )}
    </div>
  );
}
