import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { getStudyToday, overrideTopic } from '@/lib/curriculum/service';
import { overrideTopicSchema } from '@/lib/schemas/curriculum';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = requireCapability('curriculum:read', async (actor) =>
  jsonOk(await getStudyToday(actor.ownerId)),
);

/**
 * Swaps the topic one of today's blocks is for.
 *
 * The suggestion is a default, never a lock. This changes what the block is
 * about; it does not and cannot change when the block is -- `dueAt` has
 * exactly one writer, and it is not here.
 */
export const POST = requireCapability('curriculum:write', async (actor, request) => {
  const input = overrideTopicSchema.parse(await readJson(request));
  await overrideTopic(input, actor.ownerId);

  return jsonOk(await getStudyToday(actor.ownerId));
});
