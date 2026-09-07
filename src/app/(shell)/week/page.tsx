import { redirect } from 'next/navigation';

import { currentActor } from '@/lib/api/guard';
import { gateDuringRecovery } from '@/lib/commitments/recovery-gate';
import { buildWeek, type WeekDay } from '@/lib/today/week';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'This week' };

/**
 * Seven days, one row each.
 *
 * The value is the SHAPE of the week -- which days the rhythm makes heavy,
 * where the blocks landed, where the gaps are. A view you have to expand day by
 * day is a worse calendar, so everything a row needs to say fits on the row.
 *
 * The three marks are the whole state: filled for kept, hollow for not, a rule
 * for a day that has not generated yet. No colour, because nothing here needs
 * you right now -- this is a plan, not a queue.
 */
export default async function WeekPage(): Promise<React.JSX.Element> {
  const actor = await currentActor();
  if (!actor) redirect('/');

  await gateDuringRecovery(actor.ownerId);

  const week = await buildWeek(actor.ownerId);

  return (
    <div className="flex flex-col gap-lg">
      <header className="pt-sm">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight">This week</h1>
        <p className="text-text/40 mt-xs text-sm">
          Seven days from today, with the rhythm each one is set to.
        </p>
      </header>

      <ul className="border-edge border-t">
        {week.map((day) => (
          <Day key={day.date} day={day} />
        ))}
      </ul>
    </div>
  );
}

function Day({ day }: { day: WeekDay }): React.JSX.Element {
  return (
    <li
      className={[
        'border-edge border-b py-md',
        day.isToday ? 'border-l-2 border-l-text pl-md' : '',
      ].join(' ')}
    >
      <div className="flex items-baseline gap-md">
        <span className="figures text-text/40 w-20 shrink-0 text-sm">
          {day.label} {day.date.slice(8)}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-base">{day.output}</p>
          <p className="text-text/50 mt-2xs text-sm">{day.slants.join(' · ')}</p>
        </div>

        <Marks day={day} />
      </div>

      {/* Topics, when the day has generated. Small, because on a week view they
          are context rather than the thing being read. */}
      {day.blocks.some((block) => block.topicLabel) ? (
        <ul className="text-text/40 mt-xs flex flex-col gap-2xs pl-[5rem] text-xs">
          {day.blocks
            .filter((block) => block.topicLabel)
            .map((block) => (
              <li key={block.blockId} className="break-words">
                <span className="figures">{block.startTime}</span> {block.topicLabel}
              </li>
            ))}
        </ul>
      ) : null}

      {day.otherDue > 0 ? (
        <p className="text-text/40 mt-xs pl-[5rem] text-xs">
          <span className="figures">{day.otherDue}</span> other commitment
          {day.otherDue === 1 ? '' : 's'} due
        </p>
      ) : null}
    </li>
  );
}

/** Three marks: kept, not kept, not yet generated. */
function Marks({ day }: { day: WeekDay }): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-2xs" aria-label={`${day.blocksDone} of 3 kept`}>
      {day.blocks.map((block) => (
        <span
          key={block.blockId}
          aria-hidden="true"
          className={[
            'block size-2.5 rounded-full',
            block.state === 'done'
              ? 'bg-text'
              : block.state === 'not-generated'
                ? 'border-edge border'
                : day.isPast
                  ? 'bg-edge'
                  : 'border-text/25 border',
          ].join(' ')}
        />
      ))}
    </div>
  );
}
