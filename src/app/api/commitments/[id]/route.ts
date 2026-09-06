import { jsonError, jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { getCommitment, updateCommitment } from '@/lib/commitments/service';
import { FORBIDDEN_UPDATE_FIELDS, updateCommitmentSchema } from '@/lib/schemas/commitment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = requireCapability('commitment:read', async (actor, _request, context) => {
  {
    const { id = '' } = await context.params;
    return jsonOk(await getCommitment(id, actor.ownerId));
  }
});

/**
 * The generic edit path.
 *
 * Rejects `dueAt` explicitly and by name. The schema is `.strict()` and would
 * reject it anyway, but as an unknown key with a generic message -- and a
 * caller who quietly gets a 422 for "unrecognized key" learns nothing about
 * WHY, which is the part that matters here.
 */
export const PATCH = requireCapability('commitment:write', async (actor, request, context) => {
  {
    const { id = '' } = await context.params;
    const body = await readJson(request);

    if (body && typeof body === 'object') {
      const present = FORBIDDEN_UPDATE_FIELDS.filter((field) => field in body);
      if (present.length > 0) {
        return jsonError(
          present.includes('dueAt')
            ? 'dueAt cannot be changed here. Use POST /api/commitments/:id/deadline, which requires a reason and records the change.'
            : `These fields cannot be set directly: ${present.join(', ')}.`,
          422,
          { rejected: present },
        );
      }
    }

    const input = updateCommitmentSchema.parse(body);
    return jsonOk(await updateCommitment(id, input, actor.ownerId));
  }
});
