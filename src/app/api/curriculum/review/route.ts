import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { correctTarget, listFlagged } from '@/lib/curriculum/service';
import { correctTargetSchema } from '@/lib/schemas/curriculum';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Topics whose practice target the parser declined to guess at. */
export const GET = requireCapability('curriculum:read', async (actor) =>
  jsonOk({ flagged: await listFlagged(actor.ownerId) }),
);

export const POST = requireCapability('curriculum:write', async (actor, request) => {
  const input = correctTargetSchema.parse(await readJson(request));

  return jsonOk({ flagged: await correctTarget(input, actor.ownerId) });
});
