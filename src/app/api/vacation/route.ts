import { jsonOk, readJson, requireCapability } from '@/lib/api/guard';
import { setVacationSchema } from '@/lib/schemas/stakes';
import { getVacationState, setVacation } from '@/lib/stakes/vacation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = requireCapability('commitment:read', async (actor) =>
  jsonOk(await getVacationState(actor.ownerId)),
);

/**
 * The PRIMARY's toggle, and only theirs.
 *
 * `vacation:write` is absent from the overseer's capabilities. A vacation an
 * overseer can veto is one you route around by not opening the app, and an
 * accountability tool nobody opens reports nothing at all.
 *
 * It cannot discharge an active consequence: turning it on stops further
 * evaluation, and the discharge rules have no branch for time passing.
 */
export const POST = requireCapability('vacation:write', async (actor, request) => {
  const input = setVacationSchema.parse(await readJson(request));

  return jsonOk(await setVacation(input, actor.ownerId));
});
