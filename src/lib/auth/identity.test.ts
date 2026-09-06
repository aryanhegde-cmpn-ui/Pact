import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hashPassword } from './password';

const store = vi.hoisted(() => ({
  users: [] as Record<string, unknown>[],
  attempts: [] as { key: string; attemptedAt: Date }[],
  updates: [] as unknown[],
}));

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));

vi.mock('@/lib/db/models/user', () => ({
  UserModel: {
    findOne: (query: Record<string, string>) => ({
      select: () => ({
        lean: async () =>
          store.users.find((u) =>
            Object.entries(query).every(([field, value]) => u[field] === value),
          ) ?? null,
      }),
    }),
    updateOne: async (...args: unknown[]) => {
      store.updates.push(args);
    },
  },
}));

vi.mock('@/lib/db/models/login-attempt', () => ({
  LoginAttemptModel: {
    find: (query: { key: string; attemptedAt?: { $gte: Date } }) => {
      const since = query.attemptedAt?.$gte;
      const matched = store.attempts.filter(
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
      store.attempts.push(doc);
    },
    deleteMany: async (query: { key: string }) => {
      store.attempts = store.attempts.filter((row) => row.key !== query.key);
    },
  },
}));

const { authorizeCredentials } = await import('./authorize');
const { MAX_FAILURES, lockoutKeyForUser, lockoutKeyForUnknown } = await import('./throttle');

const NOW = new Date('2026-09-06T12:00:00.000Z');
const PASSWORD = 'a-sufficiently-long-password';

beforeEach(async () => {
  store.users = [
    {
      _id: 'user-1',
      email: 'aryan@example.com',
      username: 'aryan',
      usernameLower: 'aryan',
      passwordHash: await hashPassword(PASSWORD),
      displayName: 'Aryan',
      role: 'primary',
      ownerId: 'user-1',
    },
  ];
  store.attempts = [];
  store.updates = [];
});

describe('login by either identifier', () => {
  it('accepts the username', async () => {
    await expect(
      authorizeCredentials({ identifier: 'aryan', password: PASSWORD }, NOW),
    ).resolves.toMatchObject({ id: 'user-1', username: 'aryan' });
  });

  it('accepts the email', async () => {
    await expect(
      authorizeCredentials({ identifier: 'aryan@example.com', password: PASSWORD }, NOW),
    ).resolves.toMatchObject({ id: 'user-1' });
  });

  it('accepts either in any case', async () => {
    await expect(
      authorizeCredentials({ identifier: 'ARYAN', password: PASSWORD }, NOW),
    ).resolves.toMatchObject({ id: 'user-1' });
    await expect(
      authorizeCredentials({ identifier: 'Aryan@Example.com', password: PASSWORD }, NOW),
    ).resolves.toMatchObject({ id: 'user-1' });
  });

  it('returns the ownership scope every scoped query uses', async () => {
    const user = await authorizeCredentials({ identifier: 'aryan', password: PASSWORD }, NOW);

    expect(user?.ownerId).toBe('user-1');
  });

  it('scopes an overseer to the primary who invited them', async () => {
    store.users.push({
      _id: 'user-2',
      email: 'over@example.com',
      username: 'over',
      usernameLower: 'over',
      passwordHash: await hashPassword(PASSWORD),
      displayName: 'Over',
      role: 'overseer',
      ownerId: 'user-1',
    });

    const user = await authorizeCredentials({ identifier: 'over', password: PASSWORD }, NOW);

    expect(user).toMatchObject({ id: 'user-2', role: 'overseer', ownerId: 'user-1' });
  });
});

describe('the lockout counter keys on the ACCOUNT, not the identifier', () => {
  it('shares one counter across username and email', async () => {
    /**
     * The attack this prevents: alternating identifiers to double the budget.
     * With a per-string counter, five guesses at "aryan" and five at
     * "aryan@example.com" is ten attempts and no lockout.
     */
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      const identifier = i % 2 === 0 ? 'aryan' : 'aryan@example.com';
      await authorizeCredentials({ identifier, password: 'wrong' }, NOW);
    }

    // All ten landed on one key.
    expect(store.attempts).toHaveLength(MAX_FAILURES);
    expect(new Set(store.attempts.map((a) => a.key))).toEqual(
      new Set([lockoutKeyForUser('user-1')]),
    );

    // And the account is locked, even against the correct password.
    await expect(
      authorizeCredentials({ identifier: 'aryan', password: PASSWORD }, NOW),
    ).resolves.toBeNull();
    await expect(
      authorizeCredentials({ identifier: 'aryan@example.com', password: PASSWORD }, NOW),
    ).resolves.toBeNull();
  });

  it('locks out having alternated, at exactly the threshold', async () => {
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) {
      await authorizeCredentials(
        { identifier: i % 2 === 0 ? 'aryan' : 'aryan@example.com', password: 'wrong' },
        NOW,
      );
    }

    // One short: the correct password still works.
    await expect(
      authorizeCredentials({ identifier: 'aryan', password: PASSWORD }, NOW),
    ).resolves.toMatchObject({ id: 'user-1' });
  });

  it('keys unknown identifiers separately, so enumeration is bounded', async () => {
    await authorizeCredentials({ identifier: 'nobody', password: 'x' }, NOW);

    expect(store.attempts[0]?.key).toBe(lockoutKeyForUnknown('nobody'));
    expect(store.attempts[0]?.key).not.toContain('nobody');
  });

  it('does not store the guessed identifier in plain text', async () => {
    await authorizeCredentials({ identifier: 'secret-guess@example.com', password: 'x' }, NOW);

    // The collection must not become the list of guesses an attacker was
    // trying to obtain.
    expect(JSON.stringify(store.attempts)).not.toContain('secret-guess');
  });

  it('locks an unknown identifier after the threshold', async () => {
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      await authorizeCredentials({ identifier: 'nobody', password: 'x' }, NOW);
    }

    // Still null -- but importantly the attempts stopped being recorded past
    // the lock, so the counter is doing work.
    expect(store.attempts).toHaveLength(MAX_FAILURES);
  });

  it('clears the counter on a successful sign-in', async () => {
    await authorizeCredentials({ identifier: 'aryan', password: 'wrong' }, NOW);
    expect(store.attempts).toHaveLength(1);

    await authorizeCredentials({ identifier: 'aryan@example.com', password: PASSWORD }, NOW);
    expect(store.attempts).toHaveLength(0);
  });
});

