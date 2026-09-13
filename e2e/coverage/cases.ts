/**
 * How a route's coverage is declared.
 *
 * ---------------------------------------------------------------------------
 * REGISTERED, NEVER INFERRED.
 * ---------------------------------------------------------------------------
 * A route that happens to be loaded while something else is being tested is
 * NOT covered. That distinction is not pedantry: the landing page shipped with
 * a 600px form on a 390px screen while the suite was green, because every spec
 * signed in through it and none of them looked at it. "Touched" and "asserted
 * against" are different things, and only one of them is coverage.
 *
 * So coverage is a declaration. Each entry names the test that covers it, the
 * gate checks that test exists and is not skipped, and adding a route without
 * adding an entry fails the build.
 * ---------------------------------------------------------------------------
 */

/** A case is covered by a named test, or it cannot exist and says why. */
export type Coverage = { covered: string } | { notApplicable: string };

export function covered(testTitle: string): Coverage {
  return { covered: testTitle };
}

/**
 * A case that cannot exist for this route.
 *
 * Spelled out rather than omitted. "This public route has no 401" is a claim
 * somebody made and can be argued with; a missing field is an oversight nobody
 * can tell from a decision.
 */
export function notApplicable(reason: string): Coverage {
  return { notApplicable: reason };
}

export function isCovered(value: Coverage): value is { covered: string } {
  return 'covered' in value;
}

/**
 * The four cases every API route answers for.
 *
 * Not a style rule. Each one is a different code path: the handler, the guard's
 * session check, the guard's capability check, and the schema. A route with a
 * green success test and no 403 test is a route whose authorisation has never
 * run in a test.
 */
export interface ApiRegistration {
  route: string;
  methods: readonly ('GET' | 'POST' | 'PATCH' | 'DELETE')[];
  /** The capability the guard requires, or null when the route is public. */
  capability: string | null;
  /** Keys the success response must carry. Empty when the body is not JSON. */
  shape?: readonly string[];
  success: Coverage;
  unauthenticated: Coverage;
  /** A caller who IS signed in and still may not do this. */
  forbidden: Coverage;
  validation: Coverage;
}

export interface PageRegistration {
  route: string;
  /** The test that asserts something about this page, by name. */
  rendered: Coverage;
  /** Whether a signed-out visitor can reach it. */
  public: boolean;
}

/** Title builders, shared so the registry and the sweep cannot drift apart. */
export function anonymousTitle(route: string): string {
  return `${route} refuses an anonymous caller`;
}

export function forbiddenTitle(route: string): string {
  return `${route} refuses a signed-in caller without the capability`;
}

export function validationTitle(route: string): string {
  return `${route} refuses a malformed body`;
}

export function successTitle(route: string): string {
  return `${route} answers with its documented shape`;
}
