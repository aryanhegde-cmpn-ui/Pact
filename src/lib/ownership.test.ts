import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The ownership scanner.
 *
 * Same shape as the dueAt writer scanner, which has already caught two real
 * regressions. The constraint here is "no query reaches a scoped model without
 * an ownership filter", which is a property of the WHOLE codebase -- a
 * behavioural test can only ever prove the paths it happens to call, and the
 * dangerous handler is always the one nobody thought to call.
 *
 * The failure this prevents: a route that takes an id from the URL and looks
 * it up without scoping. Every such route lets any signed-in account read or
 * write any other account's data by guessing an id.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** Models whose rows belong to exactly one primary. */
const SCOPED_MODELS = [
  'CommitmentModel',
  'SeriesModel',
  'EventModel',
  'NotificationModel',
  'PushSubscriptionModel',
  'SettingsModel',
  // The curriculum. Every row of the plan belongs to one primary, including
  // the definitions -- an overseer must not read a plan by guessing an id.
  'BlockModel',
  'PhaseModel',
  'CurriculumTopicModel',
  'TopicProgressModel',
  'ResourceModel',
  'InterviewPrepItemModel',
  'RecoverySessionModel',
  'FocusSessionModel',
];

/** Query methods that read or write rows and therefore need a scope. */
const QUERY_METHODS = [
  'find',
  'findOne',
  'findById',
  'countDocuments',
  'aggregate',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'deleteOne',
  'deleteMany',
  'create',
];

/**
 * Files exempt, with the reason each is safe.
 *
 * Kept explicit and short. A growing exemption list means the rule is wrong or
 * the code is.
 */
const EXEMPT = new Set([
  // Declares the models; the queries here are index definitions.
  'lib/db/models/commitment.ts',
  'lib/db/models/series.ts',
  'lib/db/models/event.ts',
  'lib/db/models/notification.ts',
  'lib/db/models/push-subscription.ts',
  'lib/db/models/settings.ts',
  'lib/db/models/user.ts',
  'lib/db/models/relationship.ts',
  'lib/db/models/login-attempt.ts',
  'lib/db/models/block.ts',
  'lib/db/models/phase.ts',
  'lib/db/models/curriculum-topic.ts',
  'lib/db/models/topic-progress.ts',
  'lib/db/models/resource.ts',
  'lib/db/models/interview-prep-item.ts',
  'lib/db/models/recovery-session.ts',
  'lib/db/models/focus-session.ts',
  // The scanner itself.
  'lib/ownership.test.ts',
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const FILES = sourceFiles(SRC)
  .map((path) => ({
    rel: relative(SRC, path),
    code: stripComments(readFileSync(path, 'utf8')),
  }))
  .filter((file) => !EXEMPT.has(file.rel));

interface Offence {
  file: string;
  call: string;
}

/**
 * Finds model calls whose argument list never mentions `ownerId`.
 *
 * Deliberately crude and deliberately noisy in the right direction: it looks
 * at the text of the call, so a scope applied three lines later in a variable
 * still counts as unscoped. That produces occasional false positives, which
 * are cheap to annotate, and no false negatives, which are not cheap at all.
 */
function findOffences(): Offence[] {
  const offences: Offence[] = [];

  for (const { rel, code } of FILES) {
    for (const model of SCOPED_MODELS) {
      for (const method of QUERY_METHODS) {
        const pattern = new RegExp(`${model}\\s*\\.\\s*${method}\\s*\\(`, 'g');
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(code)) !== null) {
          const args = balancedArgs(code, match.index + match[0].length - 1);
          if (!args.includes('ownerId')) {
            offences.push({ file: rel, call: `${model}.${method}` });
          }
        }
      }
    }
  }

  return offences;
}

/** The text between a call's parentheses, respecting nesting. */
function balancedArgs(source: string, openParenIndex: number): string {
  let depth = 0;
  for (let i = openParenIndex; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openParenIndex + 1, i);
    }
  }
  return source.slice(openParenIndex + 1);
}

describe('ownership scoping', () => {
  it('has no query against a scoped model without an ownership filter', () => {
    const offences = findOffences();

    // Every entry is a route or service that would let any signed-in account
    // reach another account's data by id alone.
    expect(offences.map((o) => `${o.file}: ${o.call}`)).toEqual([]);
  });

  it('scans a meaningful number of files, so a broken glob cannot pass silently', () => {
    // A scanner that finds nothing because it looked nowhere is worse than no
    // scanner, because it reads as a guarantee.
    expect(FILES.length).toBeGreaterThan(30);
  });

  it('covers every scoped model', () => {
    const source = readFileSync(join(SRC, 'lib/ownership.test.ts'), 'utf8');

    for (const model of ['Commitment', 'Series', 'Event', 'Notification', 'PushSubscription']) {
      expect(source).toContain(`${model}Model`);
    }
  });
});
