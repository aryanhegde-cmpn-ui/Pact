import { auth } from '@/lib/auth';
import { jsonError, jsonOk, translateError } from '@/lib/api/guard';
import { buildTimeline } from '@/lib/commitments/timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The evidence base for one commitment: what happened, in order. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    const { id } = await params;
    return jsonOk(await buildTimeline(id));
  } catch (error) {
    return translateError(error);
  }
}
