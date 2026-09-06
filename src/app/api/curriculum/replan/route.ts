import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { replanPhase } from '@/lib/curriculum/replan';
import { getPhaseView } from '@/lib/curriculum/service';
import { replanSchema } from '@/lib/schemas/curriculum';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Moves a phase's end date, and everything after it by the same amount.
 *
 * The only way the schedule changes. A reason is required for the same
 * structural purpose it is required on a deadline change: moving a plan you
 * are behind on should be a decision someone articulates, not a drag that
 * happens five times without ever feeling like anything.
 */
export const POST = requireCapability('curriculum:write', async (actor, request) => {
  const input = replanSchema.parse(await readJson(request));
  const result = await replanPhase(input, actor.ownerId);

  return jsonOk({ ...result, phases: await getPhaseView(actor.ownerId) });
});
