import { auth } from '@/lib/auth';
import { jsonError, jsonOk, readJson, translateError } from '@/lib/api/guard';
import { markAllRead, markRead, readInbox } from '@/lib/notifications/inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reading the inbox is what delivers anything now due -- there is no scheduler. */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    return jsonOk(await readInbox());
  } catch (error) {
    return translateError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return jsonError('Sign in required.', 401);

  try {
    const body = (await readJson(request)) as { ids?: string[]; all?: boolean };

    const updated = body.all ? await markAllRead() : await markRead(body.ids ?? []);
    return jsonOk({ read: updated });
  } catch (error) {
    return translateError(error);
  }
}
