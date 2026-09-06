import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  notifications: [] as Record<string, unknown>[],
  commitments: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/db/models/notification', () => ({
  NotificationModel: {
    find: (query: { status: string; scheduledFor: { $lte: Date } }) => ({
      sort: () => ({
        limit: () => ({
          lean: async () =>
            store.notifications
              .filter(
                (row) =>
                  row.status === query.status &&
                  (row.scheduledFor as Date).getTime() <= query.scheduledFor.$lte.getTime(),
              )
              .sort(
                (a, b) => (a.scheduledFor as Date).getTime() - (b.scheduledFor as Date).getTime(),
              ),
        }),
      }),
    }),
    updateMany: async (
      filter: { _id: { $in: unknown[] } },
      update: { $set: Record<string, unknown> },
    ) => {
      let modifiedCount = 0;
      for (const row of store.notifications) {
        if (filter._id.$in.includes(row._id)) {
          Object.assign(row, update.$set);
          modifiedCount += 1;
        }
      }
      return { modifiedCount };
    },
  },
}));

vi.mock('@/lib/db/models/commitment', () => ({
  CommitmentModel: {
    find: (query: { _id: { $in: string[] } }) => ({
      lean: async () => store.commitments.filter((c) => query._id.$in.includes(String(c._id))),
    }),
  },
}));

const { deliverDue } = await import('./deliver');

const NOW = new Date('2026-09-05T12:00:00.000Z');

function queue(overrides: Record<string, unknown>) {
  store.notifications.push({
    _id: `n${store.notifications.length + 1}`,
    commitmentId: 'c1',
    type: 'DEADLINE_APPROACHING',
    channel: 'in-app',
    status: 'pending',
    scheduledFor: NOW,
    // Mirrors the model defaults, so assertions about them mean something.
    sentAt: null,
    readAt: null,
    skipReason: null,
    payload: {},
    ...overrides,
  });
}

beforeEach(() => {
  store.notifications = [];
  store.commitments = [{ _id: 'c1', status: 'pending' }];
});

describe('deliverDue', () => {
  it('sends a notification that is due and fresh', async () => {
    queue({ scheduledFor: new Date(NOW.getTime() - 60_000) });

    const report = await deliverDue(NOW);

    expect(report.sent).toBe(1);
    expect(store.notifications[0]).toMatchObject({ status: 'sent', sentAt: NOW });
  });

  it('leaves a future notification pending', async () => {
    queue({ scheduledFor: new Date(NOW.getTime() + 3_600_000) });

    const report = await deliverDue(NOW);

    expect(report.sent).toBe(0);
    expect(store.notifications[0]?.status).toBe('pending');
  });

  it('SKIPS rather than sends anything past the staleness cap', async () => {
    // Nine hours late. Opening the app after a quiet week must not deliver the
    // whole backlog at once -- that trains you to ignore all of them.
    queue({ scheduledFor: new Date(NOW.getTime() - 9 * 3_600_000) });

    const report = await deliverDue(NOW);

    expect(report.sent).toBe(0);
    expect(report.skippedStale).toBe(1);
    expect(store.notifications[0]).toMatchObject({ status: 'skipped', skipReason: 'stale' });
    // Never marked sent: a skipped notification is not one the user saw.
    expect(store.notifications[0]?.sentAt).toBeNull();
  });

  it('skips a backlog wholesale rather than delivering forty at once', async () => {
    for (let i = 0; i < 40; i += 1) {
      queue({ _id: `n${i}`, scheduledFor: new Date(NOW.getTime() - (5 + i) * 3_600_000) });
    }

    const report = await deliverDue(NOW);

    expect(report.sent).toBe(0);
    expect(report.skippedStale).toBe(40);
  });

  it('skips anything whose commitment is already resolved', async () => {
    store.commitments = [{ _id: 'c1', status: 'done' }];
    queue({ scheduledFor: new Date(NOW.getTime() - 60_000) });

    const report = await deliverDue(NOW);

    expect(report.skippedResolved).toBe(1);
    expect(store.notifications[0]).toMatchObject({ status: 'skipped', skipReason: 'resolved' });
  });

  it('still delivers a stale ACCOUNTABILITY_CHECK while the commitment is open', async () => {
    queue({
      type: 'ACCOUNTABILITY_CHECK',
      scheduledFor: new Date(NOW.getTime() - 7 * 24 * 3_600_000),
    });

    const report = await deliverDue(NOW);

    // "Did you do it?" has not expired. Suppressing it would mean the
    // commitments avoided longest are the ones asked about least.
    expect(report.sent).toBe(1);
  });

  it('treats a vanished commitment as resolved rather than notifying about nothing', async () => {
    store.commitments = [];
    queue({ scheduledFor: new Date(NOW.getTime() - 60_000) });

    const report = await deliverDue(NOW);

    expect(report.skippedResolved).toBe(1);
  });

  it('is a no-op when nothing is due', async () => {
    expect(await deliverDue(NOW)).toEqual({ sent: 0, skippedStale: 0, skippedResolved: 0 });
  });

  it('does not re-send on a second pass', async () => {
    queue({ scheduledFor: new Date(NOW.getTime() - 60_000) });

    await deliverDue(NOW);
    const second = await deliverDue(new Date(NOW.getTime() + 60_000));

    expect(second.sent).toBe(0);
  });
});
