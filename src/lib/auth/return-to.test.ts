import { describe, expect, it } from 'vitest';

import { DEFAULT_SIGNED_IN_PATH, safeReturnTo } from './return-to';

describe('safeReturnTo', () => {
  it('accepts a path with a query string', () => {
    expect(safeReturnTo('/study?view=week')).toBe('/study?view=week');
  });

  it.each([
    ['//evil.com', 'protocol-relative'],
    ['https://evil.com', 'absolute URL'],
    ['/\\evil.com', 'backslash protocol-relative'],
    ['\\\\evil.com', 'UNC-style'],
    ['http://evil.com', 'absolute http'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['//evil.com/study', 'protocol-relative with a path'],
    ['/study\\..\\..', 'backslash anywhere'],
    ['study', 'relative, no leading slash'],
    ['', 'empty'],
    ['/study\nLocation: https://evil.com', 'CRLF injection'],
    ['/study\r\nSet-Cookie: a=b', 'CR injection'],
  ])('rejects %s (%s)', (input) => {
    expect(safeReturnTo(input)).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it('rejects non-strings', () => {
    for (const value of [undefined, null, 42, {}, ['/study']]) {
      expect(safeReturnTo(value)).toBe(DEFAULT_SIGNED_IN_PATH);
    }
  });

  it('rejects an absurdly long value', () => {
    expect(safeReturnTo(`/${'a'.repeat(600)}`)).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it('normalises so the redirect target is exactly what was validated', () => {
    // Traversal cannot climb above the origin, and the result is what we checked.
    expect(safeReturnTo('/study/../dashboard')).toBe('/dashboard');
  });

  it('honours an explicit fallback', () => {
    expect(safeReturnTo('//evil.com', '/')).toBe('/');
  });

  it('drops a fragment, which never reaches the server anyway', () => {
    expect(safeReturnTo('/study#section')).toBe('/study');
  });
});
