import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { claimReward, readState } from '@/lib/stakes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The primary taking a reward they have already earned.
 *
 * Outside `api/stakes/` on purpose: everything in that directory is the
 * overseer's, enforced by a scanner with no exception list. This is the
 * primary's one stake action, so it lives somewhere else rather than becoming
 * the exception that makes the rule negotiable.
 *
 * It can only move `earned` to `claimed`. The condition on the update is what
 * stops a claim being a way to award yourself.
 */
export const POST = requireCapability('reward:claim', async (actor, request) => {
  await claimReward(await readJson(request), actor.ownerId);

  return jsonOk(await readState(actor.ownerId));
});
