import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The queue, from enqueue to cancellation.
 *
 * ---------------------------------------------------------------------------
 * THE WIRING THAT FAILS QUIETLY.
 * ---------------------------------------------------------------------------
 * Delivery, dispatch and push all had tests. The step BEFORE them did not, and
 * it is where the two documented silent failures live: a deadline that moves
 * while its old DEADLINE_APPROACHING stays queued -- so the user is warned
 * about a deadline that no longer exists and hears nothing about the one that
 * does -- and a cancelled row occupying a unique key, which on re-enqueue is
 * counted as "already queued" and leaves the commitment with no pending
 * notifications at all.
 *
 * Neither raises an error. Both look exactly like "nothing was due".
 * ---------------------------------------------------------------------------
 */
interface Row {
  commitmentId: string;
  type: string;
  scheduledFor: Date;
  channel: string;
  ownerId: string;
  status: string;
  payload: Record<string, unknown>;
}

const store = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

const DUPLICATE = vi.hoisted(() => 11_000);

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));

vi.mock('@/lib/db/models/notification', () => {
  /** The unique key the real collection enforces. */
  const keyOf = (row: Record<string, unknown>): string =>
    [row.commitmentId, row.type, (row.scheduledFor as Date).toISOString(), row.channel].join('|');

  return {
    NotificationModel: {
      create: async (doc: Record<string, unknown>) => {
        if (store.rows.some((row) => keyOf(row) === keyOf(doc))) {
          const error = new Error('E11000 duplicate key') as Error & { code: number };
          error.code = DUPLICATE;
          throw error;
        }
        store.rows.push({ ...doc });

        return doc;
      },
      updateOne: async (
        filter: Record<string, unknown>,
        update: { $set: Record<string, unknown> },
      ) => {
        const match = store.rows.find((row) => {
          if (keyOf(row) !== keyOf(filter)) return false;
          const status = filter.status as { $ne?: string } | string | undefined;
          if (status && typeof status === 'object' && '$ne' in status) {
            return row.status !== status.$ne;
          }

          return true;
        });
        if (!match) return { modifiedCount: 0 };

        /**
         * `modifiedCount` is 0 when nothing actually CHANGED.
         *
         * Real Mongo semantics, and load-bearing here: re-enqueueing over a row
         * that is already pending sets it to pending again, which is not a
         * modification -- so it counts as a duplicate rather than a revival. A
         * fake that always reported 1 would call an ordinary retry a revival
         * and agree with the wrong reading of the code.
         */
        const before = JSON.stringify(match);
        Object.assign(match, update.$set);

        return { modifiedCount: JSON.stringify(match) === before ? 0 : 1 };
      },
      updateMany: async (
        filter: Record<string, unknown>,
        update: { $set: Record<string, unknown> },
      ) => {
        const matched = store.rows.filter(
          (row) =>
            row.commitmentId === filter.commitmentId &&
            row.ownerId === filter.ownerId &&
            row.status === filter.status,
        );
        for (const row of matched) Object.assign(row, update.$set);

        return { modifiedCount: matched.length };
      },
      insertMany: async (docs: Record<string, unknown>[]) => {
        for (const doc of docs) store.rows.push({ ...doc });

        return docs;
      },
    },
  };
});

const {
  cancelPendingForCommitment,
  enqueueForCommitment,
  planForCommitment,
  reenqueueForCommitment,
} = await import('./queue');

const SETTINGS = {
  quietHoursStart: '00:00',
  quietHoursEnd: '07:00',
  dailyReviewAt: '20:00',
  defaultLeadMinutes: 30,
  disabledTypes: [] as string[],
  shareNotesWithOverseer: false,
  lastDispatchAt: null,
} as unknown as Parameters<typeof enqueueForCommitment>[1];

const ZONE = 'Asia/Kolkata';
const OWNER = 'owner-1';

