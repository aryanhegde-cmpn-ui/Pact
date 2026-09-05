import { auth } from '@/lib/auth';
import { UserModel } from '@/lib/db/models/user';
import { connectToDatabase } from '@/lib/db/mongoose';
import { buildInfo, EnvironmentError, getEnv } from '@/lib/env';
import { formatWallClock, utcOffset } from '@/lib/time';

/**
 * Authenticated counterpart to /api/health.
 *
 * Reports session validity, session expiry and how many users exist. It never
 * returns a password hash, and it never returns anything about a user other
 * than the caller.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export async function GET(): Promise<Response> {
  const now = new Date();
  const session = await auth();

  // 401 before anything else touches the database: an unauthenticated caller
  // must not be able to make this endpoint do work.
  if (!session?.user) {
    return Response.json(
      { status: 'unauthenticated', session: { valid: false } },
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

  let userCount: number | null = null;
  let databaseError: string | null = null;
  try {
    await connectToDatabase();
    userCount = await UserModel.countDocuments();
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
