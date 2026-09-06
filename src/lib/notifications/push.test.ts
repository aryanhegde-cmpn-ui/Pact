import { beforeEach, describe, expect, it, vi } from 'vitest';

/** In-memory subscriptions plus a fake push service that never touches the network. */
const store = vi.hoisted(() => ({
  subscriptions: [] as Record<string, unknown>[],
  sent: [] as { endpoint: string; body: string }[],
  /** Queued failures, keyed by endpoint. */
  failWith: new Map<string, { statusCode?: number; message?: string }>(),
}));

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: () => undefined,
    generateVAPIDKeys: () => ({ publicKey: 'pub', privateKey: 'priv' }),
    sendNotification: async (subscription: { endpoint: string }, body: string) => {
      const failure = store.failWith.get(subscription.endpoint);
      if (failure) {
        const error = new Error(failure.message ?? 'push failed') as Error & {
          statusCode?: number;
        };
        error.statusCode = failure.statusCode;
        throw error;
      }
      store.sent.push({ endpoint: subscription.endpoint, body });
      return { statusCode: 201 };
    },
  },
}));

vi.mock('@/lib/env', () => ({
  getEnv: () => ({
    VAPID_PRIVATE_KEY: 'priv',
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'pub',
    VAPID_SUBJECT: 'mailto:test@example.com',
  }),
  EnvironmentError: class extends Error {},
}));

vi.mock('@/lib/db/models/push-subscription', () => ({
  PushSubscriptionModel: {
    find: (query: { userId: string }) => ({
      lean: async () => store.subscriptions.filter((s) => s.userId === query.userId),
    }),
    updateOne: async (filter: { endpoint: string }, update: { $set: Record<string, unknown> }) => {
      const row = store.subscriptions.find((s) => s.endpoint === filter.endpoint);
      if (row) Object.assign(row, update.$set);
      return { modifiedCount: row ? 1 : 0 };
    },
    findOneAndUpdate: (
      filter: { endpoint: string },
      update: { $inc?: Record<string, number>; $set?: Record<string, unknown> },
    ) => ({
      lean: async () => {
        const row = store.subscriptions.find((s) => s.endpoint === filter.endpoint);
        if (!row) return null;
        for (const [key, by] of Object.entries(update.$inc ?? {})) {
          row[key] = ((row[key] as number) ?? 0) + by;
        }
        Object.assign(row, update.$set ?? {});
        return row;
      },
    }),
    deleteOne: async (filter: { endpoint: string }) => {
      const before = store.subscriptions.length;
      store.subscriptions = store.subscriptions.filter((s) => s.endpoint !== filter.endpoint);
      return { deletedCount: before - store.subscriptions.length };
    },
  },
}));

const { sendToUser, __resetPushConfigForTests } = await import('./push');
const { MAX_CONSECUTIVE_FAILURES } = await import('@/lib/schemas/push');

const NOW = new Date('2026-09-06T12:00:00.000Z');
const PAYLOAD = {
  notificationId: 'n1',
  commitmentId: 'c1',
  type: 'DEADLINE_APPROACHING',
  title: 'Ship it',
  body: 'Due soon.',
  tag: 'c1:DEADLINE_APPROACHING',
  url: '/dashboard',
};

function subscribe(endpoint: string, overrides: Record<string, unknown> = {}) {
  store.subscriptions.push({
    userId: 'user-1',
    endpoint,
    keys: { p256dh: 'p', auth: 'a' },
    failureCount: 0,
    lastSuccessAt: null,
    ...overrides,
  });
}

beforeEach(() => {
  store.subscriptions = [];
  store.sent = [];
  store.failWith = new Map();
  __resetPushConfigForTests();
});

