import { redirect } from 'next/navigation';

import { PhaseList } from '@/components/study/phase-list';
import { currentActor } from '@/lib/api/guard';
import { gateDuringRecovery } from '@/lib/commitments/recovery-gate';
import { getPhaseView, listInterviewPrep } from '@/lib/curriculum/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Phases' };

export default async function PhasesPage(): Promise<React.JSX.Element> {
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

  const [phases, interviewPrep] = await Promise.all([
    getPhaseView(actor.ownerId),
    listInterviewPrep(actor.ownerId),
  ]);

  const rehearsalFrom = interviewPrep[0]?.rehearsalFrom;
  const rehearsalOpen = interviewPrep.some((item) => item.rehearsalOpen);

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Phases</h1>
        <p className="text-text/50 mt-2xs text-sm">
          The plan holds and shows the gap. It never re-flows on its own.
        </p>
      </header>

      {phases.length === 0 ? (
        <p className="text-text/50 text-sm">Nothing imported yet.</p>
      ) : (
        <PhaseList initial={phases} />
      )}

      {interviewPrep.length > 0 ? (
        <section>
          <h2 className="text-base font-medium">Interview rehearsal</h2>
          {/*
            The gate is a date on the document, so this renders a fact rather
            than deciding one. Before it, the sheet's instruction is to keep
            collecting examples and metrics from work -- so the items are
            shown, and only the rehearsal is not yet open.
          */}
          <p className="text-text/50 mt-2xs text-sm">
            {rehearsalOpen
              ? 'Serious rehearsal is open.'
              : `Serious rehearsal opens ${rehearsalFrom}. Until then, collect examples and metrics from work.`}
          </p>

          <ul className="mt-sm flex flex-col gap-xs">
            {interviewPrep.map((item) => (
              <li key={item.stableKey} className="border-edge bg-surface rounded-lg border p-sm">
                <p className="text-sm">
                  {item.topic}
                  <span className="text-text/40 ml-xs text-xs">{item.category}</span>
                </p>
                <p className="text-text/50 mt-2xs text-xs">{item.whatToMaster}</p>
                <p className="text-text/40 mt-2xs text-xs">
                  {item.rehearsalOpen ? item.practice : 'Collecting'}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
