import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hashPassword } from './password';

/**
 * In-memory stand-ins for the users and login_attempts collections. Mocked at
 * the module boundary; nothing here touches Atlas.
 */
const store = vi.hoisted(() => ({
  users: [] as {
    _id: string;
    email: string;
    passwordHash: string;
    displayName: string;
    role: string;
  }[],
  attempts: [] as { email: string; attemptedAt: Date }[],
  updates: [] as unknown[],
}));

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));

vi.mock('@/lib/db/models/user', () => ({
  UserModel: {
    findOne: (query: { email: string }) => ({
      select: () => ({
        lean: async () => store.users.find((u) => u.email === query.email) ?? null,
      }),
    }),
    updateOne: async (...args: unknown[]) => {
      store.updates.push(args);
    },
  },
}));

vi.mock('@/lib/db/models/login-attempt', () => ({
  LoginAttemptModel: {
    find: (query: { email: string; attemptedAt?: { $gte: Date } }) => {
      const since = query.attemptedAt?.$gte;
      const matched = store.attempts.filter(
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
      store.attempts.push(doc);
    },
    deleteMany: async (query: { email: string }) => {
      store.attempts = store.attempts.filter((row) => row.email !== query.email);
    },
  },
}));

const { authorizeCredentials } = await import('./authorize');
const { MAX_FAILURES, LOCKOUT_MS } = await import('./throttle');

const NOW = new Date('2026-09-04T10:00:00.000Z');
const EMAIL = 'owner@example.com';
const PASSWORD = 'a-sufficiently-long-password';

beforeEach(async () => {
  store.users = [
    {
      _id: 'user-1',
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD),
      displayName: 'Owner',
      role: 'owner',
    },
  ];
  store.attempts = [];
  store.updates = [];
});

describe('authorizeCredentials', () => {
  it('accepts the correct password', async () => {
    const user = await authorizeCredentials({ email: EMAIL, password: PASSWORD }, NOW);

    expect(user).toMatchObject({ id: 'user-1', email: EMAIL, name: 'Owner', role: 'owner' });
  });

  it('never returns the password hash', async () => {
    const user = await authorizeCredentials({ email: EMAIL, password: PASSWORD }, NOW);

    expect(JSON.stringify(user)).not.toContain('argon2');
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('rejects the wrong password', async () => {
    const user = await authorizeCredentials({ email: EMAIL, password: 'wrong-password' }, NOW);

    expect(user).toBeNull();
  });

  it('returns the identical result for an unknown email', async () => {
    const wrongPassword = await authorizeCredentials({ email: EMAIL, password: 'nope' }, NOW);
    const unknownEmail = await authorizeCredentials(
      { email: 'nobody@example.com', password: 'nope' },
      NOW,
    );

    // Indistinguishable on purpose: the endpoint must not reveal which
    // addresses have accounts.
    expect(unknownEmail).toBeNull();
    expect(unknownEmail).toEqual(wrongPassword);
  });

  it('records a failed attempt for an unknown email too', async () => {
    // Skipping these would make an unknown email cheaper than a wrong password,
    // which is itself a signal an attacker can measure.
    await authorizeCredentials({ email: 'nobody@example.com', password: 'nope' }, NOW);

    expect(store.attempts).toHaveLength(1);
    expect(store.attempts[0]?.email).toBe('nobody@example.com');
  });

  it('signs in case-insensitively', async () => {
    const user = await authorizeCredentials(
      { email: 'Owner@Example.COM', password: PASSWORD },
      NOW,
    );

    expect(user).toMatchObject({ id: 'user-1' });
  });

  it('rejects malformed input without touching the database', async () => {
    await expect(
      authorizeCredentials({ email: 'not-an-email', password: 'x' }, NOW),
    ).resolves.toBeNull();
    await expect(authorizeCredentials({ email: EMAIL, password: '' }, NOW)).resolves.toBeNull();
    await expect(authorizeCredentials(null, NOW)).resolves.toBeNull();
    await expect(authorizeCredentials({}, NOW)).resolves.toBeNull();
  });

  it('records the failure and clears it on success', async () => {
    await authorizeCredentials({ email: EMAIL, password: 'wrong' }, NOW);
    expect(store.attempts).toHaveLength(1);

    await authorizeCredentials({ email: EMAIL, password: PASSWORD }, NOW);
    expect(store.attempts).toHaveLength(0);
  });

  it('stamps lastLoginAt on success', async () => {
    await authorizeCredentials({ email: EMAIL, password: PASSWORD }, NOW);

    expect(store.updates).toHaveLength(1);
    expect(JSON.stringify(store.updates)).toContain('lastLoginAt');
  });

  it('refuses the CORRECT password once locked out', async () => {
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      await authorizeCredentials({ email: EMAIL, password: 'wrong' }, NOW);
    }

    // The point of the lockout: a correct guess arriving during the window is
    // still refused, and refused identically.
    await expect(
      authorizeCredentials({ email: EMAIL, password: PASSWORD }, NOW),
    ).resolves.toBeNull();
  });

  it('accepts the correct password again once the lockout expires', async () => {
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      await authorizeCredentials({ email: EMAIL, password: 'wrong' }, NOW);
    }

    const afterwards = new Date(NOW.getTime() + LOCKOUT_MS + 1_000);

    await expect(
      authorizeCredentials({ email: EMAIL, password: PASSWORD }, afterwards),
    ).resolves.toMatchObject({ id: 'user-1' });
  });
});
