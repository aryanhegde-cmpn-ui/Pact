/**
 * Closes the overdue backlog a test run leaves behind.
 *
 *   npm run fixture:tidy
 *
 * ---------------------------------------------------------------------------
 * THE SUITE POISONS ITS OWN FIXTURE.
 * ---------------------------------------------------------------------------
 * Specs create commitments due later today, complete some of them, and leave
 * the rest. Every run adds a few, none of them expire politely, and after
 * enough runs the primary crosses the recovery threshold -- at which point
 * `/dashboard` is REPLACED by the recovery screen and roughly a dozen specs
 * fail at once, all of them reporting that some element is missing rather than
 * that the account is buried.
 *
 * `e2e/environment.spec.ts` is the canary for exactly this and says so
 * plainly. This is the thing it was telling us to run.
 *
 * Scratch databases only, and not by NODE_ENV: a local run against a
 * production URI has a development NODE_ENV and would have passed that check.
 * ---------------------------------------------------------------------------
 */
import './load-env';

import mongoose from 'mongoose';

import { assertSafeToMutate } from '@/lib/db/guard-uri';
import { CommitmentModel } from '@/lib/db/models/commitment';
import { RecoverySessionModel } from '@/lib/db/models/recovery-session';
import { connectToDatabase } from '@/lib/db/mongoose';

import { announceTarget } from './target';

async function main(): Promise<void> {
  announceTarget('fixture:tidy');
  assertSafeToMutate(process.env.MONGODB_URI ?? '', 'fixture:tidy');

  await connectToDatabase();

  const now = new Date();

  /**
   * Abandoned rather than completed.
   *
   * Completing them would write a kept day into the adherence record and
   * flatter every number the suite then asserts against. Abandoning is the
   * honest description of what happened to a commitment nobody ever intended
   * to do.
   */
  const closed = await CommitmentModel.updateMany(
    { dueAt: { $lt: now }, status: { $nin: ['done', 'abandoned'] } },
    { $set: { status: 'abandoned', abandonedAt: now, abandonReason: 'fixture tidy' } },
  );

  /**
   * AND THE ONES DUE LATER TODAY, WHICH IS THE LEAK THAT ACTUALLY HURT.
   * -------------------------------------------------------------------------
   * Specs create commitments due later today so they appear on Today. Nothing
   * closes them: they are not overdue, so the sweep above never sees them, and
   * they sit in `alsoToday` for every subsequent run.
   *
   * Three hundred and sixty-four of them had accumulated. `/api/today` was
   * taking SIX SECONDS and returning 266KB, and the specs that poll for a
   * re-read inside fifteen seconds started losing the race -- which reads as
   * "the staleness banner is broken" rather than "the fixture is enormous".
   *
   * Matched by title prefix rather than by age, so a commitment somebody
   * created by hand while looking at the scratch database survives.
   */
  const FIXTURE_TITLES = [
    'Walkthrough',
    'Contract fixture',
    'Reduced motion fixture',
    'Exit fixture',
    'Focus fixture',
    'Dispatch fixture',
    'Interrupted ',
    'Research ',
    'Probe ',
    'Missed ',
    'First half of the walkthrough miss',
    'Second half of the walkthrough miss',
    'Should be refused',
  ];

  /**
   * DELETED, not abandoned.
   *
   * `alsoToday` returns everything due today whatever its status -- the Today
   * component splits open from done -- so closing a leftover does not shrink
   * the payload by a byte. Abandoning 258 of them left `/api/today` at 4.8
   * seconds and 267KB.
   *
   * These are spec fixtures in a scratch database, not history: nothing is
   * lost by removing them, and the guard above has already refused to run
   * anywhere the distinction would matter.
   */
  const leftovers = await CommitmentModel.deleteMany({
    $or: FIXTURE_TITLES.map((prefix) => ({ title: { $regex: `^${prefix}` } })),
  });

  // Recovery mode is derived from the counts, so closing the backlog is what
  // ends it -- but the EPISODE is a document, and an open one would keep
  // showing in the history.
  const episodes = await RecoverySessionModel.updateMany(
    { endedAt: null },
    { $set: { endedAt: now } },
  );

  console.log(`  closed ${closed.modifiedCount} overdue commitment(s)`);
  console.log(`  deleted ${leftovers.deletedCount} leftover spec fixture(s)`);
  console.log(`  ended ${episodes.modifiedCount} recovery episode(s)`);
  console.log('');

  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
  void mongoose.disconnect();
});
