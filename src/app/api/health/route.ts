import mongoose from 'mongoose';

import { connectToDatabase } from '@/lib/db/mongoose';
import { buildInfo, EnvironmentError, getEnv } from '@/lib/env';
import { formatWallClock, utcOffset } from '@/lib/time';

/**
 * Deploy verification endpoint. Deliberately unauthenticated: it reports
 * liveness only, never user data.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DatabaseHealth {
  status: 'connected' | 'error';
  readyState: number;
  latencyMs: number;
  message?: string;
}

async function checkDatabase(): Promise<DatabaseHealth> {
  const startedAt = Date.now();

  try {
    const connection = await connectToDatabase();
    // `connect` resolving only means a server was selected. Ping proves the
    // credentials and the database itself actually work.
    await connection.connection.db?.admin().command({ ping: 1 });

    return {
      status: 'connected',
      readyState: connection.connection.readyState,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: 'error',
      readyState: mongoose.connection.readyState,
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export async function GET(): Promise<Response> {
  const now = new Date();

  // Reported rather than thrown: a misconfigured deploy is precisely what this
  // endpoint exists to surface, and a 500 stack trace says far less than the
  // list of variables that are wrong. Names and reasons only -- never values.
  let timezone: string;
  try {
    timezone = getEnv().APP_TIMEZONE;
  } catch (error) {
    if (!(error instanceof EnvironmentError)) throw error;

    return Response.json(
      {
        status: 'misconfigured',
        environment: buildInfo.environment,
        commit: buildInfo.commitSha,
        time: { utc: now.toISOString() },
        error: error.message,
      },
      { status: 503, headers: NO_STORE },
    );
  }

  const database = await checkDatabase();
  const healthy = database.status === 'connected';

  return Response.json(
    {
      status: healthy ? 'ok' : 'degraded',
      database,
      environment: buildInfo.environment,
      commit: buildInfo.commitSha,
      time: {
        utc: now.toISOString(),
        timezone,
        local: formatWallClock(now, timezone),
        utcOffset: utcOffset(now, timezone),
      },
    },
    {
      // 503 so uptime checks and `vercel deploy` smoke tests fail loudly.
      status: healthy ? 200 : 503,
      headers: NO_STORE,
    },
  );
}
