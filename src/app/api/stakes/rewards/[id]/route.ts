import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { editStake } from '@/lib/stakes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Name and description only.
 *
 * Status is absent deliberately: it is derived from triggers and claims, and
 * letting it be set by hand would make "earned" something granted rather than
 * something the record says happened.
 */
export const PATCH = requireCapability('consequence:write', async (actor, request, context) => {
  const { id } = await context.params;
  await editStake('reward', id ?? '', await readJson(request), actor.ownerId);

  return jsonOk({ id });
});
