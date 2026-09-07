import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { editStake } from '@/lib/stakes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = requireCapability('consequence:write', async (actor, request, context) => {
  const { id } = await context.params;
  await editStake('consequence', id ?? '', await readJson(request), actor.ownerId);

  return jsonOk({ id });
});
