import Link from 'next/link';
import { redirect } from 'next/navigation';

import { currentActor } from '@/lib/api/guard';
import { gateDuringRecovery } from '@/lib/commitments/recovery-gate';

import { listPostponements, type PostponementRow } from '@/lib/commitments/timeline';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Postponements' };

/**
 * Commitments whose deadline has moved, grouped by how often.
 *
 * One postponement is life. Three is a pattern, and the honest response to a
 * pattern is a conversation rather than a fourth new date.
 */
export default async function PostponementsPage(): Promise<React.JSX.Element> {
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

  const groups = await listPostponements(actor.ownerId);
  const total =
    groups.relapsed.length + groups.once.length + groups.twice.length + groups.chronic.length;

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Postponements</h1>
        <p className="text-text/50 mt-2xs text-sm">
          {total === 0
            ? 'No deadline has moved yet.'
            : `${total} commitment${total === 1 ? '' : 's'} with a moved deadline, most drifted first.`}
        </p>
      </header>

      {/*
        First, and separately, because it is a different fact from the groups
        below. Those count how often a deadline moved; this one says the moving
        did not work -- answered for, given a new date, and missed again.
      */}
      <Group
        title={`Answered, moved, missed again · ${groups.relapsed.length}`}
        rows={groups.relapsed}
        emphasis
        note="A reckoning was submitted, a new date was chosen deliberately, and that one passed too. The answer did not hold."
      />

      <Group
        title={`Moved three or more times · ${groups.chronic.length}`}
        rows={groups.chronic}
        emphasis
        note="Worth a conversation rather than another new date."
      />
      <Group title={`Moved twice · ${groups.twice.length}`} rows={groups.twice} />
      <Group title={`Moved once · ${groups.once.length}`} rows={groups.once} />
    </div>
  );
}

function Group({
  title,
  rows,
  emphasis,
  note,
}: {
  title: string;
  rows: PostponementRow[];
  emphasis?: boolean;
  note?: string;
}): React.JSX.Element | null {
  if (rows.length === 0) return null;

  return (
    <section>
      <h2
        className={[
          'mb-sm text-sm font-medium uppercase tracking-wide',
          emphasis ? 'text-signal' : 'text-text/70',
        ].join(' ')}
      >
        {title}
      </h2>
      {note ? <p className="text-text/50 mb-sm text-xs">{note}</p> : null}

      <ul className="flex flex-col gap-sm">
        {rows.map((row) => (
          <li
            key={row.id}
            className={[
              'bg-surface rounded-md border p-md',
              row.interventionCandidate ? 'border-signal/50' : 'border-edge',
            ].join(' ')}
          >
            <div className="flex flex-wrap items-start justify-between gap-sm">
              <p className="min-w-0 flex-1 font-medium break-words">{row.title}</p>
              <span className="text-text/50 shrink-0 text-xs">{row.status}</span>
            </div>

            <p className="text-text/60 mt-2xs text-xs">
              {row.changes}× moved · {row.totalDaysPostponed}d total drift
              {row.mostCommonCategoryLabel ? ` · usually "${row.mostCommonCategoryLabel}"` : ''}
            </p>

            {/* Spelled out where it applies. "2× moved" does not say that two
                separate deadlines were missed, and that is the harder fact. */}
            {row.deadlinesMissed > 1 ? (
              <p className="text-text/60 mt-2xs text-xs">
                {row.deadlinesMissed} deadlines missed · {row.deadlinesReckoned} answered
              </p>
            ) : null}

            <Link
              href={`/dashboard?timeline=${row.id}`}
              className="text-text/50 hover:text-text mt-sm inline-flex min-h-11 items-center text-xs underline"
            >
              See the history
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
