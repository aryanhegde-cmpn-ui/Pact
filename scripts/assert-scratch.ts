/**
 * Refuses to let a test run touch anything but a scratch database.
 *
 *   npm run e2e:assert-scratch
 *
 * ---------------------------------------------------------------------------
 * THE SUITE WRITES. THAT IS WHAT MAKES IT WORTH RUNNING AND WHAT MAKES IT
 * DANGEROUS.
 * ---------------------------------------------------------------------------
 * It creates commitments, abandons them, revokes overseers, resets passwords
 * and ends sessions. Every one of those is correct against a fixture and
 * unforgivable against the real record.
 *
 * The connection string decides, never NODE_ENV: a local run against a
 * production URI has a development NODE_ENV and would have passed that check.
 * Same guard the destructive scripts use, and it fails closed -- anything not
 * recognisably local or suffixed -dev/-test/-local is treated as production.
 * ---------------------------------------------------------------------------
 */
import './load-env';

import { assertSafeToMutate, describeUri } from '@/lib/db/guard-uri';

function main(): void {
  const uri = process.env.MONGODB_URI ?? '';

  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. The suite has no target, which is not the same\n' +
        'as having a safe one -- point it at a scratch database explicitly.',
    );
  }

  assertSafeToMutate(uri, 'the end-to-end suite');

  console.log('');
  console.log('  end-to-end suite');
  console.log(`  Target:      ${describeUri(uri)}`);
  console.log('  Treated as:  SCRATCH (safe to mutate)');
  console.log('');
}

main();
