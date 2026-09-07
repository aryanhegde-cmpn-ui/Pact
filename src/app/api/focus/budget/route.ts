import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { decideBudget } from '@/lib/focus/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Answers the research budget's single interruption.
 *
 * Once per session, ever. `budgetWarnedAt` is set the moment this is answered
 * and nothing asks again -- a budget that nags gets dismissed reflexively, and
 * then it is not a decision point, it is noise.
 */
export const POST = requireCapability('session:write', async (actor, request) =>
  jsonOk({ session: await decideBudget(await readJson(request), actor.ownerId) }),
);
