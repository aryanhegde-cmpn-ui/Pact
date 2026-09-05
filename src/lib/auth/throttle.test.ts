import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-memory stand-in for the login_attempts collection.
 *
 * Mocked at the module boundary so nothing reaches Atlas -- see CLAUDE.md,
 * "No network calls in tests". `vi.hoisted` is required because `vi.mock` is
 * hoisted above the imports that would otherwise define this.
 */
const store = vi.hoisted(() => ({ rows: [] as { email: string; attemptedAt: Date }[] }));

vi.mock('@/lib/db/models/login-attempt', () => ({
  LoginAttemptModel: {
    find: (query: { email: string; attemptedAt?: { $gte: Date } }) => {
      const since = query.attemptedAt?.$gte;
      const matched = store.rows.filter(
        (row) => row.email === query.email && (!since || row.attemptedAt >= since),
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
    create: async (doc: { email: string; attemptedAt: Date }) => {
      store.rows.push(doc);
    },
    deleteMany: async (query: { email: string }) => {
      store.rows = store.rows.filter((row) => row.email !== query.email);
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
const EMAIL = 'user@example.com';

/** Records n failures, each one second apart, ending at `endingAt`. */
async function fail(n: number, endingAt: Date, email = EMAIL): Promise<void> {
  for (let i = n - 1; i >= 0; i -= 1) {
    await recordFailedAttempt(email, new Date(endingAt.getTime() - i * 1_000));
  }
}

beforeEach(() => {
  store.rows = [];
});

describe('login throttling', () => {
  it('does not lock below the threshold', async () => {
    await fail(MAX_FAILURES - 1, T0);

    const state = await getLockoutState(EMAIL, T0);

    expect(state.locked).toBe(false);
    expect(state.failures).toBe(MAX_FAILURES - 1);
  });

  it('locks once the threshold is reached', async () => {
    await fail(MAX_FAILURES, T0);

    const state = await getLockoutState(EMAIL, T0);

    expect(state.locked).toBe(true);
    expect(state.lockedUntil).toEqual(new Date(T0.getTime() + LOCKOUT_MS));
  });

  it('stays locked for the whole lockout window', async () => {
    await fail(MAX_FAILURES, T0);

    const justBefore = new Date(T0.getTime() + LOCKOUT_MS - 1_000);

    await expect(getLockoutState(EMAIL, justBefore)).resolves.toMatchObject({ locked: true });
  });

  it('expires once the lockout window passes', async () => {
    await fail(MAX_FAILURES, T0);

    const afterwards = new Date(T0.getTime() + LOCKOUT_MS + 1_000);

    await expect(getLockoutState(EMAIL, afterwards)).resolves.toMatchObject({ locked: false });
  });

  it('only counts failures inside the rolling window', async () => {
    // Old enough to have aged out entirely.
    await fail(MAX_FAILURES, new Date(T0.getTime() - FAILURE_WINDOW_MS - 60_000));

    const state = await getLockoutState(EMAIL, T0);

    expect(state.locked).toBe(false);
    expect(state.failures).toBe(0);
  });

  it('locks per email, not globally', async () => {
    await fail(MAX_FAILURES, T0, 'victim@example.com');

    // One account being locked must not lock everyone else out.
    await expect(getLockoutState('someone-else@example.com', T0)).resolves.toMatchObject({
      locked: false,
    });
  });

  it('is case-insensitive, so capitalisation cannot dodge the lockout', async () => {
    await fail(MAX_FAILURES, T0, 'User@Example.com');

    await expect(getLockoutState('user@example.com', T0)).resolves.toMatchObject({ locked: true });
  });

  it('clears history on a successful sign-in', async () => {
    await fail(MAX_FAILURES - 1, T0);
    await clearFailedAttempts(EMAIL);

    await expect(getLockoutState(EMAIL, T0)).resolves.toMatchObject({ locked: false, failures: 0 });
  });
});
