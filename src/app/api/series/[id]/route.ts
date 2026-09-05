import { auth } from '@/lib/auth';
import { jsonError, jsonOk, readJson, translateError } from '@/lib/api/guard';
import { endSeries, updateSeries } from '@/lib/commitments/series-service';
import { getEnv } from '@/lib/env';
import { updateSeriesSchema } from '@/lib/schemas/series';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Edits a series at one of two scopes. There is no "all occurrences": past
 * occurrences are historical fact. See the series service for the reasoning.
 */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    const { id } = await params;
    const input = updateSeriesSchema.parse(await readJson(request));

    return jsonOk(await updateSeries(id, input, getEnv().APP_TIMEZONE));
  } catch (error) {
    return translateError(error);
  }
}

/**
 * Ends a series. Not a delete: occurrences already in the past stay exactly as
 * they are, because they record what happened.
 */
export async function DELETE(_request: Request, { params }: Params): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    const { id } = await params;
    return jsonOk(await endSeries(id, getEnv().APP_TIMEZONE));
  } catch (error) {
    return translateError(error);
  }
}
