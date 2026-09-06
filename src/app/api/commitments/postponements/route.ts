import { auth } from '@/lib/auth';
import { jsonError, jsonOk, translateError } from '@/lib/api/guard';
import { listPostponements } from '@/lib/commitments/timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Commitments grouped by how many times their deadline has moved. */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    return jsonOk(await listPostponements());
  } catch (error) {
    return translateError(error);
  }
}
