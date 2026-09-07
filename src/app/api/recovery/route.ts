import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { getRecoveryState, resolveSlot } from '@/lib/commitments/recovery';
import { resolveSlotSchema } from '@/lib/schemas/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = requireCapability('commitment:read', async (actor) =>
  jsonOk(await getRecoveryState(actor.ownerId)),
);

/**
 * Dispatches one of the three slots.
 *
 * Every branch goes through the ordinary service. A reschedule here still
 * answers its miss first, because an unanswered miss cannot be rescheduled --
 * and a backlog is exactly when it would be tempting to let that slide.
 */
export const POST = requireCapability('commitment:write', async (actor, request) => {
  const input = resolveSlotSchema.parse(await readJson(request));

  return jsonOk(await resolveSlot(input, actor.ownerId));
});
