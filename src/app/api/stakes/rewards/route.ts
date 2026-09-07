import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { createReward } from '@/lib/stakes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = requireCapability('consequence:write', async (actor, request) =>
  jsonOk(await createReward(await readJson(request), actor.ownerId, actor.userId), 201),
);