describe('sendToUser', () => {
  it('sends to every subscription the user holds', async () => {
    subscribe('https://push.example/a');
    subscribe('https://push.example/b');

    const report = await sendToUser('user-1', PAYLOAD, NOW);

    // One person, several devices. Guessing which one they are at means the
    // notification does not arrive.
    expect(report.sent).toBe(2);
    expect(store.sent.map((s) => s.endpoint).sort()).toEqual([
      'https://push.example/a',
      'https://push.example/b',
    ]);
  });

  it('records success and clears any failure history', async () => {
    subscribe('https://push.example/a', { failureCount: 3 });

    await sendToUser('user-1', PAYLOAD, NOW);

    const row = store.subscriptions[0];
    expect(row?.lastSuccessAt).toEqual(NOW);
    // A device offline for a day then back must not inherit old failures.
    expect(row?.failureCount).toBe(0);
  });

  it.each([404, 410])('DELETES the subscription immediately on %i', async (statusCode) => {
    subscribe('https://push.example/gone');
    store.failWith.set('https://push.example/gone', { statusCode });

    const report = await sendToUser('user-1', PAYLOAD, NOW);

    // Definitive: the endpoint will never exist again. Retrying is guaranteed
    // to fail, and the row would generate an error on every tick forever.
    expect(store.subscriptions).toHaveLength(0);
    expect(report.deleted).toBe(1);
    expect(report.outcomes[0]).toMatchObject({ result: 'deleted', reason: 'gone' });
  });

  it('does NOT delete on an ambiguous error, it counts it', async () => {
    subscribe('https://push.example/flaky');
    store.failWith.set('https://push.example/flaky', { statusCode: 500 });

    const report = await sendToUser('user-1', PAYLOAD, NOW);

    // One timeout or 500 proves nothing.
    expect(store.subscriptions).toHaveLength(1);
    expect(store.subscriptions[0]?.failureCount).toBe(1);
    expect(report.failed).toBe(1);
  });

  it(`deletes after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`, async () => {
    subscribe('https://push.example/dead');
    store.failWith.set('https://push.example/dead', { statusCode: 500 });

    for (let attempt = 1; attempt < MAX_CONSECUTIVE_FAILURES; attempt += 1) {
      await sendToUser('user-1', PAYLOAD, NOW);
      expect(store.subscriptions).toHaveLength(1);
    }

    const final = await sendToUser('user-1', PAYLOAD, NOW);

    expect(store.subscriptions).toHaveLength(0);
    expect(final.outcomes[0]).toMatchObject({ result: 'deleted', reason: 'too-many-failures' });
  });

  it('resets the count on an intervening success, so flakiness is not fatal', async () => {
    subscribe('https://push.example/flaky');
    store.failWith.set('https://push.example/flaky', { statusCode: 500 });
    await sendToUser('user-1', PAYLOAD, NOW);
    await sendToUser('user-1', PAYLOAD, NOW);
    expect(store.subscriptions[0]?.failureCount).toBe(2);

    store.failWith.clear();
    await sendToUser('user-1', PAYLOAD, NOW);

    // "Consecutive" has to mean consecutive, or a device that fails now and
    // then is eventually deleted for no good reason.
    expect(store.subscriptions[0]?.failureCount).toBe(0);
  });

  it('one dead subscription does not stop the others receiving', async () => {
    subscribe('https://push.example/good');
    subscribe('https://push.example/gone');
    store.failWith.set('https://push.example/gone', { statusCode: 410 });

    const report = await sendToUser('user-1', PAYLOAD, NOW);

    expect(report.sent).toBe(1);
    expect(report.deleted).toBe(1);
    expect(store.sent.map((s) => s.endpoint)).toEqual(['https://push.example/good']);
  });

  it('drops a row with no encryption keys rather than sending garbage', async () => {
    subscribe('https://push.example/broken', { keys: undefined });

    const report = await sendToUser('user-1', PAYLOAD, NOW);

    expect(report.deleted).toBe(1);
    expect(store.subscriptions).toHaveLength(0);
  });

  it('sends nothing for a user with no subscriptions', async () => {
    const report = await sendToUser('user-1', PAYLOAD, NOW);

    expect(report).toMatchObject({ attempted: 0, sent: 0 });
  });

  it('does not send to another user subscriptions', async () => {
    subscribe('https://push.example/mine');
    store.subscriptions.push({
      userId: 'someone-else',
      endpoint: 'https://push.example/theirs',
      keys: { p256dh: 'p', auth: 'a' },
      failureCount: 0,
    });

    await sendToUser('user-1', PAYLOAD, NOW);

    expect(store.sent.map((s) => s.endpoint)).toEqual(['https://push.example/mine']);
  });
});
