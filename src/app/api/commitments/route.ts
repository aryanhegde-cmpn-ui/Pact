import { auth } from '@/lib/auth';
import { jsonError, jsonOk, readJson, translateError } from '@/lib/api/guard';
import { createCommitment, listByDateRange, listOverdue } from '@/lib/commitments/service';
import { createCommitmentSchema, dateRangeSchema } from '@/lib/schemas/commitment';
import { getEnv } from '@/lib/env';
import { toDateKey } from '@/lib/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** List by local date range. Defaults to today when no range is given. */
export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    const timeZone = getEnv().APP_TIMEZONE;
    const now = new Date();
    const url = new URL(request.url);
    const today = toDateKey(now, timeZone);

    const range = dateRangeSchema.parse({
      from: url.searchParams.get('from') ?? today,
      to: url.searchParams.get('to') ?? today,
    });

    const [inRange, overdue] = await Promise.all([
      listByDateRange(range.from, range.to, timeZone, now),
      listOverdue(now),
    ]);

    // Overdue work is returned separately rather than merged: it belongs above
    // today's list wherever it is rendered, and a caller should not have to
    // rediscover that by filtering.
    const inRangeIds = new Set(inRange.map((c) => c.id));

    return jsonOk({
      range,
      timeZone,
      commitments: inRange,
      overdue: overdue.filter((c) => !inRangeIds.has(c.id)),
    });
  } catch (error) {
    return translateError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    const body = await readJson(request);
    // Every field is required -- there is no quick-add path. See the schema.
    const input = createCommitmentSchema.parse(body);
    const created = await createCommitment(input);

    return jsonOk(created, 201);
  } catch (error) {
    return translateError(error);
  }
}
