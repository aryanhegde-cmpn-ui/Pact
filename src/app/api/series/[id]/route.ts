import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { endSeries, updateSeries } from '@/lib/commitments/series-service';
import { getEnv } from '@/lib/env';
import { updateSeriesSchema } from '@/lib/schemas/series';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Edits a series at one of two scopes. There is no "all occurrences": past
 * occurrences are historical fact. See the series service for the reasoning.
 */
export const PATCH = requireCapability('series:write', async (actor, request, context) => {
  {
    const { id = '' } = await context.params;
    const input = updateSeriesSchema.parse(await readJson(request));

    return jsonOk(await updateSeries(id, input, getEnv().APP_TIMEZONE, actor.ownerId));
  }
});

/**
 * Ends a series. Not a delete: occurrences already in the past stay exactly as
 * they are, because they record what happened.
 */
export const DELETE = requireCapability('series:write', async (actor, _request, context) => {
  {
    const { id = '' } = await context.params;
    return jsonOk(await endSeries(id, getEnv().APP_TIMEZONE, actor.ownerId));
  }
});