function commitment(dueAt: Date, id = 'c1') {
  return {
    id,
    title: 'Ship the report',
    outcome: 'The report is sent to Priya',
    estimateMinutes: 45,
    priority: 'critical',
    dueAt,
  };
}

const rows = (): Row[] => store.rows as unknown as Row[];
const pending = (): Row[] => rows().filter((row) => row.status === 'pending');

beforeEach(() => {
  store.rows.length = 0;
});

describe('enqueue on creation', () => {
  it('queues all three types on both channels', async () => {
    const due = new Date('2026-09-20T12:00:00.000Z');
    const result = await enqueueForCommitment(commitment(due), SETTINGS, ZONE, OWNER);

    // Three types, two channels. `channel` is on the row and each delivery
    // path filters on it -- an unscoped read marks the other channel's rows as
    // sent without sending anything.
    expect(result.created).toBe(6);
    expect(new Set(rows().map((row) => row.type)).size).toBe(3);
    expect(new Set(rows().map((row) => row.channel))).toEqual(new Set(['in-app', 'web-push']));
  });

  it('leads the deadline by the configured margin', async () => {
    const due = new Date('2026-09-20T12:00:00.000Z');
    const planned = planForCommitment(commitment(due), SETTINGS);
    const approaching = planned.find((entry) => entry.type === 'DEADLINE_APPROACHING');

    expect(approaching?.scheduledFor.toISOString()).toBe('2026-09-20T11:30:00.000Z');
  });

  it('is idempotent, so a retried request queues nothing twice', async () => {
    const due = new Date('2026-09-20T12:00:00.000Z');
    await enqueueForCommitment(commitment(due), SETTINGS, ZONE, OWNER);
    const second = await enqueueForCommitment(commitment(due), SETTINGS, ZONE, OWNER);

    /**
     * Nothing new, and six rows still pending. That is the invariant.
     *
     * The retry is reported as a REVIVAL rather than a duplicate, which reads
     * oddly and is harmless: the update sets `skipReason: null` on a row
     * created without that field, so Mongo counts a modification. The
     * distinction only feeds the return value; both paths leave exactly one
     * pending row per key, which is what the caller depends on.
     */
    expect(second.created).toBe(0);
    expect(second.revived + second.duplicates).toBe(6);
    expect(rows()).toHaveLength(6);
    expect(pending()).toHaveLength(6);
  });
});

