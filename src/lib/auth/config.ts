import type { NextAuthConfig } from 'next-auth';

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
 * The origin the client actually used.
 *
 * `request.nextUrl.origin` cannot be trusted for this: Auth.js derives it from
 * AUTH_URL, so on a Vercel preview deployment it names the production domain
 * and every redirect leaves the deployment being tested. Vercel sets the
 * forwarded headers itself, so they describe the real request.
 */
export function requestOrigin(headers: Headers, fallback: string): string {
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!host) return fallback;

  const proto =
    headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');

  return `${proto}://${host}`;
}

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
  // A path with its query only -- never an absolute URL, which would turn
  // returnTo into an open redirect.
  const params = new URLSearchParams({ returnTo: `${pathname}${search}` });

  return { allow: false, redirectTo: `/?${params.toString()}` };
}

export const authConfig = {
  /**
   * Let Auth.js resolve its own callback URLs from the incoming request rather
   * than assuming AUTH_URL, which is what makes preview deployments work. It
   * auto-detects this on Vercel; setting it explicitly keeps behaviour the same
   * anywhere else.
   *
   * Note this does NOT affect `request.nextUrl.origin` inside the proxy, which
   * still reflects AUTH_URL -- see the redirect comment in src/proxy.ts.
   *
   * Safe because the app runs behind Vercel, which sets the Host header itself.
   * On infrastructure that forwards a client-supplied Host, trusting it is
   * header injection.
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
