import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { grantReward, readState } from '@/lib/stakes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The overseer granting a `manual-grant` reward: their decision, with no rule. */
export const POST = requireCapability('consequence:write', async (actor, request) => {
  await grantReward(await readJson(request), actor.ownerId);

  return jsonOk(await readState(actor.ownerId));
});
