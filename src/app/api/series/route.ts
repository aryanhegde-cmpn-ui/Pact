import { auth } from '@/lib/auth';
import { jsonError, jsonOk, readJson, translateError } from '@/lib/api/guard';
import { createSeries, listSeries } from '@/lib/commitments/series-service';
import { createSeriesSchema } from '@/lib/schemas/series';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    return jsonOk({ series: await listSeries() });
  } catch (error) {
    return translateError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    const input = createSeriesSchema.parse(await readJson(request));
    return jsonOk(await createSeries(input), 201);
  } catch (error) {
    return translateError(error);
  }
}
