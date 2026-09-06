/**
 * Brings the database's indexes into line with the models.
 *
 *   npm run db:indexes
 *
 * Mongoose creates missing indexes on its own but never DROPS one that has
 * been redefined, so a changed key leaves the old index in place and still
 * enforcing its old constraint. `syncIndexes()` removes what the models no
 * longer declare.
 *
 * Run after any index change. It is safe to run repeatedly.
 */
import './load-env';

import mongoose from 'mongoose';

import { CommitmentModel } from '@/lib/db/models/commitment';
import { EventModel } from '@/lib/db/models/event';
import { NotificationModel } from '@/lib/db/models/notification';
import { SeriesModel } from '@/lib/db/models/series';
import { SettingsModel } from '@/lib/db/models/settings';
import { UserModel } from '@/lib/db/models/user';
import { connectToDatabase } from '@/lib/db/mongoose';
import { describeUri } from '@/lib/db/guard-uri';
import { getEnv } from '@/lib/env';

const MODELS = [
  ['commitments', CommitmentModel],
  ['events', EventModel],
  ['notifications', NotificationModel],
  ['series', SeriesModel],
  ['settings', SettingsModel],
  ['users', UserModel],
] as const;

async function main(): Promise<void> {
  const env = getEnv();
  await connectToDatabase();

  console.log(`Syncing indexes on ${describeUri(env.MONGODB_URI)}\n`);

  for (const [name, model] of MODELS) {
    // Returns the names of indexes it dropped.
    const dropped = await model.syncIndexes();
    const current = await model.listIndexes();

    console.log(`  ${name}`);
    if (dropped.length > 0) console.log(`    dropped: ${dropped.join(', ')}`);
    for (const index of current) {
      const flags = [
        index.unique ? 'UNIQUE' : '',
        index.sparse ? 'sparse' : '',
        index.partialFilterExpression
          ? `partial=${JSON.stringify(index.partialFilterExpression)}`
          : '',
      ]
        .filter(Boolean)
        .join(' ');
      console.log(`    ${index.name}${flags ? '  ' + flags : ''}`);
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
