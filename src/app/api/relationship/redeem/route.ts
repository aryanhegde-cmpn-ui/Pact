import { jsonError, jsonOk, readJson, translateError } from '@/lib/api/guard';
import { redeemInvite, RelationshipError } from '@/lib/auth/relationship';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Redeems an invite and creates the overseer account.
 *
 * DELIBERATELY UNAUTHENTICATED -- the person redeeming has no account yet. That
 * is safe only because the token is the credential: 32 random bytes, single
 * use, expiring, and compared against a stored digest. There is no other way
 * to create an account, and no open registration.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await readJson(request)) as Record<string, string>;

    if (!body.token) return jsonError('That invite is not valid.', 400);

    const result = await redeemInvite({
      token: body.token,
      username: body.username ?? '',
      email: body.email ?? '',
      password: body.password ?? '',
      displayName: body.displayName,
    });

    return jsonOk({ created: true, overseerUserId: result.overseerUserId });
  } catch (error) {
    if (error instanceof RelationshipError) return jsonError(error.message, error.status);
    return translateError(error);
  }
}
