import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  count: 0,
  updates: [] as { filter: unknown; update: Record<string, Record<string, unknown>> }[],
  upsertedCount: 1,
}));

vi.mock('@/lib/db/models/user', () => ({
  UserModel: {
    countDocuments: async () => store.count,
    updateOne: async (filter: unknown, update: Record<string, Record<string, unknown>>) => {
      store.updates.push({ filter, update });
      return { upsertedCount: store.upsertedCount };
    },
  },
}));

const { seedUser, SEED_REFUSAL } = await import('./seed');

beforeEach(() => {
  store.count = 0;
  store.updates = [];
  store.upsertedCount = 1;
});

describe('seedUser', () => {
  it('creates the first user', async () => {
    const result = await seedUser({ email: 'Owner@Example.com', password: 'a-long-password' });

    expect(result).toMatchObject({ created: true, email: 'owner@example.com' });
    expect(store.updates).toHaveLength(1);
  });

  it('defaults the display name to the local part of the email', async () => {
    const result = await seedUser({ email: 'owner@example.com', password: 'a-long-password' });

    expect(result.displayName).toBe('owner');
  });

  it('stores a hash, never the password', async () => {
    await seedUser({ email: 'owner@example.com', password: 'a-long-password' });

    const set = store.updates[0]?.update.$set as { passwordHash: string };
    expect(set.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(store.updates)).not.toContain('a-long-password');
  });

  it('refuses to overwrite an existing user without --force', async () => {
    store.count = 1;

    await expect(
      seedUser({ email: 'owner@example.com', password: 'a-long-password' }),
    ).rejects.toThrow(SEED_REFUSAL);

    // Nothing written: the refusal must happen before any mutation.
    expect(store.updates).toHaveLength(0);
  });

  it('overwrites when --force is passed', async () => {
    store.count = 1;
    store.upsertedCount = 0;

    const result = await seedUser({
      email: 'owner@example.com',
      password: 'a-different-password',
      force: true,
    });

    expect(result.created).toBe(false);
    expect(store.updates).toHaveLength(1);
  });

  it('refuses even when the existing user has a different email', async () => {
    // On a one-user app, seeding a second address is as much a mistake as
    // overwriting the first.
    store.count = 1;

    await expect(
      seedUser({ email: 'someone-else@example.com', password: 'a-long-password' }),
    ).rejects.toThrow(SEED_REFUSAL);
  });

  it('only sets role and createdAt on insert, so --force cannot demote an owner', async () => {
    store.count = 1;
    await seedUser({ email: 'owner@example.com', password: 'a-long-password', force: true });

    const update = store.updates[0]?.update;
    expect(update?.$setOnInsert).toMatchObject({ role: 'owner' });
    expect(update?.$set).not.toHaveProperty('role');
    expect(update?.$set).not.toHaveProperty('createdAt');
  });
});
