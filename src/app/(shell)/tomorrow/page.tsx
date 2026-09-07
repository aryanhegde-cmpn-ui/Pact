import { redirect } from 'next/navigation';

import { BlockLedger } from '@/components/today/block-ledger';
import { BlockRing } from '@/components/today/block-ring';
import { NextAction } from '@/components/today/next-action';
import { currentActor } from '@/lib/api/guard';
import { gateDuringRecovery } from '@/lib/commitments/recovery-gate';
import { buildTomorrow } from '@/lib/today/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tomorrow' };

/**
 * Tomorrow.
 *
 * The same day-builder with a different date, so the two cannot drift apart.
 * What differs is the register: no Start button on the next action, because
 * starting tomorrow's block today is done from the ledger and deserves to be
 * a deliberate tap rather than the biggest button on the page.
 */
export default async function TomorrowPage(): Promise<React.JSX.Element> {
  const actor = await currentActor();
  if (!actor) redirect('/');

  // Tomorrow is a planning surface, which is exactly what recovery removes.
  await gateDuringRecovery(actor.ownerId);

  const day = await buildTomorrow(actor.ownerId);

  return (
    <div className="flex flex-col gap-2xl">
      <header className="pt-sm">
        <p className="text-text/40 text-sm">{day.dateLine}</p>
        <h1 className="mt-xs text-2xl leading-tight font-semibold tracking-tight">Tomorrow</h1>
      </header>

      {/*
        Recognised, as a message, never as a badge. Finishing tomorrow's work
        today is a real thing to notice; a collectible for it would be the
        reward layer this app exists without.
      */}
      {day.aheadOfSchedule ? (
        <p className="border-edge border-l-2 pl-md text-base">
          {day.blocksDone} of tomorrow&apos;s blocks {day.blocksDone === 1 ? 'is' : 'are'} already
          done. You are ahead of the plan.
        </p>
      ) : null}

      {day.next ? <NextAction next={day.next} interactive={false} /> : null}

      {day.blocks.length > 0 ? (
        <section className="flex flex-col gap-lg lg:flex-row lg:items-start lg:gap-2xl">
          <div className="lg:order-2 lg:w-64 lg:shrink-0">
            <BlockRing
              done={day.blocksDone}
              total={day.blocks.length}
              label="blocks for tomorrow"
            />
          </div>
          <div className="min-w-0 flex-1 lg:order-1">
            <BlockLedger blocks={day.blocks} />
          </div>
        </section>
      ) : (
        <p className="text-text/40 text-sm">No blocks scheduled for tomorrow.</p>
      )}

      {day.alsoToday.length > 0 ? (
        <section>
          <h2 className="text-text/40 mb-sm text-sm">also due</h2>
          <ul className="border-edge border-t">
            {day.alsoToday.map((commitment) => (
              <li
                key={commitment.id}
                className="border-edge flex items-baseline gap-md border-b py-sm"
              >
                <span className="min-w-0 flex-1 text-base">{commitment.title}</span>
                <span className="figures text-text/40 shrink-0 text-sm">
                  {new Date(commitment.dueAt).toISOString().slice(11, 16)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