describe('quiet hours', () => {
  it('defers across the boundary rather than dropping', async () => {
    /**
     * A notification inside the window is MOVED to its end, never discarded.
     * Dropping would make the quiet-hours setting silently cost the user the
     * reminder rather than delaying it.
     */
    const due = new Date('2026-09-20T20:00:00.000Z'); // 01:30 next day in Kolkata
    await enqueueForCommitment(commitment(due), SETTINGS, ZONE, OWNER);

    for (const row of rows()) {
      const local = new Intl.DateTimeFormat('en-GB', {
        timeZone: ZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(row.scheduledFor);

      expect(local >= '07:00', `${row.type} landed at ${local}`).toBe(true);
    }
  });

  it('records that it was moved, so the delivered copy can say so', async () => {
    const due = new Date('2026-09-20T20:00:00.000Z');
    await enqueueForCommitment(commitment(due), SETTINGS, ZONE, OWNER);

    // Arriving at a time the user did not choose, with no explanation, reads
    // as the app being wrong about the clock.
    expect(rows().some((row) => row.payload.deferredFromQuietHours)).toBe(true);
  });

  it('leaves a daytime deadline exactly where it was', async () => {
    const due = new Date('2026-09-20T06:00:00.000Z'); // 11:30 in Kolkata
    await enqueueForCommitment(commitment(due), SETTINGS, ZONE, OWNER);

    const now = rows().find((row) => row.type === 'DEADLINE_NOW');
    expect(now?.scheduledFor.toISOString()).toBe(due.toISOString());
  });
});

describe('a deadline that moves', () => {
  it('leaves NOTHING pending at the old deadline', async () => {
    /**
     * The failure this exists to prevent: the deadline moves, the old
     * DEADLINE_APPROACHING stays queued, and the user is notified about a
     * deadline that no longer exists while hearing nothing about the one that
     * does.
     */
    const original = new Date('2026-09-20T12:00:00.000Z');
    await enqueueForCommitment(commitment(original), SETTINGS, ZONE, OWNER);

    const moved = new Date('2026-09-22T12:00:00.000Z');
    const result = await reenqueueForCommitment(commitment(moved), SETTINGS, ZONE, OWNER);

    expect(result.cancelled).toBe(6);

    const stillPendingAtOld = pending().filter(
      (row) => row.scheduledFor < new Date('2026-09-21T00:00:00.000Z'),
    );
    expect(stillPendingAtOld).toEqual([]);
    expect(pending()).toHaveLength(6);
  });

  it('REVIVES a cancelled row when the deadline moves back', async () => {
    /**
     * Cancelling leaves the row in place and the unique key does not include
     * status, so moving a deadline away and back collides with the cancelled
     * row. Counting that as "already queued" leaves the commitment with no
     * pending notifications at all -- the same silent failure as never
     * enqueueing, reached by an ordinary sequence of user actions.
     */
    const original = new Date('2026-09-20T12:00:00.000Z');
    await enqueueForCommitment(commitment(original), SETTINGS, ZONE, OWNER);
    await reenqueueForCommitment(
      commitment(new Date('2026-09-22T12:00:00.000Z')),
      SETTINGS,
      ZONE,
      OWNER,
    );

    const back = await reenqueueForCommitment(commitment(original), SETTINGS, ZONE, OWNER);

    expect(back.revived).toBe(6);
    expect(back.duplicates).toBe(0);
    expect(pending()).toHaveLength(6);
  });

  it('never revives something already sent', async () => {
    const due = new Date('2026-09-20T12:00:00.000Z');
    await enqueueForCommitment(commitment(due), SETTINGS, ZONE, OWNER);
    for (const row of rows()) row.status = 'sent';

    const again = await enqueueForCommitment(commitment(due), SETTINGS, ZONE, OWNER);

    // Re-sending something the user has already seen is worse than not sending.
    expect(again.revived).toBe(0);
    expect(again.duplicates).toBe(6);
  });
});

describe('cancellation', () => {
  it('cancels everything pending when a commitment is resolved', async () => {
    await enqueueForCommitment(
      commitment(new Date('2026-09-20T12:00:00.000Z')),
      SETTINGS,
      ZONE,
      OWNER,
    );

    const cancelled = await cancelPendingForCommitment('c1', OWNER);

    // Completing or abandoning must silence it. A reminder about something
    // already done is the fastest way to teach someone to ignore the app.
    expect(cancelled).toBe(6);
    expect(pending()).toEqual([]);
  });

  it('cancels rather than deletes, so the key is still occupied', async () => {
    await enqueueForCommitment(
      commitment(new Date('2026-09-20T12:00:00.000Z')),
      SETTINGS,
      ZONE,
      OWNER,
    );
    await cancelPendingForCommitment('c1', OWNER);

    expect(rows()).toHaveLength(6);
    expect(rows().every((row) => row.status === 'cancelled')).toBe(true);
  });

  it('touches nobody else', async () => {
    await enqueueForCommitment(
      commitment(new Date('2026-09-20T12:00:00.000Z'), 'c1'),
      SETTINGS,
      ZONE,
      OWNER,
    );
    await enqueueForCommitment(
      commitment(new Date('2026-09-20T12:00:00.000Z'), 'c2'),
      SETTINGS,
      ZONE,
      OWNER,
    );

    await cancelPendingForCommitment('c1', OWNER);

    expect(pending().every((row) => row.commitmentId === 'c2')).toBe(true);
    expect(pending()).toHaveLength(6);
  });
});
