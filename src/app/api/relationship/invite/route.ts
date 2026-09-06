import { jsonOk, requireCapability } from '@/lib/api/guard';
import { createInvite, describeRelationship } from '@/lib/auth/relationship';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The primary's view of the arrangement. */
export const GET = requireCapability('relationship:invite', async (actor) => {
  return jsonOk(await describeRelationship(actor.ownerId));
});

/**
 * Mints a single-use invite.
 *
 * The token is returned once and stored only as a digest, so this response is
 * the only chance to copy it.
 */
export const POST = requireCapability('relationship:invite', async (actor) => {
  const invite = await createInvite(actor.ownerId);

  return jsonOk({
    token: invite.token,
    expiresAt: invite.expiresAt.toISOString(),
    note: 'Shown once. Only its hash is stored.',
  });
});
