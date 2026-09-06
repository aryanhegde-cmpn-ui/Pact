import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { abandonCommitment } from '@/lib/commitments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = requireCapability('commitment:write', async (actor, request, context) => {
  {
    const { id = '' } = await context.params;
    // A reason is optional here but recorded either way: abandoning is a
    // legitimate decision, and the log should say it was made deliberately.
    const body = (await readJson(request).catch(() => ({}))) as { reason?: string };
    const reason = (body.reason ?? '').trim() || 'No reason given';

    return jsonOk(await abandonCommitment(id, reason, actor.ownerId));
  }
});
