import { jsonError, jsonOk, readJson, translateError } from '@/lib/api/guard';
import {
  GENERIC_RECOVERY_ERROR,
  RecoveryError,
  resetPasswordWithToken,
} from '@/lib/auth/account-recovery';
import { recoveryResetSchema } from '@/lib/schemas/account-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step two: the single-purpose token, and a new password.
 *
 * DELIBERATELY UNAUTHENTICATED, and the ONLY route in the app that reads a
 * recovery token. The token is not a session and authenticates nothing else:
 * `currentActor()` has never heard of it, the proxy does not look for it, and
 * it arrives in the body rather than in a cookie so a browser cannot attach it
 * to another request by accident. A scanner asserts no other module imports the
 * token model.
 *
 * Consuming the token, consuming the code and ending every existing session all
 * happen inside the service, each as a conditional update, so a retried request
 * produces one reset rather than two.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = recoveryResetSchema.safeParse(await readJson(request));
    if (!parsed.success) return jsonError(GENERIC_RECOVERY_ERROR, 400);

    const result = await resetPasswordWithToken(parsed.data.token, parsed.data.password);

    // The username goes back so the sign-in form can be filled in for them;
    // they have just proved they own the account, so it discloses nothing they
    // do not already hold.
    return jsonOk({ reset: true, username: result.username, remaining: result.remaining });
  } catch (error) {
    if (error instanceof RecoveryError) return jsonError(error.message, error.status);
    return translateError(error);
  }
}
