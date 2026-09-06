import 'server-only';

import { ZodError } from 'zod';

import { auth } from '@/lib/auth';
import { can, type Capability, type Role } from '@/lib/auth/permissions';
import { SESSION_LOCK_MESSAGE, SESSION_LOCKED_CAPABILITIES } from '@/lib/schemas/focus';
import { connectToDatabase } from '@/lib/db/mongoose';
import { CommitmentError } from '@/lib/commitments/service';
import { DeadlineError } from '@/lib/commitments/deadline';
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

  const role = (session.user.role ?? 'primary') as Role;

  return {
    userId: session.user.id,
    role,
    ownerId: session.user.ownerId ?? session.user.id,
  };
}

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

    try {
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
    const session = await auth();
    if (!session?.user) {
      return jsonError('Sign in required.', 401);
    }

    try {
      return await handler({ userId: session.user.id, now: new Date() });
    } catch (error) {
      return translateError(error);
    }
  };
}

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

  if (error instanceof CommitmentError) return jsonError(error.message, error.status);
  if (error instanceof DeadlineError) return jsonError(error.message, 400);
  if (error instanceof EnvironmentError) return jsonError('Server is misconfigured.', 503);

  console.error('[api] unhandled', error);
  return jsonError('Something went wrong.', 500);
}

/** Parses a JSON body, turning a malformed one into a 400 rather than a 500. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new CommitmentError('Body must be JSON.', 400);
  }
}
