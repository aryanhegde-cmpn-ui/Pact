import { auth } from '@/lib/auth';
import { jsonError, jsonOk, readJson, translateError } from '@/lib/api/guard';
import { submitReckoning } from '@/lib/commitments/reckoning';
import { reckoningSubmissionSchema } from '@/lib/schemas/reckoning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Answers a missed deadline.
 *
 * Idempotent: the underlying event is unique per missed deadline, so a double
 * submission records once and reports `recorded: false` for the second.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    const { id } = await params;
    const input = reckoningSubmissionSchema.parse(await readJson(request));

    return jsonOk(await submitReckoning(id, input));
  } catch (error) {
    return translateError(error);
  }
}
