import { describe, expect, it } from 'vitest';

import { isProtectedPath, resolveAccess, SESSION_MAX_AGE_SECONDS } from './config';

describe('isProtectedPath', () => {
  it.each(['/dashboard', '/dashboard/', '/dashboard/today', '/study', '/study/plan/1'])(
    'protects %s',
    (path) => {
      expect(isProtectedPath(path)).toBe(true);
    },
  );

  it.each(['/', '/api/health', '/api/auth/signin'])('leaves %s public', (path) => {
    expect(isProtectedPath(path)).toBe(false);
  });

  it('does not protect a path that merely starts with the same characters', () => {
    // `/dashboards-public` must not be caught by a naive startsWith.
    expect(isProtectedPath('/dashboardsomething')).toBe(false);
    expect(isProtectedPath('/studying')).toBe(false);
  });

  it('no longer protects the deferred mirror route, because it no longer exists', () => {
    expect(isProtectedPath('/mirror')).toBe(false);
  });
});

describe('resolveAccess', () => {
  it('allows a signed-out visitor to see the landing page', () => {
    expect(resolveAccess('/', '', false)).toEqual({ allow: true });
  });

  it('redirects a signed-out visitor away from a protected route', () => {
    const decision = resolveAccess('/dashboard', '', false);

    expect(decision).toEqual({ allow: false, redirectTo: '/?returnTo=%2Fdashboard' });
  });

  it('preserves the query string in returnTo', () => {
    const decision = resolveAccess('/study', '?view=week', false);

    expect(decision.allow).toBe(false);
    const returnTo = new URL(
      (decision as { redirectTo: string }).redirectTo,
      'http://x',
    ).searchParams.get('returnTo');
    expect(returnTo).toBe('/study?view=week');
  });

  it('encodes returnTo so it cannot break out of the query string', () => {
    const decision = resolveAccess('/dashboard', '?a=1&b=2', false);

    // The whole destination must survive as ONE parameter, not split into two.
    const params = new URL((decision as { redirectTo: string }).redirectTo, 'http://x')
      .searchParams;
    expect(params.get('returnTo')).toBe('/dashboard?a=1&b=2');
    expect(params.get('b')).toBeNull();
  });

  it('lets a signed-in user through', () => {
    expect(resolveAccess('/dashboard', '', true)).toEqual({ allow: true });
  });
});

describe('session lifetime', () => {
  it('is 90 days, so an installed PWA does not log out weekly', () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(90 * 24 * 60 * 60);
  });
});
