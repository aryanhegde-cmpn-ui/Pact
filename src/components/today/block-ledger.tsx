'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { TodayBlockView } from '@/lib/today/service';

/**
 * The three blocks, as a ledger.
 *
 * Rows separated by hairline rules, not cards. Three identical rounded panels
 * with a soft shadow would be the SaaS default and would also be wrong here:
 * these are three entries in the same account, read down a column, and a rule
 * between them says that better than a border around each.
 *
 * The times are set in the figure face so the left column aligns. That single
 * alignment is most of what makes this read as a ledger rather than a list.
 *
 * No glyphs. The time is the identity marker -- it is unique, meaningful, and
 * already there.
 */

const STATE_LABEL: Record<string, string> = {
  done: 'done',
  'in-progress': 'started',
  blocked: 'blocked',
  abandoned: 'dropped',
  pending: 'open',
  'not-generated': '—',
};

export function BlockLedger({
  blocks,
  interactive = true,
  onOverride,
}: {
  blocks: TodayBlockView[];
  interactive?: boolean;
  onOverride?: (commitmentId: string, stableKey: string | null) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ul className="border-edge border-t">
      {blocks.map((block) => {
        const done = block.state === 'done';
        const closed = done || block.state === 'abandoned';
        const startable = interactive && block.commitment && !closed;

        return (
          <li key={block.blockId} className="border-edge border-b">
            <div className="flex items-baseline gap-md py-md">
              <span className="figures text-text/40 w-14 shrink-0 text-sm">
                {block.startTime ?? '—'}
              </span>

              <div className="min-w-0 flex-1">
                <p className={done ? 'text-text/40 text-base line-through' : 'text-base'}>
                  {block.area}
                </p>
                {block.topicLabel ? (
                  <p className="text-text/60 mt-2xs text-sm break-words">{block.topicLabel}</p>
                ) : null}
                {block.targetLabel ? (
                  <p className="figures text-text/40 mt-2xs text-xs">{block.targetLabel}</p>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2xs">
                <span className="text-text/40 text-sm">
                  {STATE_LABEL[block.state] ?? block.state}
                </span>

                {startable ? (
                  <Link
                    href={`/focus/${block.commitment?.id}`}
                    className="border-edge hover:border-signal min-h-11 rounded border px-sm text-sm leading-[2.5rem] transition-colors"
                  >
                    Start
                  </Link>
                ) : null}
              </div>
            </div>

            {/* The override, one tap away rather than on screen by default.
                A select per block would put three dropdowns above the work. */}
            {interactive && block.commitment && !closed && block.alternatives.length > 1 ? (
              <div className="pb-md">
                {open === block.blockId ? (
                  <select
                    autoFocus
                    defaultValue={block.topicKey ?? ''}
                    onChange={(event) => {
                      onOverride?.(
                        block.commitment?.id ?? '',
                        event.target.value === '' ? null : event.target.value,
                      );
                      setOpen(null);
                    }}
                    className="border-edge bg-ground min-h-11 w-full rounded border px-sm text-sm"
                  >
                    <option value="">Nothing in particular</option>
                    {block.alternatives.map((option) => (
                      <option key={option.stableKey} value={option.stableKey}>
                        {option.label} · {option.priority}
                        {option.status === 'needs-revision' ? ' · needs revision' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOpen(block.blockId)}
                    className="text-text/40 hover:text-text text-xs underline"
                  >
                    Study something else
                  </button>
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