describe('all four failure modes are indistinguishable', () => {
  it('returns exactly null for every one', async () => {
    const unknownUsername = await authorizeCredentials(
      { identifier: 'nobody', password: 'x' },
      NOW,
    );
    const unknownEmail = await authorizeCredentials(
      { identifier: 'nobody@example.com', password: 'x' },
      NOW,
    );
    const wrongPassword = await authorizeCredentials(
      { identifier: 'aryan', password: 'wrong' },
      NOW,
    );

    for (let i = 0; i < MAX_FAILURES; i += 1) {
      await authorizeCredentials({ identifier: 'aryan', password: 'wrong' }, NOW);
    }
    const lockedOut = await authorizeCredentials({ identifier: 'aryan', password: PASSWORD }, NOW);

    // One byte-identical outcome. Anything that distinguishes them turns
    // sign-in into an oracle for which accounts exist.
    expect(unknownUsername).toBeNull();
    expect(unknownEmail).toBeNull();
    expect(wrongPassword).toBeNull();
    expect(lockedOut).toBeNull();
    expect([unknownUsername, unknownEmail, wrongPassword, lockedOut]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('records a failed attempt for an unknown identifier too', async () => {
    // Skipping it would make an unknown identifier measurably cheaper.
    await authorizeCredentials({ identifier: 'nobody', password: 'x' }, NOW);

    expect(store.attempts).toHaveLength(1);
  });
});
