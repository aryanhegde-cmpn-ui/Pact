import { redirect } from 'next/navigation';

import { currentActor } from '@/lib/api/guard';
import { gateDuringRecovery } from '@/lib/commitments/recovery-gate';
import { buildWeek, type WeekDay } from '@/lib/today/week';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'This week' };

/**
 * Seven days, one row each -- from 640px up. Below that a row becomes a small
 * stack, because a gutter that costs a fifth of the width is a worse calendar
 * than no gutter.
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
      {/*
        A PHONE IS NOT A NARROW DESKTOP.
        -------------------------------------------------------------------
        The three-column row -- date gutter, content, marks -- reads well from
        640 up. At 390 the 5rem gutter took a fifth of the width and pushed
        every topic line into a second line, so a seven-day view ran to two
        and a half screens of wrapped text.

        Below 640 the same three parts regroup instead of shrinking: the date
        and its marks take a line of their own, and the content gets the full
        width. Explicit placement rather than `order`, because the reading
        order and the visual order agree at both sizes.
      */}
      <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-md gap-y-2xs sm:grid-cols-[5rem_1fr_auto]">
        <span className="figures text-text/40 shrink-0 text-sm">
          {day.label} {day.date.slice(8)}
        </span>

        <div className="sm:col-start-3 sm:row-start-1">
          <Marks day={day} />
        </div>

        <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
          <p className="text-base">{day.output}</p>
          <p className="text-text/50 mt-2xs text-sm">{day.slants.join(' \u00b7 ')}</p>
        </div>
      </div>

      {/* Topics, when the day has generated. Small, because on a week view they
          are context rather than the thing being read. The indent only exists
          where there is a gutter to line up with. */}
      {day.blocks.some((block) => block.topicLabel) ? (
        <ul className="text-text/40 mt-xs flex flex-col gap-2xs text-xs sm:pl-[calc(5rem+var(--spacing-md))]">
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
        <p className="text-text/40 mt-xs text-xs sm:pl-[calc(5rem+var(--spacing-md))]">
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
