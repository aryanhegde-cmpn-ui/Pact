import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Account recovery, end to end, against in-memory collections.
 *
 * The REAL throttle module runs here -- only the login_attempts collection is
 * faked -- because the shared lockout counter is the property most worth
 * proving, and a mocked throttle would prove nothing about it.
 *
 * Argon2 is faked, deliberately: ten real hashes per generated set is about a
 * second, and this file generates many. `account-recovery-hashing.test.ts`
 * uses the real thing once, so "the codes are argon2" is still asserted.
 */
interface UserRow {
  _id: string;
  email: string;
  username: string;
  usernameLower: string;
  passwordHash: string;
  displayName: string;
  role: string;
  ownerId: string | null;
  recoveryCodeSetId: string | null;
  sessionsValidFrom: Date | null;
  lastLoginAt: Date | null;
}

const store = vi.hoisted(() => ({
  users: [] as Record<string, unknown>[],
  codes: [] as Record<string, unknown>[],
  tokens: [] as Record<string, unknown>[],
  attempts: [] as { key: string; attemptedAt: Date }[],
  events: [] as { type: string; entityId: string; payload: Record<string, unknown> }[],
  nextId: 1,
}));

/** Deep-ish equality for the handful of operators these queries use. */
const matches = vi.hoisted(
  () =>
    (row: Record<string, unknown>, filter: Record<string, unknown>): boolean =>
      Object.entries(filter).every(([field, expected]) => {
        const actual = row[field];
        if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
          const operators = expected as Record<string, unknown>;
          if ('$gt' in operators) return (actual as Date) > (operators.$gt as Date);
          if ('$gte' in operators) return (actual as Date) >= (operators.$gte as Date);
        }
        if (expected instanceof Date) return (actual as Date)?.getTime() === expected.getTime();

        return actual === expected;
      }),
);

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));

vi.mock('@/lib/auth/password', () => ({
  // Deterministic and instant. The real argon2 is exercised in its own file.
  hashPassword: async (value: string) => `hashed:${value}`,
  verifyPassword: async (hash: string, value: string) => hash === `hashed:${value}`,
}));

vi.mock('@/lib/db/events', () => ({
  appendEvent: async (event: { type: string; entityId: string; payload: unknown }) => {
    store.events.push({
      type: event.type,
      entityId: event.entityId,
      payload: (event.payload ?? {}) as Record<string, unknown>,
    });
  },
}));

vi.mock('@/lib/db/models/user', () => ({
  UserModel: {
    findOne: (filter: Record<string, unknown>) => {
      const found = store.users.find((row) => matches(row, filter)) ?? null;
      const result = { lean: async () => found, select: () => ({ lean: async () => found }) };

      return result;
    },
    updateOne: async (
      filter: Record<string, unknown>,
      update: { $set: Record<string, unknown> },
    ) => {
      const row = store.users.find((candidate) => matches(candidate, filter));
      if (!row) return { modifiedCount: 0 };
      Object.assign(row, update.$set);

      return { modifiedCount: 1 };
    },
  },
}));

vi.mock('@/lib/db/models/recovery-code', () => ({
  RecoveryCodeModel: {
    insertMany: async (docs: Record<string, unknown>[]) => {
      for (const doc of docs) store.codes.push({ _id: `c${store.nextId++}`, ...doc });
    },
    /**
     * `codeHash` is `select: false` on the real model, so it is ABSENT unless
     * asked for. Modelling that is not pedantry: the service once passed a
     * projection alongside `.select('+codeHash')`, the projection won, every
     * hash came back undefined, and every correct code was refused with the
     * generic message. A fake that always returned the hash agreed with the
     * broken code.
     */
    find: (filter: Record<string, unknown>) => {
      const rows = () => store.codes.filter((row) => matches(row, filter));
      const withoutHash = () =>
        rows().map(({ codeHash: _hash, ...rest }) => rest as Record<string, unknown>);

      return {
        select: (fields: string) => ({
          lean: async () => (fields.includes('+codeHash') ? rows() : withoutHash()),
        }),
        lean: async () => withoutHash(),
      };
    },
    countDocuments: async (filter: Record<string, unknown>) =>
      store.codes.filter((row) => matches(row, filter)).length,
    updateOne: async (
      filter: Record<string, unknown>,
      update: { $set: Record<string, unknown> },
    ) => {
      const row = store.codes.find((candidate) => matches(candidate, filter));
      if (!row) return { modifiedCount: 0 };
      Object.assign(row, update.$set);

      return { modifiedCount: 1 };
    },
  },
}));

