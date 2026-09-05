'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { formatWallClock } from '@/lib/time';

/**
 * Creating a commitment.
 *
 * Every field is required and there is no quick-add. That friction is
 * deliberate: a commitment you could not be bothered to give an outcome or an
 * estimate is a to-do item, and it becomes junk history the moment it is
 * saved. See the schema for the same rule on the server.
 */
export function CreateCommitmentForm({
  timeZone,
  onCreated,
}: {
  timeZone: string;
  onCreated: () => void;
}): React.JSX.Element {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /**
   * The default deadline, computed when the form is opened rather than during
   * render. Reading the clock while rendering is impure -- the value would
   * change on any incidental re-render, and React flags it.
   */
  const [defaultLocal, setDefaultLocal] = useState<string | null>(null);
  const open = defaultLocal !== null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const localDueAt = String(form.get('dueAt') ?? '');

    const problems: Record<string, string> = {};
    if (!String(form.get('title') ?? '').trim()) problems.title = 'Give it a title.';
    if (!String(form.get('outcome') ?? '').trim()) {
      problems.outcome = 'What is true when this is done?';
    }
    if (!localDueAt) problems.dueAt = 'When is it due?';
    if (!Number(form.get('estimateMinutes'))) problems.estimateMinutes = 'How long will it take?';

    if (Object.keys(problems).length > 0) {
      setFieldErrors(problems);
      return;
    }

    setSubmitting(true);
    try {
      // The input is a wall clock in APP_TIMEZONE. Converting here rather than
      // sending a naive string keeps the server's contract "instants only".
      const dueAt = localToInstant(localDueAt, timeZone);

      const response = await fetch('/api/commitments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: String(form.get('title')).trim(),
          outcome: String(form.get('outcome')).trim(),
          dueAt: dueAt.toISOString(),
          estimateMinutes: Number(form.get('estimateMinutes')),
          priority: String(form.get('priority')),
          notes: String(form.get('notes') ?? ''),
        }),
      });

      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string };
        setError(detail.error ?? 'That did not work.');
        return;
      }

      event.currentTarget.reset();
      setDefaultLocal(null);
      onCreated();
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() =>
          // Three hours out, in the operator's zone rather than the browser's.
          setDefaultLocal(
            formatWallClock(new Date(Date.now() + 3 * 60 * 60 * 1000), timeZone).slice(0, 16),
          )
        }
        className="bg-signal text-[color:var(--pact-base)] min-h-11 w-full rounded px-md font-medium transition-opacity hover:opacity-90"
      >
        Make a commitment
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="border-edge bg-surface flex flex-col gap-md rounded-md border p-md"
    >
      <Field label="Title" error={fieldErrors.title}>
        <input name="title" maxLength={200} className={INPUT} autoFocus />
      </Field>

      <Field label="Outcome" hint="What is true when this is done?" error={fieldErrors.outcome}>
        <textarea name="outcome" rows={2} maxLength={500} className={INPUT} />
      </Field>

      <div className="grid gap-md sm:grid-cols-2">
        <Field label="Due" error={fieldErrors.dueAt}>
          <input type="datetime-local" name="dueAt" defaultValue={defaultLocal} className={INPUT} />
        </Field>

        <Field label="Estimate (minutes)" error={fieldErrors.estimateMinutes}>
          <input
            type="number"
            name="estimateMinutes"
            min={1}
            max={1440}
            defaultValue={30}
            inputMode="numeric"
            className={INPUT}
          />
        </Field>
      </div>

      <Field label="Priority">
        <select name="priority" defaultValue="important" className={INPUT}>
          <option value="must-win">Must win</option>
          <option value="important">Important</option>
          <option value="maintenance">Maintenance</option>
        </select>
      </Field>

      {error ? (
        <p
          role="alert"
          className="border-signal/40 bg-signal/10 text-signal rounded border px-md py-sm text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-sm">
        <button
          type="submit"
          disabled={submitting}
          className="bg-signal text-[color:var(--pact-base)] min-h-11 flex-1 rounded px-md font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Commit'}
        </button>
        <button
          type="button"
          onClick={() => setDefaultLocal(null)}
          disabled={submitting}
          className="border-edge text-text/70 min-h-11 rounded border px-md text-sm hover:text-text disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const INPUT =
  'border-edge bg-base text-text min-h-11 w-full rounded border px-sm py-xs outline-none focus:border-signal';

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-2xs">
      <span className="text-text/70 text-sm">{label}</span>
      {hint ? <span className="text-text/40 text-xs">{hint}</span> : null}
      {children}
      {error ? <span className="text-signal text-sm">{error}</span> : null}
    </label>
  );
}

/**
 * Converts a `datetime-local` value, which is a wall clock with no zone, into
 * the UTC instant it names in `timeZone`.
 *
 * The browser's own zone is deliberately not used: the app renders in
 * APP_TIMEZONE, so a commitment created from a laptop in another zone must
 * still mean the time the user saw on screen.
 */
function localToInstant(local: string, timeZone: string): Date {
  const naive = new Date(`${local}:00Z`).getTime();

  // Two passes, because the offset depends on the answer near a DST boundary.
  const first = naive - offsetMinutes(new Date(naive), timeZone) * 60_000;
  const second = naive - offsetMinutes(new Date(first), timeZone) * 60_000;

  return new Date(second);
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(instant);
  const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const offset = name === 'GMT' ? '+00:00' : name.replace('GMT', '');

  const sign = offset.startsWith('-') ? -1 : 1;
  const [hours = '0', minutes = '0'] = offset.slice(1).split(':');

  return sign * (Number(hours) * 60 + Number(minutes));
}
