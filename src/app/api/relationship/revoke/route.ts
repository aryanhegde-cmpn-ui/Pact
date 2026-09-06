import { jsonOk, requireCapability } from '@/lib/api/guard';
import { revokeRelationship } from '@/lib/auth/relationship';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ends the arrangement.
 *
 * Revokes the RELATIONSHIP. It deliberately does not, and must never, let the
 * primary dismiss an individual consequence -- that distinction is the whole
 * point of the arrangement.
 */
export const POST = requireCapability('relationship:revoke', async (actor) => {
  return jsonOk(await revokeRelationship(actor.ownerId));
});
