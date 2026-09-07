import Link from 'next/link';
import { redirect } from 'next/navigation';

import { TodayBlocks } from '@/components/study/today-blocks';
import { currentActor } from '@/lib/api/guard';
import { gateDuringRecovery } from '@/lib/commitments/recovery-gate';
import { getStudyToday } from '@/lib/curriculum/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Study' };

/**
 * Today's three blocks.
 *
 * Rendered on the server so the first paint already has the plan. Reading is
 * also what materialises the day's occurrences -- there is no scheduler, and
 * nothing will have run before this.
 */
export default async function StudyPage(): Promise<React.JSX.Element> {
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

  const today = await getStudyToday(actor.ownerId);

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-wrap items-baseline justify-between gap-sm">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Study</h1>
          <p className="text-text/50 mt-2xs text-sm">{today.date}</p>
        </div>

        <nav className="flex gap-md text-sm">
          <Link href="/study/curriculum" className="text-text/60 hover:text-signal underline">
            Curriculum
          </Link>
          <Link href="/study/phases" className="text-text/60 hover:text-signal underline">
            Phases
          </Link>
          <Link href="/study/review" className="text-text/60 hover:text-signal underline">
            Review
          </Link>
        </nav>
      </header>

      <TodayBlocks initial={today} />
    </div>
  );
}
