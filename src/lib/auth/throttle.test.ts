import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-memory stand-in for the login_attempts collection.
 *
 * Mocked at the module boundary so nothing reaches Atlas -- see CLAUDE.md,
 * "No network calls in tests". `vi.hoisted` is required because `vi.mock` is
 * hoisted above the imports that would otherwise define this.
 */
const store = vi.hoisted(() => ({ rows: [] as { key: string; attemptedAt: Date }[] }));

vi.mock('@/lib/db/models/login-attempt', () => ({
  LoginAttemptModel: {
    find: (query: { key: string; attemptedAt?: { $gte: Date } }) => {
      const since = query.attemptedAt?.$gte;
      const matched = store.rows.filter(
        (row) => row.key === query.key && (!since || row.attemptedAt >= since),
      );
      return {
        sort: () => ({
          limit: (n: number) => ({
            lean: async () =>
              [...matched]
                .sort((a, b) => b.attemptedAt.getTime() - a.attemptedAt.getTime())
                .slice(0, n),
          }),
        }),
      };
    },
    create: async (doc: { key: string; attemptedAt: Date }) => {
      store.rows.push(doc);
    },
    deleteMany: async (query: { key: string }) => {
      store.rows = store.rows.filter((row) => row.key !== query.key);
    },
  },
}));

const {
  clearFailedAttempts,
  FAILURE_WINDOW_MS,
  getLockoutState,
  LOCKOUT_MS,
  MAX_FAILURES,
  recordFailedAttempt,
} = await import('./throttle');

const T0 = new Date('2026-09-04T10:00:00.000Z');
// Keys, not identifiers: the counter belongs to the ACCOUNT.
const KEY = 'user:user-1';

/** Records n failures, each one second apart, ending at `endingAt`. */
async function fail(n: number, endingAt: Date, key = KEY): Promise<void> {
  for (let i = n - 1; i >= 0; i -= 1) {
    await recordFailedAttempt(key, new Date(endingAt.getTime() - i * 1_000));
  }
}

beforeEach(() => {
  store.rows = [];
});

describe('login throttling', () => {
  it('does not lock below the threshold', async () => {
    await fail(MAX_FAILURES - 1, T0);

    const state = await getLockoutState(KEY, T0);

    expect(state.locked).toBe(false);
    expect(state.failures).toBe(MAX_FAILURES - 1);
  });

  it('locks once the threshold is reached', async () => {
    await fail(MAX_FAILURES, T0);

    const state = await getLockoutState(KEY, T0);

    expect(state.locked).toBe(true);
    expect(state.lockedUntil).toEqual(new Date(T0.getTime() + LOCKOUT_MS));
  });

  it('stays locked for the whole lockout window', async () => {
    await fail(MAX_FAILURES, T0);

    const justBefore = new Date(T0.getTime() + LOCKOUT_MS - 1_000);

    await expect(getLockoutState(KEY, justBefore)).resolves.toMatchObject({ locked: true });
  });

  it('expires once the lockout window passes', async () => {
    await fail(MAX_FAILURES, T0);

    const afterwards = new Date(T0.getTime() + LOCKOUT_MS + 1_000);

    await expect(getLockoutState(KEY, afterwards)).resolves.toMatchObject({ locked: false });
  });

  it('only counts failures inside the rolling window', async () => {
    // Old enough to have aged out entirely.
    await fail(MAX_FAILURES, new Date(T0.getTime() - FAILURE_WINDOW_MS - 60_000));

    const state = await getLockoutState(KEY, T0);

    expect(state.locked).toBe(false);
    expect(state.failures).toBe(0);
  });

  it('locks per account, not globally', async () => {
    await fail(MAX_FAILURES, T0, 'user:victim');

    // One account being locked must not lock everyone else out.
    await expect(getLockoutState('user:someone-else', T0)).resolves.toMatchObject({
      locked: false,
    });
  });

  it('clears history on a successful sign-in', async () => {
    await fail(MAX_FAILURES - 1, T0);
    await clearFailedAttempts(KEY);

    await expect(getLockoutState(KEY, T0)).resolves.toMatchObject({ locked: false, failures: 0 });
  });
});
