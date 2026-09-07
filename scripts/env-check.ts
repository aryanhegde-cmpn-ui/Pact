/**
 * Which required variables are set here, and which are not.
 *
 *   npm run env:check
 *
 * Names only, never values. This output is meant to be pasted into an issue or
 * read over a call, and a tool that reports configuration by printing it leaks
 * the database password the first time anybody uses it.
 *
 * Reads the same Zod schema the app enforces, so it cannot disagree with what
 * a deploy will actually accept.
 */
import './load-env';

import { checkEnv } from '@/lib/env';

function main(): void {
  const entries = checkEnv(process.env);
  const groups = [...new Set(entries.map((entry) => entry.group))];

  console.log('');
  console.log('  Environment');
  console.log('');

  for (const group of groups) {
    console.log(`  ${group}`);
    for (const entry of entries.filter((row) => row.group === group)) {
      const mark = entry.present ? 'set    ' : entry.required ? 'MISSING' : 'unset  ';
      const note = [entry.required ? 'required' : 'optional', entry.secret ? 'secret' : null]
        .filter(Boolean)
        .join(', ');

      console.log(`    ${mark}  ${entry.name.padEnd(30)} (${note})`);
    }
    console.log('');
  }

  const missing = entries.filter((entry) => entry.required && !entry.present);

  if (missing.length === 0) {
    console.log('  Every required variable is set.\n');
    return;
  }

  console.log(`  ${missing.length} required variable${missing.length === 1 ? '' : 's'} missing:`);
  for (const entry of missing) console.log(`    ${entry.name}`);
  console.log('');
  console.log('  Local:  add them to .env.local');
  console.log('  Vercel: Settings > Environment Variables, per environment, then redeploy.');
  console.log('          `vercel env ls` shows what is currently set.');
  console.log('');

  process.exitCode = 1;
}

main();
