import 'server-only';

import { randomUUID } from 'node:crypto';

import { cache } from 'react';

import { ZodError } from 'zod';

import { auth } from '@/lib/auth';
import { isPactError } from '@/lib/api/errors';
import { can, isRole, type Capability, type Role } from '@/lib/auth/permissions';
import { SESSION_LOCK_MESSAGE, SESSION_LOCKED_CAPABILITIES } from '@/lib/schemas/focus';
import { connectToDatabase } from '@/lib/db/mongoose';
import { CommitmentError } from '@/lib/commitments/service';
import { EnvironmentError } from '@/lib/env';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export function jsonError(message: string, status: number, extra?: unknown): Response {
  return Response.json(
    { error: message, details: extra ?? undefined },
    { status, headers: NO_STORE },
  );
}

export function jsonOk(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * Wraps a route handler with the session check and error translation every
 * mutation route needs.
 *
 * Centralised so a new route cannot be added without the guard: forgetting it
 * on one handler is the realistic failure mode, and it is invisible until
 * someone finds the endpoint.
 */
export interface Actor {
  userId: string;
  role: Role;
  /** The primary whose data this request may touch. ALWAYS the query scope. */
  ownerId: string;
}

/**
 * Resolves the caller, or null when unauthenticated.
 *
 * `ownerId` is the important field. Every scoped query filters on it, so an
 * overseer reading commitments and a primary reading their own run the same
 * query with a different value -- rather than two code paths, one of which
 * eventually forgets the filter.
 */
export async function currentActor(): Promise<Actor | null> {
  const session = await auth();
  if (!session?.user) return null;

  const stored = await accountForRequest(session.user.id);

  /**
   * A SESSION OLDER THAN THE LAST PASSWORD RESET IS DEAD.
   *
   * Auth.js sessions are JWTs -- stateless, ninety days, and nothing on the
   * server can reach out and revoke one. Recovering an account has to end the
   * sessions of whoever knew the old password, or the recovery has taken
   * nothing away from them. So the revocation is a comparison made here
   * instead: when the session began, against when the account was last reset.
   *
   * A session with no stamp at all counts as older than any reset. Those are
   * the tokens minted before this existed, and "sign in again" is the right
   * answer for one of them once a reset has happened.
   */
  if (stored?.sessionsValidFrom) {
    const signedInAt = session.user.signedInAt ?? 0;
    if (signedInAt < stored.sessionsValidFrom.getTime()) return null;
  }

  /**
   * The role is read rather than trusted, on every request.
   *
   * It is copied into the JWT at sign-in and the token lives ninety days, so
   * the token is a cache and the database is the source of truth. A session
   * minted while `seedUser` still wrote `role: 'owner'` carried a value in no
   * enum and failed every guarded route -- 500 before `can()` was made to fail
   * closed, 403 afterwards, and neither is what somebody should get for having
   * signed in before a bug was fixed.
   *
   * THE COST IS ONE INDEXED `_id` LOOKUP PER REQUEST, and it is deliberate.
   * This used to happen only on the anomalous path, which was cheaper and
   * could not support revocation at all: knowing whether a session predates a
   * reset means reading the account every time, by definition. It is the
   * cheapest query MongoDB has, it is deduped per request by `cache`, and the
   * guard already reads the relationship for an overseer and the running
   * session for a locked capability.
   */
  const claimed = session.user.role ?? 'primary';
  const role: Role = isRole(stored?.role) ? stored.role : isRole(claimed) ? claimed : 'primary';

  return {
    userId: session.user.id,
    role,
    ownerId: session.user.ownerId ?? session.user.id,
  };
}

/**
 * The account behind this request, read once however many times it is asked for.
 *
 * `cache` dedupes within a render pass, which matters because a page under the
 * shell resolves the actor and so does the layout above it.
 */
const accountForRequest = cache(
  async (userId: string): Promise<{ role: string; sessionsValidFrom: Date | null } | null> => {
    const { UserModel } = await import('@/lib/db/models/user');
    await connectToDatabase();

    const row = await UserModel.findOne({ _id: userId }, { role: 1, sessionsValidFrom: 1 }).lean();
    if (!row) return null;

    return { role: row.role, sessionsValidFrom: row.sessionsValidFrom ?? null };
  },
);

/**
 * Guards a handler by CAPABILITY, never by role.
 *
 * The capability comes from the matrix in src/lib/auth/permissions.ts, so a
 * rule change is one edit there rather than a search for every `role ===`
 * comparison. A handler that needs to know the role has almost certainly
 * misidentified what it is actually checking.
 *
 * An overseer's relationship is re-checked on EVERY request rather than
 * trusted from the session, because revocation has to take effect immediately
 * -- a JWT issued before revocation would otherwise keep working until it
 * expired, which for a 90-day session is not a revocation at all.
 */
export interface GuardOptions {
  /**
   * Lets this route write while a focus session is running.
   *
   * Only the focus routes themselves have any business doing so -- ending a
   * session completes its commitment, which is a `commitment:write`. Every
   * other write is refused, and the scanner in
   * `src/lib/route-permissions.test.ts` fails on a route outside `api/focus`
   * that sets this.
   */
  duringSession?: boolean;
}

export function requireCapability(
  capability: Capability,
  handler: (actor: Actor, request: Request, context: RouteContext) => Promise<Response>,
  options: GuardOptions = {},
): (request: Request, context: RouteContext) => Promise<Response> {
  return async (request, context) => {
    /**
     * The WHOLE guard is inside the try, not just the handler.
     *
     * `can()`, the relationship re-check and the session lock all run before
     * the handler and all touch the database or the matrix. When only the
     * handler was wrapped, a throw in any of them escaped as a bare 500 with a
     * stack trace -- which is exactly how the invite route failed.
     */
    try {
      const actor = await currentActor();
      if (!actor) return jsonError('Sign in required.', 401);

      if (!can(actor.role, capability)) {
        // Deliberately terse and identical for every denial: an error that names
        // the capability tells a caller what exists.
        return jsonError('Not permitted.', 403);
      }

      if (actor.role === 'overseer') {
        const live = await relationshipIsActive(actor.userId, actor.ownerId);
        if (!live) return jsonError('Not permitted.', 403);
      }

      /**
       * THE SESSION LOCK, ENFORCED HERE RATHER THAN IN THE UI.
       *
       * The point of a full-screen session is that it is the only thing
       * happening. A lock the UI holds is not a lock: a second tab routes
       * straight around it, and so does a phone that restored a page from before
       * the session started.
       *
       * In the guard specifically, for the same reason the capability check is:
       * the realistic failure is a route added next month that nobody remembers
       * to lock, and only something every route already passes through can
       * catch that.
       */
      if (!options.duringSession && isSessionLocked(capability)) {
        const running = await hasRunningSession(actor.ownerId);
        if (running) return jsonError(SESSION_LOCK_MESSAGE, 409);
      }

      return await handler(actor, request, context ?? { params: Promise.resolve({}) });
    } catch (error) {
      return translateError(error);
    }
  };
}

export interface RouteContext {
  params: Promise<Record<string, string>>;
}

function isSessionLocked(capability: Capability): boolean {
  return (SESSION_LOCKED_CAPABILITIES as readonly string[]).includes(capability);
}

/**
 * Whether a session is running, read per request.
 *
 * A read, not a cached flag: the session started in another tab a second ago
 * is exactly the one this needs to see.
 */
async function hasRunningSession(ownerId: string): Promise<boolean> {
  const { FocusSessionModel } = await import('@/lib/db/models/focus-session');
  await connectToDatabase();

  const running = await FocusSessionModel.findOne({ ownerId, endedAt: null }, { _id: 1 }).lean();

  return running !== null;
}

/**
 * Whether an overseer's arrangement is still in force.
 *
 * Read per request. See the note on requireCapability: a session outlives a
 * revocation, so the session cannot be the source of truth for it.
 */
async function relationshipIsActive(
  overseerUserId: string,
  primaryUserId: string,
): Promise<boolean> {
  const { RelationshipModel } = await import('@/lib/db/models/relationship');
  await connectToDatabase();

  const active = await RelationshipModel.findOne({
    overseerUserId,
    primaryUserId,
    status: 'active',
  }).lean();

  return active !== null;
}

export function withSession(
  handler: (context: { userId: string; now: Date }) => Promise<Response>,
): () => Promise<Response> {
  return async () => {
    /**
     * `currentActor()`, not `auth()`.
     *
     * There is ONE definition of "signed in" in this app and it is that
     * function, because it is the only one that knows about a password reset.
     * A route reading the JWT directly would accept a session the guard
     * rejects -- which is not a cosmetic inconsistency: it is an endpoint that
     * still works for whoever knew the old password.
     */
    const actor = await currentActor();
    if (!actor) {
      return jsonError('Sign in required.', 401);
    }

    try {
      return await handler({ userId: actor.userId, now: new Date() });
    } catch (error) {
      return translateError(error);
    }
  };
}

/**
 * Mongo's duplicate-key error. A uniqueness rule was enforced by the index,
 * which in this codebase is usually the design working rather than a fault --
 * but at the route boundary it is a conflict, not a server error.
 */
const DUPLICATE_KEY = 11_000;

/**
 * Turns anything a handler can throw into a response the caller can act on.
 *
 * No route may return a bare 500 from an escaped exception. A 500 with a stack
 * trace tells the user nothing they can do and tells an attacker where the
 * code lives; a 409 saying "an overseer is already active, revoke them first"
 * is the same failure, answered.
 */
export function translateError(error: unknown): Response {
  if (error instanceof ZodError) {
    return jsonError(
      'That is not valid.',
      422,
      error.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        message: issue.message,
      })),
    );
  }

  /**
   * Raised deliberately, with a message meant to be read.
   *
   * `instanceof`, not a name match. The first attempt at this compared
   * `error.constructor.name` against a list -- which passed every test and
   * still returned 500 in the production build, because the minifier mangles
   * class names. See `src/lib/api/errors.ts`.
   */
  if (isPactError(error)) return jsonError(error.message, error.status);

  if (error instanceof EnvironmentError) return jsonError('Server is misconfigured.', 503);

  /**
   * Schema validation, which is a bad REQUEST rather than a bad server.
   *
   * Reachable now that `runValidators` is on globally: an update carrying a
   * value outside an enum throws here instead of being written silently, which
   * is the point -- but the caller should be told what they sent was wrong.
   */
  if (error instanceof Error && error.name === 'ValidationError') {
    const fields = (error as Error & { errors?: Record<string, { message: string }> }).errors ?? {};

    return jsonError(
      'That is not valid.',
      400,
      Object.entries(fields).map(([field, detail]) => ({ field, message: detail.message })),
    );
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  ) {
    return jsonError('That already exists.', 409);
  }

  /**
   * Genuinely unexpected. Logged with a correlation id and the id returned, so
   * a report of "it broke" can be matched to the stack trace that caused it --
   * without putting the stack trace itself in a response.
   */
  const correlationId = randomUUID();
  console.error(`[api] unhandled ${correlationId}`, error);

  return jsonError('Something went wrong.', 500, { correlationId });
}

/** Parses a JSON body, turning a malformed one into a 400 rather than a 500. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new CommitmentError('Body must be JSON.', 400);
  }
}