vi.mock('@/lib/db/models/recovery-token', () => ({
  RecoveryTokenModel: {
    create: async (doc: Record<string, unknown>) => {
      store.tokens.push({ _id: `t${store.nextId++}`, ...doc });
    },
    findOneAndUpdate: (
      filter: Record<string, unknown>,
      update: { $set: Record<string, unknown> },
    ) => ({
      lean: async () => {
        const row = store.tokens.find((candidate) => matches(candidate, filter));
        if (!row) return null;
        Object.assign(row, update.$set);

        return row;
      },
    }),
  },
}));

vi.mock('@/lib/db/models/login-attempt', () => ({
  LoginAttemptModel: {
    find: (query: { key: string; attemptedAt?: { $gte: Date } }) => {
      const since = query.attemptedAt?.$gte;
      const rows = store.attempts.filter(
        (row) => row.key === query.key && (!since || row.attemptedAt >= since),
      );

      return {
        sort: () => ({
          limit: (n: number) => ({
            lean: async () =>
              [...rows]
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

const {
  GENERIC_RECOVERY_ERROR,
  RecoveryError,
  generateRecoveryCodes,
  remainingRecoveryCodes,
  resetPasswordWithToken,
  verifyRecoveryCode,
} = await import('./account-recovery');
const { authorizeCredentials } = await import('./authorize');
const { MAX_FAILURES } = await import('./throttle');
const { RECOVERY_CODE_COUNT, normaliseRecoveryCode } =
  await import('@/lib/schemas/account-recovery');

const NOW = new Date('2026-09-12T10:00:00.000Z');

function seedUser(overrides: Partial<UserRow> = {}): UserRow {
  const user: UserRow = {
    _id: 'u1',
    email: 'aryan@example.test',
    username: 'aryanhegde',
    usernameLower: 'aryanhegde',
    passwordHash: 'hashed:CorrectHorse2026',
    displayName: 'Aryan',
    role: 'primary',
    ownerId: 'u1',
    recoveryCodeSetId: null,
    sessionsValidFrom: null,
    lastLoginAt: null,
    ...overrides,
  };
  store.users.push(user as unknown as Record<string, unknown>);

  return user;
}

beforeEach(() => {
  store.users.length = 0;
  store.codes.length = 0;
  store.tokens.length = 0;
  store.attempts.length = 0;
  store.events.length = 0;
  store.nextId = 1;
});

describe('generating a set', () => {
  it('issues ten codes and stores only hashes', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);

    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);

    // Stored under `codeHash` and nowhere else -- no `code` field, no
    // plaintext column that a later query could select by accident. That the
    // hash is really argon2 is asserted in `account-recovery-hashing.test.ts`,
    // where the hash function is not faked.
    for (const row of store.codes) {
      expect(Object.keys(row)).not.toContain('code');
      expect(row.codeHash).toBeTypeOf('string');
    }
  });

  it('uses the unambiguous alphabet', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);

    for (const code of codes) {
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/);
      // The pairs that get transcribed wrongly, gone: 0/O and 1/I/l.
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it('records the generation without recording a code', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);

    const event = store.events.find((row) => row.type === 'RECOVERY_CODES_GENERATED');
    expect(event?.payload.count).toBe(RECOVERY_CODE_COUNT);

    const logged = JSON.stringify(store.events);
    for (const code of codes) expect(logged).not.toContain(code);
  });

  it('counts what is left', async () => {
    seedUser();
    await generateRecoveryCodes('u1', NOW);

    expect(await remainingRecoveryCodes('u1')).toBe(10);
  });
});

describe('regenerating', () => {
  it('invalidates every code in the previous set', async () => {
    seedUser();
    const first = await generateRecoveryCodes('u1', NOW);
    await generateRecoveryCodes('u1', NOW);

    // Every single one, not just the first.
    for (const code of first.codes) {
      await expect(verifyRecoveryCode('aryanhegde', code, NOW)).rejects.toThrow(RecoveryError);
    }
  });

  it('leaves exactly one live set', async () => {
    seedUser();
    await generateRecoveryCodes('u1', NOW);
    const second = await generateRecoveryCodes('u1', NOW);

    expect(await remainingRecoveryCodes('u1')).toBe(10);
    await expect(verifyRecoveryCode('aryanhegde', second.codes[0]!, NOW)).resolves.toBeTruthy();
  });

  it('switches the set in one write, so there is never a gap', async () => {
    /**
     * The pointer IS the invalidation. Codes carry a setId and validity is
     * "matches the user's current one", so no ordering of two writes can leave
     * the account with two live sets or none.
     */
    seedUser();
    await generateRecoveryCodes('u1', NOW);
    const pointerAfterFirst = store.users[0]!.recoveryCodeSetId;
    await generateRecoveryCodes('u1', NOW);

    expect(store.users[0]!.recoveryCodeSetId).not.toBe(pointerAfterFirst);
    // The old rows are still there, for the audit trail.
    expect(store.codes).toHaveLength(20);
  });
});

describe('the flow', () => {
  it('issues a token for a valid pair', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);

    const { token, expiresAt } = await verifyRecoveryCode('aryanhegde', codes[0]!, NOW);

    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(expiresAt.getTime()).toBe(NOW.getTime() + 10 * 60 * 1000);
  });

  it('accepts the formatted code, and any case', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);
    const formatted = `${codes[0]!.slice(0, 5)}-${codes[0]!.slice(5)}`.toLowerCase();

    // Transcribed by hand from a password manager: hyphens and case are noise
    // the display format introduced, not part of the secret.
    await expect(verifyRecoveryCode('aryanhegde', ` ${formatted} `, NOW)).resolves.toBeTruthy();
  });

  it('accepts the email as well as the username', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);

    await expect(verifyRecoveryCode('aryan@example.test', codes[0]!, NOW)).resolves.toBeTruthy();
  });

  it('sets the password, consumes the code, and reports what is left', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);
    const { token } = await verifyRecoveryCode('aryanhegde', codes[0]!, NOW);

    const result = await resetPasswordWithToken(token, 'BrandNewPassword2026', NOW);

    expect(result.username).toBe('aryanhegde');
    expect(result.remaining).toBe(9);
    expect(store.users[0]!.passwordHash).toBe('hashed:BrandNewPassword2026');
  });

  it('records the reset in the event log', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);
    const { token } = await verifyRecoveryCode('aryanhegde', codes[0]!, NOW);
    await resetPasswordWithToken(token, 'BrandNewPassword2026', NOW);

    const types = store.events.map((row) => row.type);
    expect(types).toContain('RECOVERY_CODE_CONSUMED');
    expect(types).toContain('PASSWORD_RESET_VIA_RECOVERY');
  });

  it('rejects a password that fails the ordinary rules', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);
    const { token } = await verifyRecoveryCode('aryanhegde', codes[0]!, NOW);

    await expect(resetPasswordWithToken(token, 'short', NOW)).rejects.toThrow(/12 characters/);

    // And the token survived, so a typo does not cost a code.
    await expect(resetPasswordWithToken(token, 'BrandNewPassword2026', NOW)).resolves.toBeTruthy();
  });
});

