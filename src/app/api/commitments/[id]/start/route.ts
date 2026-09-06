import { jsonOk, requireCapability } from '@/lib/api/guard';
import { startCommitment } from '@/lib/commitments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = requireCapability('commitment:write', async (actor, request, context) => {
  {
    const { id = '' } = await context.params;
    void request;
    return jsonOk(await startCommitment(id, actor.ownerId));
  }
});
