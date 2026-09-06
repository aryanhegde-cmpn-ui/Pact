import { jsonOk, requireCapability } from '@/lib/api/guard';
import { getPhaseView } from '@/lib/curriculum/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = requireCapability('curriculum:read', async (actor) =>
  jsonOk({ phases: await getPhaseView(actor.ownerId) }),
);
