import mongoose from 'mongoose';

import { connectToDatabase } from '@/lib/db/mongoose';
import { buildInfo, env } from '@/lib/env';
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

export async function GET(): Promise<Response> {
  const now = new Date();
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
        timezone: env.APP_TIMEZONE,
        local: formatWallClock(now, env.APP_TIMEZONE),
        utcOffset: utcOffset(now, env.APP_TIMEZONE),
      },
    },
    {
      // 503 so uptime checks and `vercel deploy` smoke tests fail loudly.
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  );
}
