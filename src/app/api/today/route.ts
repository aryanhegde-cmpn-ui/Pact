import { jsonOk, requireCapability } from '@/lib/api/guard';
import { buildDay, buildTomorrow } from '@/lib/today/service';
import { getEnv } from '@/lib/env';
import { toDateKey } from '@/lib/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The whole of Today, in one response.
 *
 * One endpoint rather than several because the page updates as a unit:
 * completing a block changes the ring, the next action, the ledger and the
 * overdue count at once, and four requests would render four intermediate
 * states nobody asked to see.
 */
export const GET = requireCapability('commitment:read', async (actor, request) => {
  const tomorrow = new URL(request.url).searchParams.get('day') === 'tomorrow';
  if (tomorrow) return jsonOk(await buildTomorrow(actor.ownerId));

  const now = new Date();

  return jsonOk(await buildDay(actor.ownerId, toDateKey(now, getEnv().APP_TIMEZONE), now));
});
