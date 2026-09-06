import { jsonOk, translateError } from '@/lib/api/guard';
import { UserModel } from '@/lib/db/models/user';
import { connectToDatabase } from '@/lib/db/mongoose';
import { bearerToken, dispatchDue, secretMatches } from '@/lib/notifications/dispatch';
import { getEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The push delivery tick.
 *
 * Called every minute by the Cloudflare Worker in infra/tick, and daily by the
 * Vercel cron as a backstop. Authorised by a bearer CRON_SECRET rather than a
 * session, because no user is present.
 *
 * A QUEUE SCAN, not a moment-in-time trigger: it asks what is due and pending,
 * so a missed tick self-heals on the next one and running late is harmless.
 * Never make delivery depend on the tick arriving.
 */
async function handle(request: Request): Promise<Response> {
  const env = getEnv();

  // Constant-time. A plain === leaks how many leading bytes matched through
  // response timing, which is enough to recover the secret byte by byte.
  if (!secretMatches(bearerToken(request.headers.get('authorization')), env.CRON_SECRET)) {
    // Deliberately terse and identical for a missing and a wrong token.
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await connectToDatabase();

    // Single-user app: the owner is the only recipient. Resolved here rather
    // than assumed so a second user later is a query change, not a rewrite.
    const owner = await UserModel.findOne({}, { _id: 1 }).lean();
    if (!owner) {
      return jsonOk({ ok: true, note: 'No user yet; nothing to dispatch.', scanned: 0 });
    }

    const report = await dispatchDue(String(owner._id));

    // The summary is the debugging surface. Counts, not prose.
    return jsonOk({ ok: true, ...report });
  } catch (error) {
    return translateError(error);
  }
}

/** The per-minute Cloudflare tick. */
export const POST = handle;

/**
 * The Vercel daily backstop.
 *
 * Vercel Cron invokes with GET and an `Authorization: Bearer $CRON_SECRET`
 * header, so the same handler serves both. Without this the backstop would
 * 405, and the only symptom would be push stopping entirely during a
 * Cloudflare outage -- which is exactly the case the backstop exists for.
 *
 * Safe because dispatch is a queue scan: running it daily rather than every
 * minute delivers late instead of not at all.
 */
export const GET = handle;
