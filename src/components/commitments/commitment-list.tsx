'use client';

import { useCallback, useState } from 'react';

import type { CommitmentView } from '@/lib/commitments/service';
import { CommitmentRow } from './commitment-row';
import { CreateCommitmentForm } from './create-form';

/**
 * Today's list.
 *
 * Overdue work sits ABOVE today's, not mixed in and not tucked behind a tab.
 * Something you have already failed to do is more important than something you
 * have not yet failed to do, and burying it is how it stays buried.
 */
export function CommitmentList({
  initial,
  timeZone,
  today,
}: {
  initial: { commitments: CommitmentView[]; overdue: CommitmentView[] };
  timeZone: string;
  today: string;
}): React.JSX.Element {
  const [data, setData] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/commitments?from=${today}&to=${today}`, {
        cache: 'no-store',
      });
      if (response.ok) {
        const body = (await response.json()) as {
          commitments: CommitmentView[];
          overdue: CommitmentView[];
        };
        setData({ commitments: body.commitments, overdue: body.overdue });
      }
    } finally {
      setRefreshing(false);
    }
  }, [today]);

  const open = data.commitments.filter((c) => c.status === 'pending' || c.status === 'in-progress');
  const closed = data.commitments.filter((c) => c.status === 'done' || c.status === 'abandoned');

  return (
    <div className="flex flex-col gap-xl">
      <CreateCommitmentForm timeZone={timeZone} onCreated={() => void reload()} />

      {data.overdue.length > 0 ? (
        <section aria-labelledby="overdue-heading">
          <h2
            id="overdue-heading"
            className="text-signal mb-sm text-sm font-medium uppercase tracking-wide"
          >
            Overdue · {data.overdue.length}
          </h2>
          <ul className="flex flex-col gap-sm">
            {data.overdue.map((commitment) => (
              <CommitmentRow
                key={commitment.id}
                commitment={commitment}
                timeZone={timeZone}
                onChanged={() => void reload()}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="today-heading">
        <h2
          id="today-heading"
          className="text-text/70 mb-sm text-sm font-medium uppercase tracking-wide"
        >
          Today{refreshing ? ' · updating' : ''}
        </h2>

        {open.length === 0 ? (
          <p className="text-text/50 text-sm">
            {data.overdue.length > 0
              ? 'Nothing else due today.'
              : 'Nothing due today. Make a commitment when you have one.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-sm">
            {open.map((commitment) => (
              <CommitmentRow
                key={commitment.id}
                commitment={commitment}
                timeZone={timeZone}
                onChanged={() => void reload()}
              />
            ))}
          </ul>
        )}
      </section>

      {closed.length > 0 ? (
        <section aria-labelledby="closed-heading">
          <h2
            id="closed-heading"
            className="text-text/50 mb-sm text-sm font-medium uppercase tracking-wide"
          >
            Closed today
          </h2>
          <ul className="flex flex-col gap-sm">
            {closed.map((commitment) => (
              <CommitmentRow
                key={commitment.id}
                commitment={commitment}
                timeZone={timeZone}
                onChanged={() => void reload()}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
