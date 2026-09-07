import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { createConsequence } from '@/lib/stakes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The window is capped by the schema, not by the form.
 *
 * A cap that only exists in the UI is a cap the API does not have, and this is
 * the one number docs/product.md insists is enforced in config rather than
 * left to the overseer's discretion in the moment.
 */
export const POST = requireCapability('consequence:write', async (actor, request) =>
  jsonOk(await createConsequence(await readJson(request), actor.ownerId, actor.userId), 201),
);
