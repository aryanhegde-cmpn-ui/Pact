import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { changeDeadline } from '@/lib/commitments/deadline';
import { getCommitment } from '@/lib/commitments/service';
import { changeDeadlineSchema } from '@/lib/schemas/commitment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The ONLY route that can move a deadline, and it requires a reason.
 *
 * Separate from PATCH deliberately: making it its own endpoint is what stops a
 * reschedule from riding along inside a routine edit.
 */
export const POST = requireCapability('commitment:write', async (actor, request, context) => {
  {
    const { id = '' } = await context.params;
    const input = changeDeadlineSchema.parse(await readJson(request));

    await changeDeadline(id, input, actor.ownerId);
    return jsonOk(await getCommitment(id, actor.ownerId));
  }
});
