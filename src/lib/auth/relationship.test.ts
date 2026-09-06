import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  relationships: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));

vi.mock('@/lib/db/models/relationship', () => ({
  RelationshipModel: {
    findOne: (query: Record<string, unknown>) => ({
      sort: () => ({ lean: async () => match(query)[0] ?? null }),
      lean: async () => match(query)[0] ?? null,
    }),
    /**
     * The atomic claim. Matches and mutates in ONE step, exactly as Mongo
     * does -- a mock that read then wrote would make the concurrency test pass
     * for the wrong reason.
     */
    findOneAndUpdate: (
      query: Record<string, unknown>,
      update: { $set: Record<string, unknown> },
    ) => ({
      lean: async () => {
        const row = match(query)[0];
        if (!row) return null;
        Object.assign(row, update.$set);
        return { ...row };
      },
    }),
    updateOne: async (
      query: Record<string, unknown>,
      update: Record<string, Record<string, unknown>>,
    ) => {
      const rows = match(query);
      if (rows.length === 0 && update.$setOnInsert) {
        store.relationships.push({ ...update.$setOnInsert, ...update.$set });
        return { modifiedCount: 0, upsertedCount: 1 };
      }
      for (const row of rows) Object.assign(row, update.$set ?? {});
      return { modifiedCount: rows.length };
    },
  },
}));

function match(query: Record<string, unknown>): Record<string, unknown>[] {
  return store.relationships.filter((row) =>
    Object.entries(query).every(([field, value]) => {
      if (field === '_id') return row._id === value;
      if (value && typeof value === 'object' && '$in' in (value as object)) {
        return (value as { $in: unknown[] }).$in.includes(row[field]);
      }
      if (value && typeof value === 'object' && '$gt' in (value as object)) {
        const bound = (value as { $gt: Date }).$gt;
        return row[field] instanceof Date && (row[field] as Date) > bound;
      }
      return row[field] === value;
    }),
  );
}

vi.mock('@/lib/db/models/user', () => ({
  UserModel: {
    create: async (doc: Record<string, unknown>) => {
      const clash = store.users.some((u) => u.usernameLower === doc.usernameLower);
      if (clash) {
        const error = new Error('E11000 duplicate key') as Error & { code: number };
        error.code = 11000;
        throw error;
      }
      const saved = { ...doc, _id: `u${store.users.length + 1}` };
      store.users.push(saved);
      return saved;
    },
    findById: () => ({ lean: async () => store.users[0] ?? null }),
  },
}));

const { createInvite, redeemInvite, revokeRelationship, describeRelationship } =
  await import('./relationship');

const NOW = new Date('2026-09-06T12:00:00.000Z');
const PRIMARY = 'primary-1';

beforeEach(() => {
  store.relationships = [];
  store.users = [];
});

async function invite(): Promise<string> {
  const { token } = await createInvite(PRIMARY, NOW);
  return token;
}

const REDEEM = {
  username: 'overseer-one',
  email: 'over@example.com',
  password: 'a-sufficiently-long-password',
};

describe('createInvite', () => {
  it('returns a token once and stores only its hash', async () => {
    const token = await invite();

    expect(token.length).toBeGreaterThan(20);
    // A dump of the collection must not hand over a working invite.
    expect(JSON.stringify(store.relationships)).not.toContain(token);
  });

  it('expires in seven days', async () => {
    await invite();

    const expires = store.relationships[0]?.inviteExpiresAt as Date;
    expect(Math.round((expires.getTime() - NOW.getTime()) / 86_400_000)).toBe(7);
  });

  it('refuses while an overseer is already active', async () => {
    store.relationships.push({ primaryUserId: PRIMARY, status: 'active' });

    await expect(createInvite(PRIMARY, NOW)).rejects.toThrow(/already active/);
  });
});

