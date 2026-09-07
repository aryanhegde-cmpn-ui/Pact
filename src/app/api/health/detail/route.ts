import type { Session } from 'next-auth';

import { auth } from '@/lib/auth';
import { NotificationModel } from '@/lib/db/models/notification';
import { PushSubscriptionModel } from '@/lib/db/models/push-subscription';
import { UserModel } from '@/lib/db/models/user';
import { isPushConfigured } from '@/lib/notifications/push';
import { getSettings } from '@/lib/notifications/settings';
import { DISPATCH_STALE_MINUTES } from '@/lib/schemas/push';
import { connectToDatabase } from '@/lib/db/mongoose';
import { buildInfo, checkEnv, EnvironmentError, getEnv } from '@/lib/env';
import { formatWallClock, utcOffset } from '@/lib/time';

/**
 * Authenticated counterpart to /api/health.
 *
 * Reports session validity, session expiry, how many users exist, the state of
 * the notification tick, and which environment variables are set. It never
 * returns a password hash, a variable's VALUE, or anything about a user other
 * than the caller.
 *
 * ---------------------------------------------------------------------------
 * THE CONFIGURATION REPORT COMES BEFORE THE SESSION CHECK.
 * ---------------------------------------------------------------------------
 * This is the endpoint an operator hits to find out why they cannot sign in,
 * and requiring a session to read it makes it useless in exactly that case: a
 * missing AUTH_SECRET means Auth.js throws before any session exists, so the
 * diagnostic would 500 for the same reason the sign-in did.
 *
 * So a misconfigured deployment answers with the variable names and nothing
 * else, unauthenticated. That discloses no more than `/api/health` already
 * does -- it names the same variables in its error -- and every name is in
 * `.env.production.example` in the repository.
 * ---------------------------------------------------------------------------
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export async function GET(): Promise<Response> {
  const now = new Date();

  /**
   * Names and booleans. Never a value, not even a redacted one -- a length or
   * a first character is still information about a secret, and this response
   * is the thing an operator pastes into an issue.
   */
  const variables = checkEnv().map(({ name, required, present, group }) => ({
    name,
    required,
    present,
    group,
  }));
  const missing = variables.filter((entry) => entry.required && !entry.present).map((e) => e.name);
  // Named `configuration` rather than `environment`: this response already
  // carries `environment` for the deployment target, and two meanings of the
  // word in one payload is how a consumer reads the wrong one.
  const configuration = { variables, missing, ok: missing.length === 0 };

  if (missing.length > 0) {
    return Response.json(
      {
        status: 'misconfigured',
        configuration,
        hint: 'Set these in Vercel > Settings > Environment Variables, then redeploy.',
        commit: buildInfo.commitSha,
        time: { utc: now.toISOString() },
      },
      { status: 503, headers: NO_STORE },
    );
  }

  /**
   * Guarded, because Auth.js reads AUTH_SECRET from `process.env` directly and
   * throws `MissingSecret` rather than returning null. That throw is what made
   * `/api/auth/providers` return a bare 500; this endpoint has to survive it
   * to be able to report it.
   */
  let session: Session | null = null;
  try {
    session = await auth();
  } catch (error) {
    return Response.json(
      {
        status: 'misconfigured',
        configuration,
        auth: {
          ok: false,
          error: error instanceof Error ? error.name : 'unknown',
          message: error instanceof Error ? error.message : String(error),
        },
        commit: buildInfo.commitSha,
        time: { utc: now.toISOString() },
      },
      { status: 503, headers: NO_STORE },
    );
  }

  // 401 before anything else touches the database: an unauthenticated caller
  // must not be able to make this endpoint do work.
  if (!session?.user) {
    return Response.json(
      { status: 'unauthenticated', session: { valid: false }, configuration },
      { status: 401, headers: NO_STORE },
    );
  }

  let timezone: string;
  try {
    timezone = getEnv().APP_TIMEZONE;
  } catch (error) {
    if (!(error instanceof EnvironmentError)) throw error;
    return Response.json(
      { status: 'misconfigured', error: error.message },
      { status: 503, headers: NO_STORE },
    );
  }

  // Health detail reports on the caller's own scope, never the whole cluster.
  const ownerId = session.user.ownerId ?? session.user.id;
  let userCount: number | null = null;
  let databaseError: string | null = null;
  let dispatch: {
    lastDispatchAt: string | null;
    minutesSince: number | null;
    stale: boolean;
    pushConfigured: boolean;
    subscriptions: number;
    pendingPush: number;
  } | null = null;

  try {
    await connectToDatabase();
    userCount = await UserModel.countDocuments();

    const settings = await getSettings(ownerId);
    const minutesSince = settings.lastDispatchAt
      ? Math.floor((now.getTime() - settings.lastDispatchAt.getTime()) / 60_000)
      : null;

    dispatch = {
      lastDispatchAt: settings.lastDispatchAt?.toISOString() ?? null,
      minutesSince,
      // The external tick fails silently -- Cloudflare cron does not retry and
      // raises no alert -- so this is the only place a stopped scheduler is
      // visible without noticing that notifications stopped arriving.
      stale: minutesSince !== null && minutesSince > DISPATCH_STALE_MINUTES,
      pushConfigured: isPushConfigured(),
      subscriptions: await PushSubscriptionModel.countDocuments({ ownerId }),
      pendingPush: await NotificationModel.countDocuments({
        ownerId,
        channel: 'web-push',
        status: 'pending',
        scheduledFor: { $lte: now },
      }),
    };
  } catch (error) {
    databaseError = error instanceof Error ? error.message : String(error);
  }

  // Auth.js puts session expiry on the session object as an ISO string.
  const expiresAt = session.expires ? new Date(session.expires) : null;

  return Response.json(
    {
      status: databaseError ? 'degraded' : 'ok',
      session: {
        valid: true,
        // Identity of the caller only, and never the hash.
        user: {
          id: session.user.id,
          displayName: session.user.name ?? null,
          role: session.user.role,
        },
        expiresAt: expiresAt?.toISOString() ?? null,
        expiresIn: expiresAt ? formatDuration(expiresAt.getTime() - now.getTime()) : null,
      },
      users: { count: userCount },
      dispatch,
      configuration,
      database: databaseError ? { status: 'error', message: databaseError } : { status: 'ok' },
      environment: buildInfo.environment,
      commit: buildInfo.commitSha,
      time: {
        utc: now.toISOString(),
        timezone,
        local: formatWallClock(now, timezone),
        utcOffset: utcOffset(now, timezone),
      },
    },
    { status: databaseError ? 503 : 200, headers: NO_STORE },
  );
}

/** Human-readable remaining lifetime, so a 90-day session is legible at a glance. */
function formatDuration(ms: number): string {
  if (ms <= 0) return 'expired';

  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
