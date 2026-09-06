import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { startSession } from '@/lib/focus/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = requireCapability('session:write', async (actor, request) =>
  jsonOk({ session: await startSession(await readJson(request), actor.ownerId) }, 201),
);