describe('redeemInvite', () => {
  it('creates the overseer, scoped to the inviting primary', async () => {
    const token = await invite();

    const result = await redeemInvite({ token, ...REDEEM }, NOW);

    expect(result.primaryUserId).toBe(PRIMARY);
    expect(store.users[0]).toMatchObject({ role: 'overseer', ownerId: PRIMARY });
  });

  it('is SINGLE USE', async () => {
    const token = await invite();
    await redeemInvite({ token, ...REDEEM }, NOW);

    await expect(redeemInvite({ token, ...REDEEM, username: 'someone-else' }, NOW)).rejects.toThrow(
      /not valid/,
    );
  });

  it('is consumed atomically under concurrent redemption', async () => {
    const token = await invite();

    // Two people racing with the same token. The claim is a conditional
    // update, so exactly one matches a still-pending row.
    const results = await Promise.allSettled([
      redeemInvite({ token, ...REDEEM, username: 'over-one' }, NOW),
      redeemInvite({ token, ...REDEEM, username: 'over-two', email: 'two@example.com' }, NOW),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(store.users).toHaveLength(1);
  });

  it('rejects an expired invite', async () => {
    const token = await invite();
    const tooLate = new Date(NOW.getTime() + 8 * 24 * 3_600_000);

    await expect(redeemInvite({ token, ...REDEEM }, tooLate)).rejects.toThrow(/not valid/);
  });

  it('rejects an unknown token', async () => {
    await invite();

    await expect(redeemInvite({ token: 'not-a-real-token', ...REDEEM }, NOW)).rejects.toThrow(
      /not valid/,
    );
  });

  it('gives one message for expired, used and unknown', async () => {
    // An invite token is a secret; distinguishing the failures tells a guesser
    // which guesses are close.
    const messages: string[] = [];
    for (const attempt of ['unknown-token', 'another-unknown']) {
      await redeemInvite({ token: attempt, ...REDEEM }).catch((e: Error) =>
        messages.push(e.message),
      );
    }

    expect(new Set(messages).size).toBe(1);
  });

  it('puts the invite back when the account cannot be created', async () => {
    store.users.push({ _id: 'existing', usernameLower: 'overseer-one' });
    const token = await invite();

    await expect(redeemInvite({ token, ...REDEEM }, NOW)).rejects.toThrow();

    // A typo must not burn a whole invite cycle.
    expect(store.relationships[0]?.status).toBe('pending');
  });
});

describe('revokeRelationship', () => {
  it('marks revoked rather than deleting', async () => {
    const token = await invite();
    await redeemInvite({ token, ...REDEEM }, NOW);

    await revokeRelationship(PRIMARY, NOW);

    // "You had an overseer for six weeks and then removed them" is a fact
    // worth keeping.
    expect(store.relationships).toHaveLength(1);
    expect(store.relationships[0]).toMatchObject({ status: 'revoked', revokedAt: NOW });
  });

  it('also cancels an unredeemed invite', async () => {
    await invite();

    await revokeRelationship(PRIMARY, NOW);

    expect(store.relationships[0]?.status).toBe('revoked');
    expect(store.relationships[0]?.inviteTokenHash).toBeNull();
  });

  it('reports when there was nothing to revoke', async () => {
    await expect(revokeRelationship(PRIMARY, NOW)).resolves.toEqual({ revoked: false });
  });

  it('leaves a revoked invite unredeemable', async () => {
    const token = await invite();
    await revokeRelationship(PRIMARY, NOW);

    await expect(redeemInvite({ token, ...REDEEM }, NOW)).rejects.toThrow(/not valid/);
  });
});

describe('describeRelationship', () => {
  it('reports none when there is no arrangement', async () => {
    await expect(describeRelationship(PRIMARY)).resolves.toMatchObject({ status: 'none' });
  });

  it('reports the current state', async () => {
    const token = await invite();
    await redeemInvite({ token, ...REDEEM }, NOW);

    await expect(describeRelationship(PRIMARY)).resolves.toMatchObject({ status: 'active' });
  });
});
