import type { NextAuthConfig } from 'next-auth';

import { safeReturnTo } from '@/lib/auth/return-to';

/**
 * The half of the Auth.js config that carries no database access.
 *
 * `src/proxy.ts` builds its session check from this. Proxy must not touch
 * Mongoose -- Next runs it ahead of the route it guards and may deploy it apart
 * from the app, so it verifies the session JWT and nothing else.
 */

/** 90 days, sliding. An installed PWA must not log out every week. */
export const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

/** Routes that require a session. Everything else is public. */
export const PROTECTED_PREFIXES = ['/dashboard', '/study'] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export type AccessDecision = { allow: true } | { allow: false; redirectTo: string };

/**
 * The whole route-protection rule, as a pure function.
 *
 * Extracted from the proxy so it can be tested without standing up Next's
 * request pipeline -- the proxy itself is then only the plumbing that feeds it
 * a pathname and a session.
 */
export function resolveAccess(
  pathname: string,
  search: string,
  isAuthenticated: boolean,
): AccessDecision {
  if (!isProtectedPath(pathname) || isAuthenticated) {
    return { allow: true };
  }

  // Carry the original destination so sign-in can return the user to it.
  // Validated on the way out as well as on the way in: what we emit here has
  // to satisfy the same rule the landing page will apply when it reads it.
  const params = new URLSearchParams({ returnTo: safeReturnTo(`${pathname}${search}`) });

  return { allow: false, redirectTo: `/?${params.toString()}` };
}

export const authConfig = {
  /**
   * The single mechanism for working out the app's own origin.
   *
   * Auth.js derives it from the incoming request's forwarded headers. AUTH_URL
   * must stay UNSET, because setting it overrides this and pins every redirect
   * and callback to one host -- which sends preview deployments to production.
   *
   * The alternative (build the origin by hand from x-forwarded-host, checked
   * against an allowlist) was removed rather than kept alongside this: two
   * mechanisms disagreeing about the app's own identity is worse than either
   * one. See docs/decisions.md, 008.
   *
   * Safe because the app runs behind Vercel, which sets the forwarded headers
   * itself and does not pass through a client-supplied Host.
   */
  trustHost: true,

  // The sign-in form lives on the landing page, so failures return there
  // rather than to a generated Auth.js page.
  pages: { signIn: '/', error: '/' },

  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
    // Re-issue at most daily: sliding expiry without rewriting the cookie on
    // every single request.
    updateAge: 24 * 60 * 60,
  },

  callbacks: {
    jwt({ token, user }) {
      // `user` is only present on the sign-in pass; afterwards the token is
      // the only source, so copy what the session needs once.
      if (user) {
        token.userId = user.id ?? token.sub;
        token.displayName = user.name ?? null;
        token.role = (user as { role?: string }).role ?? 'owner';
      }
      return token;
    },

    session({ session, token }) {
      if (session.user) {
        session.user.id = (token.userId as string | undefined) ?? token.sub ?? '';
        session.user.name = (token.displayName as string | null | undefined) ?? null;
        session.user.role = (token.role as string | undefined) ?? 'owner';
      }
      return session;
    },
  },

  // Providers are attached in `src/lib/auth/index.ts`, which is the only place
  // allowed to reach the database.
  providers: [],
} satisfies NextAuthConfig;
