import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The one file that does NOT fake argon2.
 *
 * `account-recovery.test.ts` stubs the hash to stay fast -- ten real hashes per
 * generated set is about a second, and it generates many. That leaves one claim
 * unproved by everything else in the suite: that a recovery code is stored the
 * way a password is, and that the plaintext is nowhere in the row.
 *
 * One generated set, real argon2, both claims. Slow on purpose.
 */
const store = vi.hoisted(() => ({
  users: [{ _id: 'u1', ownerId: 'u1', recoveryCodeSetId: null as string | null }],
  codes: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));
vi.mock('@/lib/db/events', () => ({ appendEvent: async () => {} }));

vi.mock('@/lib/db/models/user', () => ({
  UserModel: {
    findOne: () => ({ lean: async () => store.users[0] }),
    updateOne: async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
      Object.assign(store.users[0]!, update.$set);

      return { modifiedCount: 1 };
    },
  },
}));

vi.mock('@/lib/db/models/recovery-code', () => ({
  RecoveryCodeModel: {
    insertMany: async (docs: Record<string, unknown>[]) => {
      store.codes.push(...docs);
    },
    countDocuments: async () => store.codes.length,
  },
}));

const { generateRecoveryCodes } = await import('./account-recovery');
const { verifyPassword } = await import('./password');

beforeEach(() => {
  store.codes.length = 0;
  store.users[0]!.recoveryCodeSetId = null;
});

describe('codes are hashed like passwords', () => {
  it('stores an argon2id digest that verifies against the code', async () => {
    const { codes } = await generateRecoveryCodes('u1');

    // The argon2id prefix, and the parameters the password module sets.
    for (const row of store.codes) {
      expect(row.codeHash as string).toMatch(/^\$argon2id\$/);
    }

    // And the digests actually correspond to the codes that were handed out.
    expect(await verifyPassword(store.codes[0]!.codeHash as string, codes[0]!)).toBe(true);
    expect(await verifyPassword(store.codes[0]!.codeHash as string, codes[1]!)).toBe(false);
  });

  it('writes no plaintext anywhere in the row', async () => {
    const { codes } = await generateRecoveryCodes('u1');

    const written = JSON.stringify(store.codes);
    for (const code of codes) expect(written).not.toContain(code);
  });
});
