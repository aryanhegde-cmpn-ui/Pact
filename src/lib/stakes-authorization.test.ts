import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ALL_ROLES,
  can,
  STAKES_CONFIG_CAPABILITIES,
  type Capability,
} from '@/lib/auth/permissions';

/**
 * The authorization boundary on the stakes.
 *
 * ---------------------------------------------------------------------------
 * BY ENUMERATION, NOT BY A LIST OF ROUTES.
 * ---------------------------------------------------------------------------
 * The rule is POSITIONAL: every route under `api/stakes/` is the overseer's,
 * and this walks the directory rather than naming its contents. A route added
 * there next month without a guard, or with a capability the primary happens to
 * hold, fails here without anybody remembering to extend a list — which is the
 * failure mode a hand-maintained list has by construction.
 *
 * The matrix stays the source of truth. Nothing below restates who may do what;
 * it asks `can()` and fails if a route disagrees with it. If the two could
 * disagree, the matrix would not be the source of truth — it would be
 * documentation of one.
 *
 * An arrangement whose subject can edit their own consequences is not an
 * arrangement.
 * ---------------------------------------------------------------------------
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

/**
 * Comments stripped before scanning.
 *
 * The revocation route's own prose explains that revoking must never become a
 * way to dismiss an individual consequence -- correct, load-bearing, and
 * exactly the wording a naive scan reads as a violation.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const ROUTES = routeFiles(APP).map((path) => ({
  rel: relative(APP, path),
  code: stripComments(readFileSync(path, 'utf8')),
}));

function capabilitiesOf(code: string): Capability[] {
  return [...code.matchAll(/requireCapability\(\s*'([^']+)'/g)].map(
    (match) => match[1] as Capability,
  );
}

/** Everything the overseer configures. Discovered, never listed. */
const STAKES_ROUTES = ROUTES.filter((route) => route.rel.startsWith('api/stakes/'));

