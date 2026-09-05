import 'server-only';

import { ZodError } from 'zod';

import { auth } from '@/lib/auth';
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
