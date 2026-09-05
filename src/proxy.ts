import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';

import { authConfig, resolveAccess } from '@/lib/auth/config';

/**
 * Route protection.
 *
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`. A file named `middleware.ts`
 * is silently ignored, which would leave every protected route open, so do not
 * rename this back.
 *
 * Built from `authConfig` alone -- no providers, no Mongoose. Proxy runs ahead
 * of the route it guards and may be deployed apart from the app, so it verifies
 * the session JWT and nothing more. The rule itself lives in `resolveAccess`;
 * this file is only the plumbing.
 */
const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const { pathname, search } = request.nextUrl;
  const decision = resolveAccess(pathname, search, Boolean(request.auth));

  if (decision.allow) {
    return NextResponse.next();
  }

  // `nextUrl.origin` is the real request origin now that AUTH_URL is unset and
  // Auth.js derives the origin from the forwarded headers -- see authConfig.
  return NextResponse.redirect(new URL(decision.redirectTo, request.nextUrl.origin));
});

export const config = {
  /**
   * Everything except Next's internals and static assets. Without the negative
   * match the auth check would also run against CSS, JS and images.
   * `api/auth` is excluded so sign-in itself can complete.
   */
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
};
