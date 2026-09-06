import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { endSession } from '@/lib/focus/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ends the running session one of three ways.
 *
 * `duringSession` because ending a session completes its commitment, which is
 * a `commitment:write` -- the one write the lock has to let through. Everything
 * else stays refused: this route ends the session it is talking about and
 * cannot create or reschedule anything else.
 *
 * `actualMinutes` is computed on the server from `startedAt`. The request body
 * has no duration in it and would not be believed if it did.
 */
export const POST = requireCapability(
  'commitment:write',
  async (actor, request) => jsonOk(await endSession(await readJson(request), actor.ownerId)),
  { duringSession: true },
);
