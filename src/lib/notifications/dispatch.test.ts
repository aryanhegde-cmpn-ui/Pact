import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-memory notifications, commitments and settings. The claim mechanism is
 * the thing under test, so `updateOne` honours the conditional filter exactly
 * as Mongo would -- a mock that ignored it would prove nothing.
 */
const store = vi.hoisted(() => ({
  notifications: [] as Record<string, unknown>[],
  commitments: [] as Record<string, unknown>[],
  settings: {} as Record<string, unknown>,
  sends: [] as { userId: string; payload: Record<string, unknown> }[],
}));

vi.mock('@/lib/db/models/notification', () => ({
  NotificationModel: {
    find: (query: { channel: string; status: string; scheduledFor: { $lte: Date } }) => ({
      sort: () => ({
        limit: (n: number) => ({
          lean: async () =>
            store.notifications
              .filter(
                (row) =>
                  row.channel === query.channel &&
                  row.status === query.status &&
                  (row.scheduledFor as Date).getTime() <= query.scheduledFor.$lte.getTime(),
              )
              .sort(
                (a, b) => (a.scheduledFor as Date).getTime() - (b.scheduledFor as Date).getTime(),
              )
              .slice(0, n),
        }),
      }),
    }),
    updateOne: async (
      filter: { _id: unknown; status?: string },
      update: { $set: Record<string, unknown> },
    ) => {
      const row = store.notifications.find(
        (r) => r._id === filter._id && (filter.status === undefined || r.status === filter.status),
      );
      if (!row) return { modifiedCount: 0 };
      Object.assign(row, update.$set);
      return { modifiedCount: 1 };
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

vi.mock('@/lib/db/models/settings', () => ({
  SettingsModel: {
    updateOne: async (_f: unknown, update: { $set: Record<string, unknown> }) => {
      Object.assign(store.settings, update.$set);
      return { modifiedCount: 1 };
    },
  },
}));

vi.mock('@/lib/notifications/push', () => ({
  sendToUser: async (userId: string, payload: Record<string, unknown>) => {
    store.sends.push({ userId, payload });
    return { attempted: 1, sent: 1, deleted: 0, failed: 0, outcomes: [] };
  },
  isPushConfigured: () => true,
}));

const { bearerToken, dispatchDue, secretMatches } = await import('./dispatch');

const NOW = new Date('2026-09-06T12:00:00.000Z');
const USER = 'user-1';

function queue(overrides: Record<string, unknown> = {}) {
  const row = {
    _id: `n${store.notifications.length + 1}`,
    commitmentId: 'c1',
    type: 'DEADLINE_APPROACHING',
    channel: 'web-push',
    status: 'pending',
    scheduledFor: new Date(NOW.getTime() - 60_000),
    sentAt: null,
    skipReason: null,
    payload: { title: 'Ship it', outcome: 'It is sent', estimateMinutes: 30 },
    ...overrides,
  };
  store.notifications.push(row);
  return row;
}

beforeEach(() => {
  store.notifications = [];
  store.commitments = [{ _id: 'c1', status: 'pending', title: 'Ship it' }];
  store.settings = {};
  store.sends = [];
});

describe('secretMatches', () => {
  it('accepts the correct secret', () => {
    expect(secretMatches('correct-horse-battery', 'correct-horse-battery')).toBe(true);
  });

  it('REJECTS a wrong token', () => {
    expect(secretMatches('wrong-horse-battery!', 'correct-horse-battery')).toBe(false);
  });

  it('rejects a token that is merely a prefix', () => {
    // The failure mode a naive comparison invites: matching only what was sent.
    expect(secretMatches('correct', 'correct-horse-battery')).toBe(false);
  });

  it('rejects an absent token', () => {
    expect(secretMatches(null, 'correct-horse-battery')).toBe(false);
    expect(secretMatches('', 'correct-horse-battery')).toBe(false);
  });

  it('does not throw on differing lengths', () => {
    // timingSafeEqual throws unless the buffers match in length, so length is
    // compared separately. Length is not the secret.
    expect(() => secretMatches('short', 'a-much-longer-secret')).not.toThrow();
  });
});

describe('bearerToken', () => {
  it.each([
    ['Bearer abc123', 'abc123'],
    ['bearer abc123', 'abc123'],
    ['  Bearer   abc123  ', 'abc123'],
  ])('extracts from %s', (header, expected) => {
    expect(bearerToken(header)).toBe(expected);
  });

  it.each([null, '', 'abc123', 'Basic abc123'])('returns null for %s', (header) => {
    expect(bearerToken(header)).toBeNull();
  });
});

describe('dispatchDue', () => {
  it('sends a due notification and marks it sent', async () => {
    queue();

    const report = await dispatchDue(USER, NOW);

    expect(report.sent).toBe(1);
    expect(store.notifications[0]).toMatchObject({ status: 'sent', sentAt: NOW });
    expect(store.sends).toHaveLength(1);
  });

  it('leaves a future notification pending', async () => {
    queue({ scheduledFor: new Date(NOW.getTime() + 3_600_000) });

    const report = await dispatchDue(USER, NOW);

    expect(report.scanned).toBe(0);
    expect(store.sends).toHaveLength(0);
  });

  it('ignores in-app rows, which a different path delivers', async () => {
    queue({ channel: 'in-app' });

    const report = await dispatchDue(USER, NOW);

    expect(report.scanned).toBe(0);
    expect(store.notifications[0]?.status).toBe('pending');
  });

  it('SKIPS rather than sends a stale notification', async () => {
    queue({ scheduledFor: new Date(NOW.getTime() - 9 * 3_600_000) });

    const report = await dispatchDue(USER, NOW);

    expect(report.sent).toBe(0);
    expect(report.skippedStale).toBe(1);
    expect(store.notifications[0]).toMatchObject({ status: 'skipped', skipReason: 'stale' });
    expect(store.sends).toHaveLength(0);
  });

  it('skips a notification whose commitment is resolved', async () => {
    store.commitments = [{ _id: 'c1', status: 'done' }];
    queue();

    const report = await dispatchDue(USER, NOW);

    expect(report.skippedResolved).toBe(1);
    expect(store.sends).toHaveLength(0);
  });

  it('still sends a stale ACCOUNTABILITY_CHECK while the commitment is open', async () => {
    queue({
      type: 'ACCOUNTABILITY_CHECK',
      scheduledFor: new Date(NOW.getTime() - 7 * 24 * 3_600_000),
    });

    const report = await dispatchDue(USER, NOW);

    expect(report.sent).toBe(1);
  });

  it('CLAIMS before sending, so overlapping invocations cannot double-send', async () => {
    queue();

    // Two ticks overlapping, which is what happens when one runs slow.
    const [first, second] = await Promise.all([dispatchDue(USER, NOW), dispatchDue(USER, NOW)]);

    // Exactly one send, total. A duplicated reminder is noise, and noise is
    // what teaches someone to ignore the app.
    expect(store.sends).toHaveLength(1);
    expect(first.sent + second.sent).toBe(1);
    expect(first.raced + second.raced).toBe(1);
  });

  it('stays at one send across five concurrent invocations', async () => {
    queue();

    const reports = await Promise.all(Array.from({ length: 5 }, () => dispatchDue(USER, NOW)));

    expect(store.sends).toHaveLength(1);
    expect(reports.reduce((sum, r) => sum + r.sent, 0)).toBe(1);
    expect(reports.reduce((sum, r) => sum + r.raced, 0)).toBe(4);
  });

  it('is idempotent: a second pass sends nothing more', async () => {
    queue();

    await dispatchDue(USER, NOW);
    const second = await dispatchDue(USER, new Date(NOW.getTime() + 60_000));

    expect(second.sent).toBe(0);
    expect(store.sends).toHaveLength(1);
  });

  it('self-heals after a missed tick, because it scans rather than fires', async () => {
    // Three notifications came due while nothing was running.
    queue({ _id: 'a', scheduledFor: new Date(NOW.getTime() - 30 * 60_000) });
    queue({ _id: 'b', scheduledFor: new Date(NOW.getTime() - 20 * 60_000) });
    queue({ _id: 'c', scheduledFor: new Date(NOW.getTime() - 10 * 60_000) });

    const report = await dispatchDue(USER, NOW);

    expect(report.sent).toBe(3);
  });

  it('records the dispatch timestamp even when nothing was due', async () => {
    // Otherwise a quiet period is indistinguishable from a stopped scheduler.
    await dispatchDue(USER, NOW);

    expect(store.settings.lastDispatchAt).toEqual(NOW);
  });

  it('tags the payload per commitment and type, so a re-send replaces', async () => {
    queue({ type: 'ACCOUNTABILITY_CHECK' });

    await dispatchDue(USER, NOW);

    expect(store.sends[0]?.payload.tag).toBe('c1:ACCOUNTABILITY_CHECK');
  });

  it('sends a small payload, not a commitment document', async () => {
    queue();

    await dispatchDue(USER, NOW);

    // Push services cap payloads near 4KB and encryption eats into that.
    const size = JSON.stringify(store.sends[0]?.payload).length;
    expect(size).toBeLessThan(1_000);
  });

  it('prefers the live commitment title over the queued copy', async () => {
    store.commitments = [{ _id: 'c1', status: 'pending', title: 'Renamed since queueing' }];
    queue();

    await dispatchDue(USER, NOW);

    expect(store.sends[0]?.payload.title).toBe('Renamed since queueing');
  });
});
