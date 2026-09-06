'use client';

import { useCallback, useEffect, useState } from 'react';

import { unsubscribeHere } from '@/components/pwa/push-subscription';

interface Settings {
  quietHoursStart: string;
  quietHoursEnd: string;
  dailyReviewAt: string;
  defaultLeadMinutes: number;
  disabledTypes: string[];
}

interface Device {
  id: string;
  endpointTail: string;
  userAgent: string;
  createdAt: string;
  lastSuccessAt: string | null;
  failureCount: number;
}

const TYPES = [
  [
    'DEADLINE_APPROACHING',
    'Before a deadline',
    'Names the commitment, the estimate and time left.',
  ],
  ['DEADLINE_NOW', 'At the deadline', 'When the moment arrives.'],
  [
    'ACCOUNTABILITY_CHECK',
    'After a missed deadline',
    'Asks whether you did it. Both answers offered.',
  ],
  ['DAILY_REVIEW', 'Daily review', 'One per day at the time below.'],
] as const;

export function NotificationSettings({ initial }: { initial: Settings }): React.JSX.Element {
  const [settings, setSettings] = useState(initial);
  const [devices, setDevices] = useState<Device[]>([]);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const loadDevices = useCallback(async () => {
    try {
      const response = await fetch('/api/push/subscribe', { cache: 'no-store' });
      if (response.ok)
        setDevices(((await response.json()) as { subscriptions: Device[] }).subscriptions);
    } catch {
      // Offline. The list is informational; an empty one is not a claim.
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void loadDevices(), 0);
    return () => clearTimeout(timer);
  }, [loadDevices]);

  async function save(patch: Partial<Settings>): Promise<void> {
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } finally {
      setSaving(false);
    }
  }

  function toggleType(type: string): void {
    const disabled = settings.disabledTypes.includes(type)
      ? settings.disabledTypes.filter((t) => t !== type)
      : [...settings.disabledTypes, type];
    void save({ disabledTypes: disabled });
  }

  return (
    <div className="flex flex-col gap-xl">
      <Section title="Notification types">
        <ul className="flex flex-col gap-sm">
          {TYPES.map(([type, label, hint]) => {
            const enabled = !settings.disabledTypes.includes(type);
            return (
              <li key={type} className="flex items-start justify-between gap-md">
                <div className="min-w-0">
                  <p className="text-sm">{label}</p>
                  <p className="text-text/50 mt-2xs text-xs">{hint}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={label}
                  onClick={() => toggleType(type)}
                  className={[
                    'border-edge min-h-11 shrink-0 rounded border px-md text-sm transition-colors',
                    enabled ? 'border-signal text-text' : 'text-text/50',
                  ].join(' ')}
                >
                  {enabled ? 'On' : 'Off'}
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Timing">
        <div className="grid gap-md sm:grid-cols-2">
          <Field label="Lead time before a deadline" hint="Minutes. Applies to new commitments.">
            <input
              type="number"
              min={0}
              max={1440}
              inputMode="numeric"
              value={settings.defaultLeadMinutes}
              onChange={(e) => void save({ defaultLeadMinutes: Number(e.target.value) })}
              className={INPUT}
            />
          </Field>

          <Field label="Daily review at">
            <input
              type="time"
              value={settings.dailyReviewAt}
              onChange={(e) => void save({ dailyReviewAt: e.target.value })}
              className={INPUT}
            />
          </Field>

          <Field label="Quiet hours start" hint="Notifications defer to the end, never drop.">
            <input
              type="time"
              value={settings.quietHoursStart}
              onChange={(e) => void save({ quietHoursStart: e.target.value })}
              className={INPUT}
            />
          </Field>

          <Field label="Quiet hours end">
            <input
              type="time"
              value={settings.quietHoursEnd}
              onChange={(e) => void save({ quietHoursEnd: e.target.value })}
              className={INPUT}
            />
          </Field>
        </div>
        {saving ? <p className="text-text/40 mt-sm text-xs">Saving…</p> : null}
      </Section>

      <Section title="Devices">
        {devices.length === 0 ? (
          <p className="text-text/50 text-sm">
            No devices registered. Enable notifications on the dashboard — on iOS that only works
            from the installed app.
          </p>
        ) : (
          <ul className="flex flex-col gap-sm">
            {devices.map((device) => (
              <li
                key={device.id}
                className="border-edge flex items-start justify-between gap-md rounded border p-sm"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{describeAgent(device.userAgent)}</p>
                  <p className="text-text/50 mt-2xs text-xs">
                    …{device.endpointTail}
                    {device.lastSuccessAt
                      ? ` · last delivered ${new Date(device.lastSuccessAt).toLocaleString()}`
                      : ' · never delivered'}
                    {device.failureCount > 0 ? ` · ${device.failureCount} recent failures` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void fetch('/api/push/subscribe', {
                      method: 'DELETE',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ id: device.id }),
                    }).then(loadDevices);
                  }}
                  className="border-edge text-text/60 hover:text-text min-h-11 shrink-0 rounded border px-sm text-xs"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          disabled={testing}
          onClick={() => {
            setTesting(true);
            setTestResult(null);
            void fetch('/api/push/test', { method: 'POST' })
              .then((r) => r.json())
              .then(
                (body: { ok: boolean; message?: string; sent?: number; attempted?: number }) => {
                  setTestResult(
                    body.ok
                      ? `Sent to ${body.sent} of ${body.attempted} device(s). If nothing arrived, the device blocked it at the OS level.`
                      : (body.message ?? 'Nothing was sent.'),
                  );
                },
              )
              .catch(() => setTestResult('Could not reach the server.'))
              .finally(() => setTesting(false));
          }}
          className="border-edge mt-md min-h-11 w-full rounded border px-md text-sm transition-colors hover:border-signal disabled:opacity-50 sm:w-auto"
        >
          {testing ? 'Sending…' : 'Send test notification'}
        </button>

        {testResult ? (
          <p role="status" className="text-text/70 mt-sm text-xs">
            {testResult}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void unsubscribeHere().then(loadDevices)}
          className="text-text/50 hover:text-text mt-md block text-xs underline"
        >
          Turn off notifications on this device
        </button>
      </Section>
    </div>
  );
}

const INPUT =
  'border-edge bg-base text-text min-h-11 w-full rounded border px-sm py-xs outline-none focus:border-signal';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-text/70 mb-md text-sm font-medium uppercase tracking-wide">{title}</h2>
      <div className="border-edge bg-surface rounded-md border p-md">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2xs">
      <span className="text-text/70 text-sm">{label}</span>
      {hint ? <span className="text-text/40 text-xs">{hint}</span> : null}
      {children}
    </label>
  );
}

/** A recognisable name from a user-agent string. Best effort; it is only a label. */
function describeAgent(userAgent: string): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Firefox\/|FxiOS/.test(userAgent)
    ? 'Firefox'
    : /Edg\//.test(userAgent)
      ? 'Edge'
      : /Chrome\/|CriOS/.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser';
  const platform = /iPhone|iPad|iPod/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Macintosh/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : '';

  return platform ? `${browser} on ${platform}` : browser;
}
