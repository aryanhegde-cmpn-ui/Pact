import { jsonOk, requireCapability } from '@/lib/api/guard';
import { buildTimeline } from '@/lib/commitments/timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The evidence base for one commitment: what happened, in order. */
export const GET = requireCapability('progress:read', async (actor, _request, context) => {
  {
    const { id = '' } = await context.params;
    return jsonOk(await buildTimeline(id, actor.ownerId));
  }
});