describe('every route under api/stakes belongs to the overseer', () => {
  it('finds them, so the enumeration is not vacuously empty', () => {
    // A scanner whose glob silently stopped matching passes everything.
    expect(STAKES_ROUTES.length).toBeGreaterThanOrEqual(4);
  });

  it('contains no read the primary shares', () => {
    /**
     * There is deliberately no `GET /api/stakes`. A read both roles need would
     * have to be guarded by `consequence:read`, which the primary holds -- and
     * that single exception would turn the rule below from "every route here"
     * into "every route here except one", which is the shape that grows.
     *
     * The overseer's page calls `readState` directly, as `/overseer` already
     * does; the primary's status reaches them through `/api/today`.
     */
    const reads = STAKES_ROUTES.filter((route) => /export const GET/.test(route.code));

    expect(reads.map((route) => route.rel)).toEqual([]);
  });

  it('guards every one of them', () => {
    const unguarded = STAKES_ROUTES.filter((route) => capabilitiesOf(route.code).length === 0).map(
      (route) => route.rel,
    );

    expect(unguarded).toEqual([]);
  });

  it('denies the primary on every one of them', () => {
    /**
     * The load-bearing assertion. Not "these five routes are safe" but "every
     * route in this directory is, whatever it is called".
     */
    const reachable = STAKES_ROUTES.flatMap((route) =>
      capabilitiesOf(route.code)
        .filter((capability) => can('primary', capability))
        .map((capability) => `${route.rel} requires ${capability}, which the primary holds`),
    );

    expect(reachable).toEqual([]);
  });

  it('uses only capabilities the matrix marks as configuration', () => {
    // Guarding a write with a read capability would pass the check above by
    // accident on the day `consequence:read` was granted to the primary.
    const writes = STAKES_ROUTES.filter((route) =>
      /export const (POST|PATCH|PUT|DELETE)/.test(route.code),
    );
    expect(writes.length).toBe(STAKES_ROUTES.length);

    for (const route of writes) {
      const guards = capabilitiesOf(route.code);
      expect(
        guards.every((capability) => STAKES_CONFIG_CAPABILITIES.includes(capability)),
        `${route.rel} guards a write with ${guards.join(', ')}`,
      ).toBe(true);
    }
  });

  it('has no inline role comparison', () => {
    const inline = STAKES_ROUTES.filter(({ code }) =>
      /role\s*===\s*['"](primary|overseer)['"]/.test(code),
    ).map((route) => route.rel);

    expect(inline).toEqual([]);
  });
});

describe('the primary has no path to their own consequences', () => {
  it('holds none of the configuration capabilities', () => {
    for (const capability of STAKES_CONFIG_CAPABILITIES) {
      expect(can('primary', capability), capability).toBe(false);
    }
  });

  it('cannot dismiss, expire or reschedule one through any route', () => {
    /**
     * Discharge is by doing the work. There is no route that clears a
     * consequence on request, and the words that would name one appear
     * nowhere -- a `POST /dismiss` guarded by a capability the primary holds
     * would pass every check above while defeating the entire mechanism.
     */
    const dismissive = ROUTES.filter((route) =>
      /\b(dismiss|clearConsequence|cancelConsequence|expireConsequence|snooze)\b/i.test(route.code),
    ).map((route) => route.rel);

    expect(dismissive).toEqual([]);
  });

  it('has no field on a stakes route that could set a status', () => {
    // "A field accepted and ignored" is the other way this gets defeated. The
    // edit schema takes name and description only.
    const schema = readFileSync(
      fileURLToPath(new URL('./schemas/stakes.ts', import.meta.url)),
      'utf8',
    );
    const editBlock = schema.slice(
      schema.indexOf('export const editStakeSchema'),
      schema.indexOf('export const grantRewardSchema'),
    );

    expect(editBlock).not.toMatch(/status|dischargedAt|expiresAt|activatedAt/);
  });
});

describe('the primary’s own actions live outside api/stakes', () => {
  it('lets the primary claim a reward, and denies the overseer', () => {
    // Claiming is taking something already earned. The overseer grants; they
    // do not take.
    expect(can('primary', 'reward:claim')).toBe(true);
    expect(can('overseer', 'reward:claim')).toBe(false);
  });

  it('lets the primary control vacation, and denies the overseer', () => {
    /**
     * Deliberate. A vacation an overseer can veto is one you route around by
     * not opening the app, and an accountability tool nobody opens reports
     * nothing at all.
     */
    expect(can('primary', 'vacation:write')).toBe(true);
    expect(can('overseer', 'vacation:write')).toBe(false);
  });

  it('keeps those routes out of the overseer-only directory', () => {
    // Otherwise the positional rule above would need an exception, and an
    // exception list is the thing that grows until the rule means nothing.
    const primaryRoutes = ROUTES.filter((route) =>
      capabilitiesOf(route.code).some(
        (capability) => capability === 'reward:claim' || capability === 'vacation:write',
      ),
    );

    expect(primaryRoutes.length).toBeGreaterThanOrEqual(2);
    for (const route of primaryRoutes) {
      expect(route.rel.startsWith('api/stakes/'), route.rel).toBe(false);
    }
  });
});

describe('the matrix is the source of truth', () => {
  it('grants every capability a stakes route requires to somebody', () => {
    // A route guarded by a capability no role holds is dead code that looks
    // like a feature.
    for (const route of STAKES_ROUTES) {
      for (const capability of capabilitiesOf(route.code)) {
        expect(
          ALL_ROLES.some((role) => can(role, capability)),
          `${route.rel} requires ${capability}, which nobody holds`,
        ).toBe(true);
      }
    }
  });
});

describe('revoking the overseer does not clear the stakes', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./auth/relationship.ts', import.meta.url)),
    'utf8',
  );

  it('touches no consequence or reward', () => {
    /**
     * Revoking is about who configures the arrangement in FUTURE. If it
     * cleared active consequences, the fastest route out of any of them would
     * be revoke, wait, re-invite -- which is the dismiss button the discharge
     * rules exist to refuse, wearing a different hat.
     *
     * They still end on their own: discharged by the work, or expired at the
     * window, which is at most a week.
     */
    expect(stripComments(source)).not.toMatch(/ConsequenceModel|RewardModel/);
  });

  it('revokes the relationship and nothing else', () => {
    const body = stripComments(source).slice(
      stripComments(source).indexOf('export async function revokeRelationship'),
    );
    const writes = [
      ...body.matchAll(/(\w+Model)\.\s*(updateOne|updateMany|deleteOne|deleteMany)/g),
    ];

    expect(writes.map((match) => match[1])).toEqual(['RelationshipModel']);
  });
});
