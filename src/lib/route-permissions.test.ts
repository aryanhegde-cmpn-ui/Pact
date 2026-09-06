import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { can, type Capability, type Role } from '@/lib/auth/permissions';

/**
 * Route-level permission coverage.
 *
 * Two claims, checked by reading the routes rather than by calling them:
 *
 *   1. Every route derives its guard from the matrix. A handler that checks
 *      `role === 'overseer'` inline is the fifteenth one that gets it subtly
 *      wrong, and nothing would notice.
 *   2. The matrix denies what it is supposed to deny, in both directions.
 *
 * The scanning half matters because a NEW route is the realistic failure. A
 * behavioural test only covers the handlers someone remembered to call.
 */

const APP = fileURLToPath(new URL('../app', import.meta.url));

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

const ROUTES = routeFiles(APP).map((path) => ({
  rel: relative(APP, path),
  code: readFileSync(path, 'utf8'),
}));

/**
 * Routes that legitimately do not use the matrix, each with its reason.
 *
 * Deliberately short and annotated. A growing list means the rule is wrong or
 * the code is.
 */
const UNGUARDED: Record<string, string> = {
  'api/auth/[...nextauth]/route.ts': 'Auth.js sign-in; there is no session yet.',
  'api/health/route.ts': 'Deliberately public liveness check. Returns no user data.',
  'api/health/detail/route.ts': 'Session-guarded directly; reports only the caller own scope.',
  'api/notifications/dispatch/route.ts': 'Machine endpoint, authorised by a bearer CRON_SECRET.',
  'api/push/subscribe/route.ts': 'Session-guarded directly; scoped to the caller own devices.',
  'api/push/test/route.ts': 'Session-guarded directly; sends only to the caller own devices.',
  'api/relationship/redeem/route.ts':
    'Unauthenticated by necessity: the person redeeming has no account. The single-use token is the credential.',
};

describe('every route is guarded', () => {
  it('derives its guard from the matrix, or is an annotated exception', () => {
    const unguarded = ROUTES.filter(
      ({ rel, code }) => !code.includes('requireCapability') && !(rel in UNGUARDED),
    );

    expect(unguarded.map((r) => r.rel)).toEqual([]);
  });

  it('has no inline role comparison anywhere', () => {
    // The whole point of a matrix is that the rule lives in one place.
    const inline = ROUTES.filter(({ code }) =>
      /role\s*===\s*['"](primary|overseer)['"]/.test(code),
    );

    expect(inline.map((r) => r.rel)).toEqual([]);
  });

  it('scans a meaningful number of routes', () => {
    expect(ROUTES.length).toBeGreaterThan(10);
  });

  it('lists no stale exception', () => {
    // An exemption for a route that no longer exists hides the next one.
    const paths = new Set(ROUTES.map((r) => r.rel));
    for (const exempt of Object.keys(UNGUARDED)) {
      expect(paths.has(exempt)).toBe(true);
    }
  });
});

/** Capabilities each route requires, read from the source. */
function capabilitiesOf(code: string): Capability[] {
  return [...code.matchAll(/requireCapability\('([^']+)'/g)].map((match) => match[1] as Capability);
}

describe('the primary is denied consequence configuration', () => {
  it('holds for every capability a route actually requires', () => {
    /**
     * The load-bearing rule. An arrangement whose subject can edit their own
     * consequences is not an arrangement.
     */
    const routesWritingConsequences = ROUTES.filter((route) =>
      capabilitiesOf(route.code).includes('consequence:write'),
    );

    // Every such route, if any exist yet, is unreachable by the primary.
    expect(routesWritingConsequences.filter(() => can('primary', 'consequence:write'))).toEqual([]);

    // And directly, so the claim holds before such a route exists.
    expect(can('primary', 'consequence:write')).toBe(false);
  });

  it('is not merely absent from the UI', () => {
    // The route must REJECT it. No route may guard consequence writes with a
    // capability the primary happens to hold.
    for (const route of ROUTES) {
      const caps = capabilitiesOf(route.code);
      if (route.rel.includes('consequence')) {
        const primaryReachable = caps.filter((capability) => can('primary', capability));
        expect(primaryReachable).toEqual([]);
      }
    }
  });
});

describe('the overseer is denied every commitment write', () => {
  const WRITE_CAPABILITIES: Capability[] = [
    'commitment:write',
    'series:write',
    'reckoning:submit',
    'session:write',
  ];

  it('cannot reach any route requiring a write capability', () => {
    const reachable = ROUTES.filter((route) =>
      capabilitiesOf(route.code).some(
        (capability) => WRITE_CAPABILITIES.includes(capability) && can('overseer', capability),
      ),
    );

    expect(reachable.map((r) => r.rel)).toEqual([]);
  });

  it('is denied each write capability directly', () => {
    for (const capability of WRITE_CAPABILITIES) {
      expect(can('overseer' as Role, capability)).toBe(false);
    }
  });

  it('can still reach the read-only record', () => {
    const overseerRoutes = ROUTES.filter((route) =>
      capabilitiesOf(route.code).some((capability) => can('overseer', capability)),
    );

    // The arrangement is pointless if they can see nothing.
    expect(overseerRoutes.length).toBeGreaterThan(0);
  });
});
