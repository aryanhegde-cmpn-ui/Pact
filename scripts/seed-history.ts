/**
 * Generates synthetic commitment history for developing the behaviour engine.
 *
 *   npm run seed:history                        60 days, mixed patterns
 *   npm run seed:history -- --pattern chronic-postponer --days 90
 *   npm run seed:history -- --reset             purge synthetic rows first
 *
 * `--reset` removes only rows marked `synthetic: true`, and refuses to run
 * against a connection string that is not recognisably a scratch database.
 *
 * The patterns matter more than the volume: a uniform random history teaches
 * the engine nothing, because its job is recognising shapes of failure.
 */
import './load-env';

import mongoose from 'mongoose';

import { seedHistory, type PatternName } from '@/lib/commitments/seed-history';
import { assertSafeToMutate, describeUri } from '@/lib/db/guard-uri';
import { connectToDatabase } from '@/lib/db/mongoose';
import { getEnv } from '@/lib/env';

const PATTERNS: PatternName[] = ['chronic-postponer', 'late-night-misser', 'steady', 'mixed'];

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1];
  return process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
}

/**
 * Removes only rows this script created.
 *
 * Targeted at `synthetic: true` rather than dropping collections, so a run
 * against a database that also holds real history cannot take it with it. The
 * event log has no delete path anywhere in `src/` -- this lives in a script and
 * goes through the driver deliberately, because an append-only guarantee with
 * an exception inside the application is not a guarantee.
 */
async function purgeSynthetic(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Not connected.');

  let removed = 0;
  for (const name of ['commitments', 'events', 'series']) {
    const result = await db.collection(name).deleteMany({ synthetic: true });
    removed += result.deletedCount ?? 0;
    console.log(`  ${name.padEnd(14)} ${result.deletedCount ?? 0} synthetic rows removed`);
  }

  if (removed === 0) console.log('  (nothing synthetic to remove)');
}

async function main(): Promise<void> {
  const pattern = (readArg('pattern') ?? 'mixed') as PatternName;
  if (!PATTERNS.includes(pattern)) {
    throw new Error(`Unknown pattern "${pattern}". One of: ${PATTERNS.join(', ')}`);
  }

  const days = Number(readArg('days') ?? 60);
  const perDay = Number(readArg('per-day') ?? 3);
  const seed = readArg('seed') ? Number(readArg('seed')) : undefined;

  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error('--days must be a whole number between 1 and 365.');
  }

  const env = getEnv();
  const timeZone = env.APP_TIMEZONE;
  await connectToDatabase();

  if (process.argv.includes('--reset')) {
    // Checked against the connection string, not NODE_ENV.
    assertSafeToMutate(env.MONGODB_URI, 'seed:history --reset');
    console.log(`Purging synthetic rows from ${describeUri(env.MONGODB_URI)}...`);
    await purgeSynthetic();
  }

  console.log(`Seeding ${days} days of "${pattern}" history (~${perDay}/day, ${timeZone})...`);
  const summary = await seedHistory({ pattern, days, perDay, timeZone, seed });

  console.log('');
  console.log(`  commitments   ${summary.commitments}`);
  console.log(`  events        ${summary.events}`);
  console.log(`  completed     ${summary.completed}`);
  console.log(`  late          ${summary.late}`);
  console.log(`  missed        ${summary.missed}`);
  console.log(`  abandoned     ${summary.abandoned}`);
  console.log(`  postponements ${summary.postponements}`);
  console.log('');
  // The number worth looking at: it is not the completion rate.
  const rate = summary.commitments > 0 ? summary.completed / summary.commitments : 0;
  console.log(`  completion rate ${(rate * 100).toFixed(0)}%`);
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
