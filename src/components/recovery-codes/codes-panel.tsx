'use client';

import { useState } from 'react';

/**
 * The one time these are ever on screen.
 *
 * ---------------------------------------------------------------------------
 * SHOWN ONCE, AND THE SCREEN HAS TO SAY SO.
 * ---------------------------------------------------------------------------
 * There is no route that reads codes back, by design, so a person who closes
 * this without saving them has nine minutes of confidence and no recovery
 * path. The warning is the feature: it sits above the codes, in the attention
 * colour, before anything else is read.
 *
 * Copyable as a block rather than one at a time. Ten separate copy buttons is
 * ten chances to paste nine, and a password manager takes a block.
 *
 * `onAcknowledged` makes the panel a gate. Where it is passed -- creating an
 * account -- nothing continues until the box is ticked; where it is absent,
 * the panel is informational and the caller decides.
 * ---------------------------------------------------------------------------
 */
export function RecoveryCodesPanel({
  codes,
  onAcknowledged,
  acknowledgeLabel = 'I have saved these codes',
  continueLabel = 'Continue',
}: {
  /** Formatted, `A2B3C-D4E5F`. Never raw. */
  codes: string[];
  onAcknowledged?: () => void;
  acknowledgeLabel?: string;
  continueLabel?: string;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const block = codes.join('\n');

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(block);
      setCopied(true);
    } catch {
      // Clipboard access can be refused outright, and the codes are on screen
      // regardless. Saying so beats a button that silently does nothing.
      setCopied(false);
    }
  }

  return (
    <section aria-labelledby="recovery-codes-heading" className="flex flex-col gap-md">
      <div>
        <h2 id="recovery-codes-heading" className="text-base font-medium">
          Your recovery codes
        </h2>
        {/*
          A left rule in the attention colour -- the same annotation an
          unanswered miss gets, and for the same reason: this needs you now and
          will not be repeated.
        */}
        <p className="border-signal text-signal mt-sm border-l-2 pl-md text-sm">
          This is the only time these are shown. Save them in your password manager now.
        </p>
        <p className="text-text/60 mt-sm text-sm">
          Each one signs you in once if you forget your password. Ten codes, each usable a single
          time.
        </p>
      </div>

      {/*
        `readOnly` rather than `disabled`: a disabled textarea cannot be
        selected, which would defeat the point of showing a block.
      */}
      <textarea
        readOnly
        rows={codes.length}
        value={block}
        aria-label="Recovery codes"
        spellCheck={false}
        className="border-edge bg-surface figures text-text w-full resize-none rounded border p-md text-sm"
      />

      <div className="flex flex-wrap gap-sm">
        <button
          type="button"
          onClick={() => void copy()}
          className="border-edge hover:border-signal inline-flex min-h-11 items-center rounded border px-md text-sm transition-colors"
        >
          {copied ? 'Copied' : 'Copy all'}
        </button>
      </div>

      {onAcknowledged ? (
        <div className="border-edge flex flex-col gap-md border-t pt-md">
          <label className="flex items-start gap-sm text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-2xs size-5 shrink-0"
            />
            <span>{acknowledgeLabel}</span>
          </label>

          <button
            type="button"
            disabled={!acknowledged}
            onClick={onAcknowledged}
            className="bg-signal text-ground min-h-11 rounded px-md font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {continueLabel}
          </button>
        </div>
      ) : null}
    </section>
  );
}
