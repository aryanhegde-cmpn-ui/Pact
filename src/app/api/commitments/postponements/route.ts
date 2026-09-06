import { jsonOk, requireCapability } from '@/lib/api/guard';
import { listPostponements } from '@/lib/commitments/timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Commitments grouped by how many times their deadline has moved. */
export const GET = requireCapability('progress:read', async (actor) => {
  {
    return jsonOk(await listPostponements(actor.ownerId));
  }
});
