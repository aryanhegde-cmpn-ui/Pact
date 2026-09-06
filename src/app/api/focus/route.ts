import { jsonOk, requireCapability } from '@/lib/api/guard';
import { getActiveSession } from '@/lib/focus/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The running session, if there is one.
 *
 * `serverNow` comes back with it. The client renders the timer from
 * `serverNow - startedAt` plus its own offset, never from an interval it has
 * been counting -- a backgrounded tab stops counting and would report a
 * ninety-minute session as a few minutes.
 */
export const GET = requireCapability('session:read', async (actor) =>
  jsonOk({ session: await getActiveSession(actor.ownerId) }),
);
