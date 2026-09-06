import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { createSeries, listSeries } from '@/lib/commitments/series-service';
import { createSeriesSchema } from '@/lib/schemas/series';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = requireCapability('series:read', async (actor) => {
  {
    return jsonOk({ series: await listSeries(actor.ownerId) });
  }
});

export const POST = requireCapability('series:write', async (actor, request) => {
  {
    const input = createSeriesSchema.parse(await readJson(request));
    return jsonOk(await createSeries(input, actor.ownerId), 201);
  }
});
