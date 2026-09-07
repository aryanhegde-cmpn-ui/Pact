/**
 * Migration: replace the DEADLINE_MISSED uniqueness index.
 *
 *   npm run db:migrate:miss-index
 *
 * Idempotent, and a no-op once converged. Exits NON-ZERO if it does not
 * converge -- see src/lib/db/migrations/miss-index.ts for why the ordering
 * matters.
 */
import './load-env';

import mongoose from 'mongoose';

import { migrateMissIndex } from '@/lib/db/migrations/miss-index';
import { connectToDatabase } from '@/lib/db/mongoose';

import { announceTarget } from './target';

const COLLECTION = 'events';

async function main(): Promise<void> {
  announceTarget('db:migrate:miss-index');

  await connectToDatabase();

  const db = mongoose.connection.db;
  if (!db) throw new Error('Not connected.');

  const exists = await db.listCollections({ name: COLLECTION }).toArray();
  if (exists.length === 0) {
    console.log(`Collection "${COLLECTION}" does not exist yet. Nothing to migrate.`);
    return;
  }

  const collection = db.collection(COLLECTION);

  console.log('Before:');
  for (const index of await collection.indexes()) {
    console.log(`  ${index.name}${index.unique ? '  UNIQUE' : ''}`);
  }

  const result = await migrateMissIndex(collection);

  console.log('');
  for (const name of result.created) console.log(`  created  ${name}`);
  for (const name of result.dropped) console.log(`  dropped  ${name}`);
  if (result.alreadyMigrated) console.log('  already migrated, nothing to do');

  if (!result.ok) {
    console.error(`\n${result.error}\n`);
    process.exitCode = 1;
    return;
  }

  console.log('\nAfter:');
  for (const index of await collection.indexes()) {
    const flags = [
      index.unique ? 'UNIQUE' : '',
      index.partialFilterExpression
        ? `partial=${JSON.stringify(index.partialFilterExpression)}`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    console.log(`  ${index.name}${flags ? '  ' + flags : ''}`);
  }

  console.log('\nConverged. Repeated misses against a moving deadline now record.');
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
