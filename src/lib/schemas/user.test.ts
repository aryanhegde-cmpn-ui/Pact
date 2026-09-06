import { describe, expect, it } from 'vitest';

import {
  normaliseUsername,
  RESERVED_USERNAMES,
  usernameSchema,
  looksLikeEmail,
  credentialsSchema,
} from './user';

describe('usernameSchema', () => {
  it.each(['aryan', 'ary-an', 'ary_an', 'a1b2c3', 'abc', 'a'.repeat(20)])('accepts %s', (name) => {
    expect(usernameSchema.parse(name)).toBe(name);
  });

  it('lowercases, so case cannot create a second account', () => {
    expect(usernameSchema.parse('Aryan')).toBe('aryan');
    expect(usernameSchema.parse('  ARYAN  ')).toBe('aryan');
  });

  it.each([
    ['ab', 'too short'],
    ['a'.repeat(21), 'too long'],
    ['ary an', 'contains a space'],
    ['ary.an', 'contains a dot'],
    ['ary@an', 'contains an at sign'],
    ['-aryan', 'leading separator'],
    ['aryan-', 'trailing separator'],
    ['_aryan', 'leading underscore'],
    ['aryán', 'non-ascii'],
    ['', 'empty'],
  ])('rejects %s (%s)', (name) => {
    expect(usernameSchema.safeParse(name).success).toBe(false);
  });

  it.each(RESERVED_USERNAMES)('rejects the reserved name %s', (name) => {
    expect(usernameSchema.safeParse(name).success).toBe(false);
  });

  it('rejects a reserved name in any case', () => {
    // Lowercasing happens first, so the reservation cannot be dodged.
    expect(usernameSchema.safeParse('ADMIN').success).toBe(false);
    expect(usernameSchema.safeParse('Root').success).toBe(false);
  });
});

describe('normaliseUsername', () => {
  it('produces the value the unique index is built on', () => {
    // Case-insensitive uniqueness is enforced by this field, not a collation:
    // a stored column behaves the same across drivers and survives a restore.
    expect(normaliseUsername('Aryan')).toBe('aryan');
    expect(normaliseUsername('  ARYAN ')).toBe('aryan');
    expect(normaliseUsername('aryan')).toBe('aryan');
  });
});

describe('looksLikeEmail', () => {
  it('routes an identifier to the right lookup', () => {
    expect(looksLikeEmail('me@example.com')).toBe(true);
    expect(looksLikeEmail('aryan')).toBe(false);
  });

  it('only chooses a field; it must never decide the outcome', () => {
    // Both shapes are valid input. Whether they resolve is a separate
    // question, and one that produces the same answer either way.
    expect(credentialsSchema.safeParse({ identifier: 'aryan', password: 'x' }).success).toBe(true);
    expect(
      credentialsSchema.safeParse({ identifier: 'me@example.com', password: 'x' }).success,
    ).toBe(true);
  });
});

describe('credentialsSchema', () => {
  it('accepts an identifier that would fail the username rules', () => {
    // Rejecting malformed input before the lockout counter sees it would be
    // unlimited free guessing for anything that fails a format check.
    expect(credentialsSchema.safeParse({ identifier: 'ab', password: 'x' }).success).toBe(true);
    expect(credentialsSchema.safeParse({ identifier: 'admin', password: 'x' }).success).toBe(true);
  });

  it('still requires both fields', () => {
    expect(credentialsSchema.safeParse({ identifier: '', password: 'x' }).success).toBe(false);
    expect(credentialsSchema.safeParse({ identifier: 'aryan', password: '' }).success).toBe(false);
  });
});
