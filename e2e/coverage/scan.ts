import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  anonymousTitle,
  forbiddenTitle,
  isCovered,
  successTitle,
  validationTitle,
  type ApiRegistration,
  type PageRegistration,
} from './cases';

/**
 * The gate's machinery, as functions rather than assertions.
 *
 * Extracted so the gate can be pointed at a PLANTED route and a SKIPPED
 * registration and shown to fail. A gate nobody has watched fail is a gate
 * nobody knows the shape of -- and this one exists precisely because a green
 * suite once meant nothing.
 */
export interface KnownTest {
  title: string;
  file: string;
  skipped: boolean;
}

export function walk(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, match));
    else if (match(entry)) out.push(full);
  }

  return out;
}

/** `/api/commitments/[id]/complete`, from the file path. */
export function apiRoutesIn(appDir: string): string[] {
  const base = join(appDir, 'api');

  return walk(base, (name) => name === 'route.ts')
    .map((file) => `/api/${relative(base, file).replace(/\/route\.ts$/, '')}`)
    .sort();
}

/** `/dashboard`, with route groups stripped -- `(shell)` is not in the URL. */
export function pageRoutesIn(appDir: string): string[] {
  return walk(appDir, (name) => name === 'page.tsx')
    .map((file) => {
      const path = relative(appDir, file).replace(/\/?page\.tsx$/, '');

      return `/${path
        .split('/')
        .filter((segment) => !/^\(.*\)$/.test(segment))
        .join('/')}`;
    })
    .sort();
}

/** Every test title in the given directories, with whether it is skipped. */
export function collectTests(dirs: string[], root: string): KnownTest[] {
  const out: KnownTest[] = [];

  for (const dir of dirs) {
    for (const file of walk(dir, (name) => /\.(spec|test)\.tsx?$/.test(name))) {
      const code = readFileSync(file, 'utf8');
      const wholeFileSkipped = /\bdescribe\.(skip|fixme)\(/.test(code);

      for (const match of code.matchAll(
        /\b(?:test|it)(\.skip|\.fixme|\.only)?\(\s*(?:async\s*)?'([^']+)'/g,
      )) {
        out.push({
          title: match[2]!,
          file: relative(root, file),
          skipped: wholeFileSkipped || match[1] === '.skip' || match[1] === '.fixme',
        });
      }
    }
  }

  return out;
}

const BUILDERS: Record<string, (route: string) => string> = {
  anonymousTitle,
  forbiddenTitle,
  validationTitle,
  successTitle,
};

export interface AuditInput {
  apiRoutes: string[];
  pageRoutes: string[];
  apiRegistry: readonly ApiRegistration[];
  pageRegistry: readonly PageRegistration[];
  tests: KnownTest[];
  /** Source of the generated sweep, so its emitted titles count as real. */
  contractSource: string;
}

export interface Problem {
  kind: 'unregistered' | 'stale' | 'missing-test' | 'skipped-test' | 'vague-exemption';
  detail: string;
}

/** Whether the sweep really emits this title for this route. */
function generatedBy(title: string, route: string, contractSource: string): boolean {
  for (const [name, build] of Object.entries(BUILDERS)) {
    if (build(route) !== title) continue;
    // The builder has to be CALLED to make a test, not merely imported.
    if (!new RegExp(`test\\(\\s*${name}\\(`).test(contractSource)) return false;

    return true;
  }

  return false;
}

export function auditCoverage(input: AuditInput): Problem[] {
  const problems: Problem[] = [];
  const find = (title: string): KnownTest | undefined =>
    input.tests.find((test) => test.title === title);

  const contractSkipped = /\bdescribe\.(skip|fixme)\(/.test(input.contractSource);

  const registeredApi = new Set(input.apiRegistry.map((entry) => entry.route));
  for (const route of input.apiRoutes) {
    if (!registeredApi.has(route)) problems.push({ kind: 'unregistered', detail: route });
  }

  const registeredPages = new Set(input.pageRegistry.map((entry) => entry.route));
  for (const route of input.pageRoutes) {
    if (!registeredPages.has(route)) problems.push({ kind: 'unregistered', detail: route });
  }

  const apiSet = new Set(input.apiRoutes);
  for (const entry of input.apiRegistry) {
    if (!apiSet.has(entry.route)) problems.push({ kind: 'stale', detail: entry.route });
  }
  const pageSet = new Set(input.pageRoutes);
  for (const entry of input.pageRegistry) {
    if (!pageSet.has(entry.route)) problems.push({ kind: 'stale', detail: entry.route });
  }

  for (const entry of input.apiRegistry) {
    for (const [label, coverage] of [
      ['success', entry.success],
      ['unauthenticated', entry.unauthenticated],
      ['forbidden', entry.forbidden],
      ['validation', entry.validation],
    ] as const) {
      if (!isCovered(coverage)) {
        // A one-word reason is an omission wearing a decision's clothes.
        if (coverage.notApplicable.trim().length < 10) {
          problems.push({ kind: 'vague-exemption', detail: `${entry.route} ${label}` });
        }
        continue;
      }

      const test = find(coverage.covered);
      const generated = generatedBy(coverage.covered, entry.route, input.contractSource);

      if (!test && !generated) {
        problems.push({ kind: 'missing-test', detail: `${entry.route} ${label}: ${coverage.covered}` });
        continue;
      }

      /**
       * A REGISTERED TEST THAT SKIPS COUNTS AS ABSENT. A suite that quietly
       * stops asserting is worse than one that fails: it reports success for
       * work it did not do.
       */
      if (test?.skipped || (!test && generated && contractSkipped)) {
        problems.push({ kind: 'skipped-test', detail: `${entry.route} ${label}: ${coverage.covered}` });
      }
    }
  }

  for (const entry of input.pageRegistry) {
    if (!isCovered(entry.rendered)) {
      problems.push({ kind: 'vague-exemption', detail: `${entry.route}: a page cannot be n/a` });
      continue;
    }

    const test = find(entry.rendered.covered);
    if (!test) {
      problems.push({ kind: 'missing-test', detail: `${entry.route}: ${entry.rendered.covered}` });
    } else if (test.skipped) {
      problems.push({ kind: 'skipped-test', detail: `${entry.route}: ${entry.rendered.covered}` });
    }
  }

  return problems;
}
