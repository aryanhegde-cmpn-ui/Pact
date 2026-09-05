import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('produces an argon2id hash, not a reversible encoding', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('correct horse');
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same-password'),
      hashPassword('same-password'),
    ]);

    expect(a).not.toBe(b);
    // ...and both still verify.
    await expect(verifyPassword(a, 'same-password')).resolves.toBe(true);
    await expect(verifyPassword(b, 'same-password')).resolves.toBe(true);
  });

  it('accepts the correct password', async () => {
    const hash = await hashPassword('the-right-one');

    await expect(verifyPassword(hash, 'the-right-one')).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('the-right-one');

    await expect(verifyPassword(hash, 'the-wrong-one')).resolves.toBe(false);
    await expect(verifyPassword(hash, '')).resolves.toBe(false);
    await expect(verifyPassword(hash, 'the-right-one ')).resolves.toBe(false);
  });

  it('returns false rather than throwing on a corrupt stored hash', async () => {
    // A corrupt row has to read as "wrong password", never as a distinguishable
    // error that would confirm the account exists.
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
    await expect(verifyPassword('', 'anything')).resolves.toBe(false);
  });
});
