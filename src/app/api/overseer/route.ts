import { jsonOk, requireCapability } from '@/lib/api/guard';
import { buildOverseerSnapshot } from '@/lib/commitments/overseer-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The overseer's read model.
 *
 * Guarded by `progress:read`, which the primary also holds -- so the primary
 * can see exactly what their overseer sees. That is deliberate: an
 * accountability arrangement where one side cannot inspect what the other is
 * shown invites suspicion the app has no way to answer.
 */
export const GET = requireCapability('progress:read', async (actor) => {
  return jsonOk(await buildOverseerSnapshot(actor.ownerId));
});
