import { jsonError, jsonOk, readJson, translateError } from '@/lib/api/guard';
import {
  GENERIC_RECOVERY_ERROR,
  RecoveryError,
  verifyRecoveryCode,
} from '@/lib/auth/account-recovery';
import { recoveryVerifySchema } from '@/lib/schemas/account-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step one: an identifier and a recovery code, together.
 *
 * DELIBERATELY UNAUTHENTICATED -- the whole point is that the caller cannot
 * sign in. That is safe because the code is the credential: ten characters of
 * unguessable randomness, single-use, compared against an argon2 digest, and
 * limited by the same lockout counter the password form uses.
 *
 * BOTH FIELDS ARRIVE AT ONCE, and that is the security property this route
 * exists to hold. Taking the identifier first and the code second would answer
 * "does this account exist" before any secret had been presented -- a public
 * enumeration oracle. Everything below returns one message.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = recoveryVerifySchema.safeParse(await readJson(request));

    // Even a malformed body gets the generic message. A validation error here
    // would say which field was wrong, and "the identifier is fine" is exactly
    // the sentence this endpoint must never produce.
    if (!parsed.success) return jsonError(GENERIC_RECOVERY_ERROR, 400);

    const { token, expiresAt } = await verifyRecoveryCode(parsed.data.identifier, parsed.data.code);

    return jsonOk({ token, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    if (error instanceof RecoveryError) return jsonError(error.message, error.status);
    return translateError(error);
  }
}