describe('single use', () => {
  it('refuses a code that has already been consumed', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);
    const { token } = await verifyRecoveryCode('aryanhegde', codes[0]!, NOW);
    await resetPasswordWithToken(token, 'BrandNewPassword2026', NOW);

    await expect(verifyRecoveryCode('aryanhegde', codes[0]!, NOW)).rejects.toThrow(
      GENERIC_RECOVERY_ERROR,
    );
  });

  it('marks it consumed rather than deleting it', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);
    const { token } = await verifyRecoveryCode('aryanhegde', codes[0]!, NOW);
    await resetPasswordWithToken(token, 'BrandNewPassword2026', NOW);

    // "A code was used to reset this password on the 12th" has to stay
    // answerable from the data.
    expect(store.codes).toHaveLength(10);
    expect(store.codes.filter((row) => row.consumedAt !== null)).toHaveLength(1);
  });

  it('spends one code even if two tokens were minted from it', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);
    const first = await verifyRecoveryCode('aryanhegde', codes[0]!, NOW);
    const second = await verifyRecoveryCode('aryanhegde', codes[0]!, NOW);

    await resetPasswordWithToken(first.token, 'BrandNewPassword2026', NOW);

    // The second token is real and unexpired, and still cannot reset anything:
    // the code behind it is spent.
    await expect(resetPasswordWithToken(second.token, 'AnotherPassword2026', NOW)).rejects.toThrow(
      GENERIC_RECOVERY_ERROR,
    );
    expect(store.users[0]!.passwordHash).toBe('hashed:BrandNewPassword2026');
  });

  it('refuses a token that has already been used', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);
    const { token } = await verifyRecoveryCode('aryanhegde', codes[0]!, NOW);
    await resetPasswordWithToken(token, 'BrandNewPassword2026', NOW);

    await expect(resetPasswordWithToken(token, 'YetAnotherPassword26', NOW)).rejects.toThrow(
      GENERIC_RECOVERY_ERROR,
    );
  });

  it('refuses an expired token', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);
    const { token } = await verifyRecoveryCode('aryanhegde', codes[0]!, NOW);

    const elevenMinutesLater = new Date(NOW.getTime() + 11 * 60 * 1000);
    await expect(
      resetPasswordWithToken(token, 'BrandNewPassword2026', elevenMinutesLater),
    ).rejects.toThrow(GENERIC_RECOVERY_ERROR);
  });

  it('refuses a token whose purpose is anything else', async () => {
    /**
     * The token authorises ONE action. Widening it would take editing the
     * enum, not forgetting a check -- this asserts the check exists.
     */
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);
    const { token } = await verifyRecoveryCode('aryanhegde', codes[0]!, NOW);

    const row = store.tokens[0]!;
    row.purpose = 'read-everything';

    await expect(resetPasswordWithToken(token, 'BrandNewPassword2026', NOW)).rejects.toThrow(
      GENERIC_RECOVERY_ERROR,
    );
  });
});

