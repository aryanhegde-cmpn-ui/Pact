import { auth } from '@/lib/auth';
import { jsonError, jsonOk, translateError } from '@/lib/api/guard';
import { startCommitment } from '@/lib/commitments/service';

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
    void request;
    return jsonOk(await startCommitment(id));
  } catch (error) {
    return translateError(error);
  }
}
