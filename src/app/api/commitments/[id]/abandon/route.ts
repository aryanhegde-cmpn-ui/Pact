import { auth } from '@/lib/auth';
import { jsonError, jsonOk, readJson, translateError } from '@/lib/api/guard';
import { abandonCommitment } from '@/lib/commitments/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    const { id } = await params;
    // A reason is optional here but recorded either way: abandoning is a
    // legitimate decision, and the log should say it was made deliberately.
    const body = (await readJson(request).catch(() => ({}))) as { reason?: string };
    const reason = (body.reason ?? '').trim() || 'No reason given';

    return jsonOk(await abandonCommitment(id, reason));
  } catch (error) {
    return translateError(error);
  }
}
