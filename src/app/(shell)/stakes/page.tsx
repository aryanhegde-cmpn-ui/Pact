import { redirect } from 'next/navigation';

import { ClaimReward } from '@/components/stakes/claim-reward';
import { currentActor } from '@/lib/api/guard';
import { readState } from '@/lib/stakes/service';
import { CONSEQUENCE_STATUS_LABELS, MAX_CONSEQUENCE_WINDOW_DAYS } from '@/lib/schemas/stakes';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Stakes' };

/**
 * What is active, and what ends it.
 *
 * ---------------------------------------------------------------------------
 * THE EXPLANATION IS THE POINT.
 * ---------------------------------------------------------------------------
 * A consequence with no visible cause is arbitrary, and arbitrary stakes get
 * ignored rather than met. So every active consequence states why it fired, in
 * the numbers that fired it, and exactly what discharges it -- and the thing
 * that discharges it is always work, never a button on this page.
 *
 * `readState`, not `evaluateAndGetStakes`: opening this page must not be able
 * to activate anything. Evaluation belongs to the Today read.
 * ---------------------------------------------------------------------------
 */
export default async function StakesPage(): Promise<React.JSX.Element> {
  const actor = await currentActor();
  if (!actor) redirect('/');

  const stakes = await readState(actor.ownerId);
  const percent = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <div className="flex flex-col gap-2xl">
      <header className="pt-sm">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight">Stakes</h1>
        <p className="text-text/40 mt-xs text-sm">
          Configured by your overseer. This page reports; it does not decide.
        </p>
      </header>

      {stakes.onVacation ? (
        <section className="border-edge border-l-2 pl-md">
          <p className="text-sm">
            Vacation mode is on since{' '}
            <span className="figures">{stakes.vacationSince?.slice(0, 10)}</span>.
          </p>
          <p className="text-text/40 mt-2xs text-sm">
            Nothing is being evaluated. These days leave the adherence count rather than counting as
            misses — and an already-active consequence keeps running.
          </p>
        </section>
      ) : null}

      <section>
        <h2 className="text-text/40 mb-sm text-sm">adherence</h2>
        <p className="text-base">
          <span className="figures">{stakes.adherence.kept}</span> of{' '}
          <span className="figures">{stakes.adherence.of}</span> days with blocks, kept in full —{' '}
          <span className="figures">{percent(stakes.adherence.rate)}</span>.
        </p>
        <p className="text-text/40 mt-2xs text-sm">
          {stakes.adherence.sparse
            ? 'Too few days with blocks to act on yet. No trigger fires against this.'
            : 'A rolling rate over the last three weeks. Not a consecutive count.'}
          {stakes.adherence.vacationDays > 0
            ? ` ${stakes.adherence.vacationDays} day${stakes.adherence.vacationDays === 1 ? '' : 's'} excluded for vacation.`
            : ''}
        </p>
      </section>

      <section>
        <h2 className="text-text/40 mb-sm text-sm">consequences</h2>
        {stakes.consequences.length === 0 ? (
          <p className="text-text/50 text-sm">None configured.</p>
        ) : (
          <ul className="border-edge border-t">
            {stakes.consequences.map((consequence) => (
              <li key={consequence.id} className="border-edge border-b py-md">
                <div className="flex items-baseline justify-between gap-md">
                  <p className="min-w-0 flex-1 text-base">{consequence.name}</p>
                  <span className="text-text/40 shrink-0 text-sm">
                    {CONSEQUENCE_STATUS_LABELS[consequence.status]}
                  </span>
                </div>
                <p className="text-text/60 mt-2xs text-sm">{consequence.description}</p>

                {consequence.status === 'active' ? (
                  <>
                    {/* Why it fired, in the numbers that fired it. */}
                    {consequence.activationReason ? (
                      <p className="text-text/60 mt-sm text-sm">{consequence.activationReason}</p>
                    ) : null}
                    <p className="mt-2xs text-sm">
                      <span className="text-text/40">Discharged by: </span>
                      {consequence.dischargeLabel}
                    </p>
                    <p className="figures text-text/40 mt-2xs text-xs">
                      Expires {consequence.expiresAt?.slice(0, 10)} · at most{' '}
                      {MAX_CONSEQUENCE_WINDOW_DAYS} days
                    </p>
                  </>
                ) : (
                  <p className="text-text/40 mt-2xs text-xs">
                    Would be discharged by: {consequence.dischargeLabel}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-text/40 mb-sm text-sm">rewards</h2>
        {stakes.rewards.length === 0 ? (
          <p className="text-text/50 text-sm">None configured.</p>
        ) : (
          <ul className="border-edge border-t">
            {stakes.rewards.map((reward) => (
              <li key={reward.id} className="border-edge border-b py-md">
                <div className="flex items-baseline justify-between gap-md">
                  <p className="min-w-0 flex-1 text-base">{reward.name}</p>
                  <span className="text-text/40 shrink-0 text-sm">{reward.status}</span>
                </div>
                <p className="text-text/60 mt-2xs text-sm">{reward.description}</p>

                {/* Taking something already earned. It cannot earn anything. */}
                {reward.status === 'earned' ? (
                  <ClaimReward rewardId={reward.id} name={reward.name} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
