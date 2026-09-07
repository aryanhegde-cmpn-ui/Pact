'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { StakesState } from '@/lib/stakes/service';
import {
  DISCHARGE_LABELS,
  MAX_CONSEQUENCE_WINDOW_DAYS,
  TRIGGER_LABELS,
  triggerKindSchema,
} from '@/lib/schemas/stakes';

/**
 * The overseer's configuration surface.
 *
 * Plain and functional: this account is opened occasionally, not daily, so it
 * is two forms and two lists rather than a dashboard. Nothing here is styled
 * to reward the overseer for using it.
 */
export function OverseerStakes({ initial }: { initial: StakesState }): React.JSX.Element {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const percent = (value: number) => `${Math.round(value * 100)}%`;

  async function post(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string; details?: unknown };
        setError(payload.error ?? 'That did not save.');
        return false;
      }

      router.refresh();
      return true;
    } catch {
      setError('That did not save.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2xl">
      <section>
        <h2 className="text-text/40 mb-sm text-sm">where they stand</h2>
        <p className="text-base">
          <span className="figures">{initial.adherence.kept}</span> of{' '}
          <span className="figures">{initial.adherence.of}</span> days with blocks, kept in full —{' '}
          <span className="figures">{percent(initial.adherence.rate)}</span> over the last three
          weeks.
        </p>
        <p className="text-text/40 mt-2xs text-sm">
          {initial.onVacation ? 'Vacation mode is on; nothing is being evaluated. ' : ''}
          {initial.adherence.sparse ? 'Too few days with blocks for a trigger to fire yet. ' : ''}
          {initial.adherence.vacationDays > 0
            ? `${initial.adherence.vacationDays} days excluded for vacation.`
            : ''}
        </p>
      </section>

      {error ? <p className="text-signal text-sm">{error}</p> : null}

      <section>
        <h2 className="text-text/40 mb-sm text-sm">consequences</h2>

        <ul className="border-edge mb-lg border-t">
          {initial.consequences.map((consequence) => (
            <li key={consequence.id} className="border-edge border-b py-sm">
              <div className="flex items-baseline justify-between gap-md">
                <span className="min-w-0 flex-1 text-sm">{consequence.name}</span>
                <span className="text-text/40 shrink-0 text-sm">{consequence.status}</span>
              </div>
              <p className="text-text/40 text-xs">
                {consequence.dischargeLabel} ·{' '}
                <span className="figures">{consequence.windowDays}</span> day window
              </p>
            </li>
          ))}
          {initial.consequences.length === 0 ? (
            <li className="text-text/50 py-sm text-sm">None yet.</li>
          ) : null}
        </ul>

        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const threshold = Number(data.get('thresholdRate') ?? 70) / 100;

            const ok = await post('/api/stakes/consequences', {
              name: String(data.get('name') ?? ''),
              description: String(data.get('description') ?? ''),
              trigger: 'adherence-threshold',
              triggerConfig: { thresholdRate: threshold },
              windowDays: Number(data.get('windowDays') ?? 3),
              // Tied to what triggered it: get back above the line that was
              // crossed. Discharge is always the work, never a dismissal.
              dischargeCondition: { kind: 'adherence-recovered', thresholdRate: threshold },
            });
            if (ok) event.currentTarget.reset();
          }}
          aria-label="Add a consequence"
          className="grid gap-sm sm:grid-cols-2"
        >
          <input
            name="name"
            required
            placeholder="What is withheld"
            className="border-edge bg-ground min-h-11 rounded border px-sm text-sm sm:col-span-2"
          />
          <input
            name="description"
            required
            placeholder="Describe it, in a sentence they will read"
            className="border-edge bg-ground min-h-11 rounded border px-sm text-sm sm:col-span-2"
          />

          <label className="flex items-center gap-sm text-sm">
            <span className="text-text/50">Fires below</span>
            <input
              name="thresholdRate"
              type="number"
              min={1}
              max={100}
              defaultValue={70}
              className="border-edge bg-ground figures min-h-11 w-20 rounded border px-sm text-sm"
            />
            <span className="text-text/50">% adherence</span>
          </label>

          <label className="flex items-center gap-sm text-sm">
            <span className="text-text/50">Runs for</span>
            <input
              name="windowDays"
              type="number"
              min={1}
              max={MAX_CONSEQUENCE_WINDOW_DAYS}
              defaultValue={3}
              className="border-edge bg-ground figures min-h-11 w-20 rounded border px-sm text-sm"
            />
            <span className="text-text/50">days, at most {MAX_CONSEQUENCE_WINDOW_DAYS}</span>
          </label>

          {/*
            The cap is in the schema, not this input. A cap that only exists in
            the form is a cap the API does not have.
          */}
          <p className="text-text/40 text-xs sm:col-span-2">
            Discharged by: {DISCHARGE_LABELS['adherence-recovered']}. It also expires at its window,
            whether or not it is discharged.
          </p>

          <button
            type="submit"
            disabled={busy}
            className="border-edge hover:border-signal min-h-11 rounded border px-md text-sm transition-colors sm:col-span-2 sm:justify-self-start"
          >
            Add consequence
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-text/40 mb-sm text-sm">rewards</h2>

        <ul className="border-edge mb-lg border-t">
          {initial.rewards.map((reward) => (
            <li key={reward.id} className="border-edge border-b py-sm">
              <div className="flex items-baseline justify-between gap-md">
                <span className="min-w-0 flex-1 text-sm">{reward.name}</span>
                <span className="text-text/40 shrink-0 text-sm">{reward.status}</span>
              </div>
              <p className="text-text/40 text-xs">{TRIGGER_LABELS[reward.trigger]}</p>

              {reward.trigger === 'manual-grant' && reward.status === 'available' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void post('/api/stakes/grant', { rewardId: reward.id })}
                  className="border-edge hover:border-signal mt-xs min-h-11 rounded border px-sm text-xs transition-colors"
                >
                  Grant it
                </button>
              ) : null}
            </li>
          ))}
          {initial.rewards.length === 0 ? (
            <li className="text-text/50 py-sm text-sm">None yet.</li>
          ) : null}
        </ul>

        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const trigger = String(data.get('trigger') ?? 'adherence-threshold');

            const ok = await post('/api/stakes/rewards', {
              name: String(data.get('name') ?? ''),
              description: String(data.get('description') ?? ''),
              trigger,
              triggerConfig:
                trigger === 'adherence-threshold'
                  ? { thresholdRate: Number(data.get('thresholdRate') ?? 85) / 100 }
                  : {},
            });
            if (ok) event.currentTarget.reset();
          }}
          aria-label="Add a reward"
          className="grid gap-sm sm:grid-cols-2"
        >
          <input
            name="name"
            required
            placeholder="What they get"
            className="border-edge bg-ground min-h-11 rounded border px-sm text-sm sm:col-span-2"
          />
          <input
            name="description"
            required
            placeholder="Describe it"
            className="border-edge bg-ground min-h-11 rounded border px-sm text-sm sm:col-span-2"
          />

          <label className="flex flex-col gap-2xs">
            <span className="text-text/50 text-xs">Trigger</span>
            <select
              name="trigger"
              defaultValue="adherence-threshold"
              className="border-edge bg-ground min-h-11 rounded border px-sm text-sm"
            >
              {triggerKindSchema.options.map((option) => (
                <option key={option} value={option}>
                  {TRIGGER_LABELS[option]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-sm text-sm">
            <span className="text-text/50">At or above</span>
            <input
              name="thresholdRate"
              type="number"
              min={1}
              max={100}
              defaultValue={85}
              className="border-edge bg-ground figures min-h-11 w-20 rounded border px-sm text-sm"
            />
            <span className="text-text/50">% adherence</span>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="border-edge hover:border-signal min-h-11 rounded border px-md text-sm transition-colors sm:col-span-2 sm:justify-self-start"
          >
            Add reward
          </button>
        </form>
      </section>
    </div>
  );
}
