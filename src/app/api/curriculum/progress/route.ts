import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { setTopicProgress } from '@/lib/curriculum/service';
import { setTopicProgressSchema } from '@/lib/schemas/curriculum';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = requireCapability('curriculum:write', async (actor, request) => {
  const input = setTopicProgressSchema.parse(await readJson(request));

  return jsonOk(await setTopicProgress(input, actor.ownerId));
});
