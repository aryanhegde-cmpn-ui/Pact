import { jsonOk, requireCapability } from '@/lib/api/guard';
import { recordInterruption } from '@/lib/focus/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Interruptions are counted, not prevented. */
export const POST = requireCapability('session:write', async (actor) =>
  jsonOk({ interruptionCount: await recordInterruption(actor.ownerId) }),
);
