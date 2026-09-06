/**
 * Imports the study workbook.
 *
 *   npm run curriculum:import -- --dry-run    read and report, write nothing
 *   npm run curriculum:import                 apply it
 *   npm run curriculum:import -- --file path/to/other.xlsx
 *
 * IDEMPOTENT. Re-running updates definitions and never touches progress:
 * `topicprogress` is a separate collection keyed on the same stable keys, and
 * nothing in the import path writes to it. Re-running is the normal way to
 * pick up an edit to the spreadsheet.
 *
 * Two things it will NOT overwrite, and reports instead:
 *   - a phase whose dates were moved by an explicit re-plan
 *   - a practice target corrected by hand from the review list
 *
 * Dry run first. The report tells you how many rows the parser could not read,
 * and those are rows you will be correcting by hand afterwards.
 */
import './load-env';

import mongoose from 'mongoose';

import { materialiseRange } from '@/lib/commitments/materialise';
import { deriveAnchorYear, mapWorkbook } from '@/lib/curriculum/import-map';
import { importCurriculum } from '@/lib/curriculum/import-service';
import { ensureBlockSeries } from '@/lib/curriculum/plan';
import { connectToDatabase } from '@/lib/db/mongoose';
import { UserModel } from '@/lib/db/models/user';
import { describeUri } from '@/lib/db/guard-uri';
import { getEnv } from '@/lib/env';
import { toDateKey } from '@/lib/time';

import { readWorkbook } from './xlsx';

const DEFAULT_FILE = 'data/Aryan_SDE2_Frontend_Study_Plan_Jan2027.xlsx';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1];

  return process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
}

function line(label: string, counts: { created: number; updated: number; unchanged: number }) {
  console.log(
    `  ${label.padEnd(16)} ${String(counts.created).padStart(3)} created  ` +
      `${String(counts.updated).padStart(3)} updated  ` +
      `${String(counts.unchanged).padStart(3)} unchanged`,
  );
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const file = readArg('file') ?? DEFAULT_FILE;
  const env = getEnv();

  const book = readWorkbook(file);
  const sheet = (name: string) => {
    const rows = book.get(name);
    if (!rows) {
      throw new Error(
        `${file} has no "${name}" sheet. Found: ${[...book.keys()].join(', ')}.\n` +
          'All four sheets are part of the plan; importing three of them would produce a curriculum with a hole in it.',
      );
    }

    return rows;
  };

  const dailyPlan = sheet('Daily Plan');
  const mapped = mapWorkbook(
    {
      dailyPlan,
      curriculum: sheet('Curriculum'),
      resources: sheet('Resources'),
      interviewPrep: sheet('Interview Prep'),
    },
    deriveAnchorYear(dailyPlan),
  );

  await connectToDatabase();

  // Every row is scoped to the primary, like everything else.
  const primary = await UserModel.findOne({ role: 'primary' }, { _id: 1 }).lean();
  if (!primary) throw new Error('No primary user. Run `npm run seed:user` first.');
  const ownerId = String(primary._id);

  console.log(`\n${dryRun ? 'Dry run' : 'Importing'}: ${file}`);
  console.log(`  Target: ${describeUri(env.MONGODB_URI)}`);
  console.log(`  Plan:   ${mapped.phases[0]?.startDate} to ${mapped.phases.at(-1)?.endDate}\n`);

  const report = await importCurriculum(mapped, ownerId, { dryRun });

  line('blocks', report.blocks);
  line('phases', report.phases);
  line('topics', report.topics);
  line('resources', report.resources);
  line('interview prep', report.interviewPrep);

  console.log(
    `\n  ${report.flagged} of ${mapped.topics.length} topics need their target reviewed.`,
  );
  if (report.flagged > 0) {
    console.log('  They are imported with targetKind "other" and listed at /study/review.');
    console.log('  Nothing was guessed: a wrong silent parse is worse than an obvious gap.');
  }

  if (report.keptReplannedPhases.length > 0) {
    console.log(
      `\n  Left alone: phase ${report.keptReplannedPhases.join(', ')} — moved by a re-plan.\n` +
        '  Re-importing would silently undo a decision that has a reason recorded against it.',
    );
  }

  if (report.keptCorrectedTargets.length > 0) {
    console.log(
      `\n  Left alone: ${report.keptCorrectedTargets.length} target(s) corrected by hand.`,
    );
  }

  if (report.orphaned.length > 0) {
    console.log(
      `\n  ${report.orphaned.length} topic(s) in the database are no longer in the workbook:`,
    );
    for (const key of report.orphaned.slice(0, 10)) console.log(`    ${key}`);
    if (report.orphaned.length > 10) console.log(`    ...and ${report.orphaned.length - 10} more`);
    console.log('  NOT deleted. Progress and history may point at them.');
  }

  if (!dryRun) {
    const start = mapped.phases[0]?.startDate ?? '2026-01-01';
    const series = await ensureBlockSeries(ownerId, start);
    console.log(`\n  Daily series: ${series.created} created, ${series.existing} already existed.`);

    /**
     * Warm the lookahead here rather than leaving it to the first web request.
     *
     * Materialisation is lazy and idempotent, so this is not a scheduler -- it
     * is the same call `/study` would make, run where nothing times out.
     * Creating a fortnight of three daily blocks is roughly 45 occurrences,
     * each with two events and a queue row, and against Atlas that measured 34
     * seconds. A Vercel Hobby function has ten. Doing it in the script leaves
     * the daily incremental cost, which is three occurrences.
     */
    const today = toDateKey(new Date(), env.APP_TIMEZONE);
    const from = today > start ? today : start;
    process.stdout.write('  Materialising the lookahead... ');
    const materialised = await materialiseRange(from, from, env.APP_TIMEZONE, ownerId);
    console.log(`${materialised.created} occurrences created, ${materialised.raced} raced.`);
  }

  console.log(
    dryRun
      ? '\nNothing was written. Re-run without --dry-run to apply.\n'
      : '\nDone. Progress was not touched.\n',
  );

  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
  void mongoose.disconnect();
});