describe('every session dies on reset', () => {
  it('stamps sessionsValidFrom', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);
    const { token } = await verifyRecoveryCode('aryanhegde', codes[0]!, NOW);

    expect(store.users[0]!.sessionsValidFrom).toBeNull();
    await resetPasswordWithToken(token, 'BrandNewPassword2026', NOW);

    /**
     * An Auth.js session is a ninety-day JWT and nothing can reach out and
     * revoke one. This is the comparison `currentActor()` makes instead -- a
     * reset that left whoever knew the old password signed in on their own
     * device would not have recovered the account from anybody.
     */
    expect((store.users[0]!.sessionsValidFrom as Date).getTime()).toBe(NOW.getTime());
  });
});

describe('one message, every failure', () => {
  /**
   * Five ways to fail, one sentence. Unknown identifier, wrong code, spent
   * code, locked account and expired token are indistinguishable on purpose:
   * a public endpoint that tells them apart is an enumeration oracle, and one
   * that says "your account is locked" confirms the account exists for free.
   */
  it('returns the same error for all five', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);

    const messages: string[] = [];

    const collect = async (run: () => Promise<unknown>): Promise<void> => {
      try {
        await run();
        messages.push('(no error)');
      } catch (error) {
        messages.push(error instanceof Error ? error.message : String(error));
      }
    };

    // 1. unknown identifier
    await collect(() => verifyRecoveryCode('nobody', codes[0]!, NOW));
    // 2. wrong code
    await collect(() => verifyRecoveryCode('aryanhegde', 'ZZZZZ-ZZZZZ', NOW));

    // 3. consumed code
    const used = await verifyRecoveryCode('aryanhegde', codes[0]!, NOW);
    await resetPasswordWithToken(used.token, 'BrandNewPassword2026', NOW);
    await collect(() => verifyRecoveryCode('aryanhegde', codes[0]!, NOW));

    // 4. expired token
    const stale = await verifyRecoveryCode('aryanhegde', codes[1]!, NOW);
    await collect(() =>
      resetPasswordWithToken(stale.token, 'BrandNewPassword2026', new Date(NOW.getTime() + 9e5)),
    );

    // 5. locked account
    for (let attempt = 0; attempt < MAX_FAILURES; attempt += 1) {
      await collect(() => verifyRecoveryCode('aryanhegde', 'ZZZZZ-ZZZZZ', NOW)).catch(() => {});
    }
    messages.splice(4, MAX_FAILURES - 1);
    await collect(() => verifyRecoveryCode('aryanhegde', codes[2]!, NOW));

    expect(new Set(messages)).toEqual(new Set([GENERIC_RECOVERY_ERROR]));
  });

  it('logs a failure against a known account but not an unknown identifier', async () => {
    seedUser();
    await generateRecoveryCodes('u1', NOW);

    await verifyRecoveryCode('aryanhegde', 'ZZZZZ-ZZZZZ', NOW).catch(() => {});
    expect(store.events.filter((row) => row.type === 'RECOVERY_ATTEMPT_FAILED')).toHaveLength(1);

    await verifyRecoveryCode('someone-else', 'ZZZZZ-ZZZZZ', NOW).catch(() => {});
    // An event needs an owner, and an unknown identifier has none. Recording
    // one anyway would make the event log a list of guessed usernames.
    expect(store.events.filter((row) => row.type === 'RECOVERY_ATTEMPT_FAILED')).toHaveLength(1);
  });
});

