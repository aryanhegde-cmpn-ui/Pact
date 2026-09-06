import { redirect } from 'next/navigation';

import { currentActor } from '@/lib/api/guard';
import { buildOverseerSnapshot } from '@/lib/commitments/overseer-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Overseer' };

/**
 * The overseer's surface.
 *
 * Deliberately plain. Its job in this change is to prove the permission
 * boundary holds: categories are visible, free text is not unless the primary
 * has opted in, and nothing here can write.
 */
export default async function OverseerPage(): Promise<React.JSX.Element> {
  const actor = await currentActor();
  if (!actor) redirect('/');

  const snapshot = await buildOverseerSnapshot(actor.ownerId);
  const { adherence } = snapshot;

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">The record</h1>
        <p className="text-text/50 mt-2xs text-sm">
          {/* A rolling rate, never a streak. */}
          Kept {adherence.kept} of the last {adherence.of} — {Math.round(adherence.rate * 100)}%
        </p>
      </header>

      {!snapshot.notesShared ? (
        <p className="border-edge text-text/50 rounded border px-md py-sm text-xs">
          Free-text notes are private. Structured reasons are shown below; the primary can share
          notes from their settings.
        </p>
      ) : null}

      <Section title={`Reckonings · ${snapshot.reckonings.length}`}>
        {snapshot.reckonings.length === 0 ? (
          <Empty>No misses have been reckoned with yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-sm">
            {snapshot.reckonings.map((item, index) => (
              <li key={`${item.commitmentId}-${index}`} className="border-edge rounded border p-sm">
                <p className="text-sm break-words">{item.commitmentTitle}</p>
                <p className="text-text/60 mt-2xs text-xs">
                  {item.reasonLabel ?? 'Completed late'}
                  {item.recoveryAction ? ` · ${item.recoveryAction}` : ''}
                  {' · '}
                  {item.at.slice(0, 10)}
                </p>
                {item.note ? (
                  <p className="text-text/50 mt-2xs text-xs italic">{item.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Overdue · ${snapshot.recentMisses.length}`}>
        {snapshot.recentMisses.length === 0 ? (
          <Empty>Nothing overdue.</Empty>
        ) : (
          <ul className="flex flex-col gap-2xs">
            {snapshot.recentMisses.map((item) => (
              <li key={item.id} className="text-sm">
                {item.title}
                <span className="text-text/50 text-xs"> · due {item.dueAt.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Recent completions · ${snapshot.recentCompletions.length}`}>
        {snapshot.recentCompletions.length === 0 ? (
          <Empty>Nothing completed yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-2xs">
            {snapshot.recentCompletions.map((item) => (
              <li key={item.id} className="text-sm">
                {item.title}
                {/* Late is stated, never softened. */}
                <span className={item.late ? 'text-signal text-xs' : 'text-text/50 text-xs'}>
                  {item.late ? ' · completed late' : ' · on time'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Why deadlines moved">
        {snapshot.deadlineChanges.length === 0 && snapshot.legacyChanges === 0 ? (
          <Empty>No deadline has moved.</Empty>
        ) : (
          <ul className="flex flex-col gap-2xs">
            {snapshot.deadlineChanges.map((row) => (
              <li key={row.category} className="text-sm">
                {row.label}
                <span className="text-text/50 text-xs"> · {row.count}&times;</span>
              </li>
            ))}
            {snapshot.legacyChanges > 0 ? (
              <li className="text-text/40 text-sm">
                Legacy, before reasons were categorised
                <span className="text-xs"> · {snapshot.legacyChanges}&times;</span>
              </li>
            ) : null}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-text/70 mb-sm text-sm font-medium uppercase tracking-wide">{title}</h2>
      <div className="border-edge bg-surface rounded-md border p-md">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-text/50 text-sm">{children}</p>;
}
