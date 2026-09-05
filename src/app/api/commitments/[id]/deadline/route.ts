import { auth } from '@/lib/auth';
import { jsonError, jsonOk, readJson, translateError } from '@/lib/api/guard';
import { changeDeadline } from '@/lib/commitments/deadline';
import { getCommitment } from '@/lib/commitments/service';
import { changeDeadlineSchema } from '@/lib/schemas/commitment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The ONLY route that can move a deadline, and it requires a reason.
 *
 * Separate from PATCH deliberately: making it its own endpoint is what stops a
 * reschedule from riding along inside a routine edit.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    const { id } = await params;
    const input = changeDeadlineSchema.parse(await readJson(request));

    await changeDeadline(id, input);
    return jsonOk(await getCommitment(id));
  } catch (error) {
    return translateError(error);
  }
}