describe('the lockout counter is shared with sign-in', () => {
  /**
   * ---------------------------------------------------------------------------
   * THE PART MOST LIKELY TO BE GOT WRONG.
   * ---------------------------------------------------------------------------
   * A recovery endpoint with its own counter is a way to keep guessing after
   * the password form has locked -- ten at the password, ten at a code, ten
   * more at the password once the first lock lifts. The lockout would be
   * decorative. Both directions are asserted, because getting one right and
   * the other wrong is the realistic half-fix.
   * ---------------------------------------------------------------------------
   */
  it('counts failed code attempts towards the password lockout', async () => {
    seedUser();
    await generateRecoveryCodes('u1', NOW);

    for (let attempt = 0; attempt < MAX_FAILURES; attempt += 1) {
      await verifyRecoveryCode('aryanhegde', 'ZZZZZ-ZZZZZ', NOW).catch(() => {});
    }

    // The password is correct, and it is refused: the account is locked by
    // attempts made against the OTHER endpoint.
    const result = await authorizeCredentials(
      { identifier: 'aryanhegde', password: 'CorrectHorse2026' },
      NOW,
    );

    expect(result).toBeNull();
  });

  it('counts failed password attempts towards the recovery lockout', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);

    for (let attempt = 0; attempt < MAX_FAILURES; attempt += 1) {
      await authorizeCredentials({ identifier: 'aryanhegde', password: 'wrong' }, NOW);
    }

    // A VALID code, refused, because the password form locked the account.
    await expect(verifyRecoveryCode('aryanhegde', codes[0]!, NOW)).rejects.toThrow(
      GENERIC_RECOVERY_ERROR,
    );
  });

  it('keys on the account, so username and email share one budget', async () => {
    seedUser();
    await generateRecoveryCodes('u1', NOW);

    for (let attempt = 0; attempt < MAX_FAILURES - 1; attempt += 1) {
      await verifyRecoveryCode('aryanhegde', 'ZZZZZ-ZZZZZ', NOW).catch(() => {});
    }
    await verifyRecoveryCode('aryan@example.test', 'ZZZZZ-ZZZZZ', NOW).catch(() => {});

    // Alternating identifiers must not double the budget.
    expect(store.attempts).toHaveLength(MAX_FAILURES);
    expect(new Set(store.attempts.map((row) => row.key)).size).toBe(1);
  });

  it('lifts the lock once a code has actually been proved', async () => {
    seedUser();
    const { codes } = await generateRecoveryCodes('u1', NOW);

    for (let attempt = 0; attempt < MAX_FAILURES - 1; attempt += 1) {
      await verifyRecoveryCode('aryanhegde', 'ZZZZZ-ZZZZZ', NOW).catch(() => {});
    }

    const { token } = await verifyRecoveryCode('aryanhegde', codes[0]!, NOW);
    await resetPasswordWithToken(token, 'BrandNewPassword2026', NOW);

    // Leaving it locked would punish the person who just proved they own it.
    expect(store.attempts).toHaveLength(0);
  });
});

describe('normalisation', () => {
  it('strips the display format and nothing else', () => {
    expect(normaliseRecoveryCode(' a2b3c-d4e5f ')).toBe('A2B3CD4E5F');
    // An excluded character is NOT corrected into something else: a code that
    // silently becomes a different code is worse than one that is rejected.
    expect(normaliseRecoveryCode('A2B3C-D4E5O')).toBe('A2B3CD4E5O');
  });
});
