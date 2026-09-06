import 'server-only';

import { NotificationModel } from '@/lib/db/models/notification';
import { connectToDatabase } from '@/lib/db/mongoose';
import { deliverDue } from '@/lib/notifications/deliver';
import type { NotificationType } from '@/lib/schemas/notification';

/** What the in-app list renders. */
export interface InboxItem {
  id: string;
  type: NotificationType;
  commitmentId: string | null;
  sentAt: string;
  read: boolean;
  title: string;
  body: string;
  /** Actions the notification offers. ACCOUNTABILITY_CHECK offers both answers. */
  actions: { label: string; action: 'complete' | 'abandon' | 'open' }[];
  deferredFromQuietHours: string | null;
}

const MAX_ITEMS = 50;

/**
 * The in-app inbox, delivering anything now due as a side effect of reading.
 *
 * Reading is what drives delivery, so the list a user opens is always current
 * rather than showing whatever the last request happened to flush.
 */
export async function readInbox(now: Date = new Date()): Promise<{
  items: InboxItem[];
  unread: number;
}> {
  await connectToDatabase();
  await deliverDue(now);

  const rows = await NotificationModel.find({ channel: 'in-app', status: 'sent' })
    .sort({ sentAt: -1 })
    .limit(MAX_ITEMS)
    .lean();

  const unread = await NotificationModel.countDocuments({
    channel: 'in-app',
    status: 'sent',
    readAt: null,
  });

  return {
    items: rows.map((row) => toItem(row, now)),
    unread,
  };
}

export async function markRead(ids: string[], now: Date = new Date()): Promise<number> {
  if (ids.length === 0) return 0;
  await connectToDatabase();

  const result = await NotificationModel.updateMany(
    { _id: { $in: ids }, readAt: null },
    { $set: { readAt: now } },
  );

  return result.modifiedCount ?? 0;
}

export async function markAllRead(now: Date = new Date()): Promise<number> {
  await connectToDatabase();

  const result = await NotificationModel.updateMany(
    { channel: 'in-app', status: 'sent', readAt: null },
    { $set: { readAt: now } },
  );

  return result.modifiedCount ?? 0;
}

export async function unreadCount(): Promise<number> {
  await connectToDatabase();

  return NotificationModel.countDocuments({ channel: 'in-app', status: 'sent', readAt: null });
}

function toItem(
  row: {
    _id: unknown;
    type: string;
    commitmentId?: string | null;
    sentAt?: Date | null;
    readAt?: Date | null;
    scheduledFor: Date;
    payload?: unknown;
  },
  now: Date,
): InboxItem {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const type = row.type as NotificationType;
  const { title, body, actions } = render(type, payload, row.scheduledFor, now);

  return {
    id: String(row._id),
    type,
    commitmentId: row.commitmentId ?? null,
    sentAt: (row.sentAt ?? row.scheduledFor).toISOString(),
    read: row.readAt !== null && row.readAt !== undefined,
    title,
    body,
    actions,
    deferredFromQuietHours: (payload.deferredFromQuietHours as string | undefined) ?? null,
  };
}

/**
 * Notification copy.
 *
 * Accountability framing, not generic reminders. "Don't forget!" tells the user
 * nothing they don't know; naming the commitment, what finishing it looks like,
 * and how long they said it would take is information they can act on.
 *
 * No pattern detection here -- "you've missed this three times" arrives with
 * the behaviour engine, which reads the event log. Guessing at it from a single
 * notification payload would be a worse version of that, shipped earlier.
 */
function render(
  type: NotificationType,
  payload: Record<string, unknown>,
  scheduledFor: Date,
  now: Date,
): Pick<InboxItem, 'title' | 'body' | 'actions'> {
  const title = String(payload.title ?? 'A commitment');
  const outcome = String(payload.outcome ?? '');
  const estimate = Number(payload.estimateMinutes ?? 0);
  const dueAt = payload.dueAt ? new Date(String(payload.dueAt)) : null;

  switch (type) {
    case 'DEADLINE_APPROACHING': {
      const remaining = dueAt
        ? Math.max(0, Math.round((dueAt.getTime() - now.getTime()) / 60_000))
        : 0;

      return {
        title,
        // The three facts that make it actionable: what done looks like, how
        // long you said it takes, and whether that still fits.
        body:
          `Due in ${formatMinutes(remaining)}. You estimated ${formatMinutes(estimate)}.` +
          (outcome ? ` Done means: ${outcome}` : '') +
          (estimate > remaining ? ' That no longer fits.' : ''),
        actions: [{ label: 'Open', action: 'open' }],
      };
    }

    case 'DEADLINE_NOW':
      return {
        title,
        body: `Due now.${outcome ? ` Done means: ${outcome}` : ''}`,
        actions: [
          { label: 'Completed', action: 'complete' },
          { label: 'Open', action: 'open' },
        ],
      };

    case 'ACCOUNTABILITY_CHECK':
      return {
        title,
        // A question with both answers attached. Offering only "mark done"
        // makes the honest answer the effortful one, which is how a tool
        // starts collecting flattering data.
        body: `The deadline has passed. Did you do it?${outcome ? ` Done means: ${outcome}` : ''}`,
        actions: [
          { label: 'Yes, done', action: 'complete' },
          { label: 'No — abandon it', action: 'abandon' },
          { label: 'Open', action: 'open' },
        ],
      };

    case 'DAILY_REVIEW':
      return {
        title: 'Daily review',
        body: 'What did you commit to today, and what is still open?',
        actions: [{ label: 'Open', action: 'open' }],
      };

    default:
      return { title, body: '', actions: [] };
  }
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
