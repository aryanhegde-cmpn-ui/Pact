import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { submitReckoning } from '@/lib/commitments/reckoning';
import { reckoningSubmissionSchema } from '@/lib/schemas/reckoning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Answers a missed deadline.
 *
 * Idempotent: the underlying event is unique per missed deadline, so a double
 * submission records once and reports `recorded: false` for the second.
 */
export const POST = requireCapability('reckoning:submit', async (actor, request, context) => {
  {
    const { id = '' } = await context.params;
    const input = reckoningSubmissionSchema.parse(await readJson(request));

    return jsonOk(await submitReckoning(id, input, actor.ownerId));
  }
});
