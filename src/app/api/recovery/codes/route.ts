import { jsonOk, requireCapability } from '@/lib/api/guard';
import { generateRecoveryCodes, remainingRecoveryCodes } from '@/lib/auth/account-recovery';
import { formatRecoveryCode } from '@/lib/schemas/account-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Issues a fresh set, retiring whatever came before.
 *
 * POST rather than GET, because it CHANGES something: the previous set stops
 * working the moment this returns. There is deliberately no route that reads
 * codes back -- they exist in plaintext in this one response and nowhere else
 * afterwards, so a "show them again" endpoint would hand the account's
 * recovery credential to whoever is already signed in on a borrowed laptop,
 * which is the situation the codes exist to survive.
 *
 * The target is the SESSION's account. No user id is accepted, so the
 * capability grants nothing over anybody else's login.
 */
export const POST = requireCapability('recovery:manage', async (actor) => {
  const { codes } = await generateRecoveryCodes(actor.userId);

  return jsonOk({
    codes: codes.map(formatRecoveryCode),
    remaining: await remainingRecoveryCodes(actor.userId),
  });
});
