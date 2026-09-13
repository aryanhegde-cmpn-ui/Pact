import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { API_REGISTRY } from '../../e2e/coverage/api-registry';
import { covered, notApplicable } from '../../e2e/coverage/cases';
import { PAGE_REGISTRY } from '../../e2e/coverage/page-registry';
import {
  apiRoutesIn,
  auditCoverage,
  collectTests,
  pageRoutesIn,
  type AuditInput,
} from '../../e2e/coverage/scan';

/**
 * The coverage gate.
 *
 * ---------------------------------------------------------------------------
 * TWO RULES, BOTH LEARNED HERE.
 * ---------------------------------------------------------------------------
 * 1. COVERAGE IS REGISTERED, NOT INFERRED. A route loaded while something else
 *    is under test is not covered. Every spec in this suite signs in through
 *    the landing page, and it still shipped with a 600px form on a 390px
 *    screen. "Touched" and "asserted against" are different things, and only
 *    one of them is coverage.
 *
 * 2. A REGISTERED TEST THAT SKIPS COUNTS AS ABSENT. `environment.spec.ts`
 *    already goes red when a conditional skip is about to fire, because a
 *    suite that quietly stops asserting reports success for work it did not
 *    do. Registration gets the same treatment.
 *
 * The gate is watched failing in `route-coverage-gate.test.ts`, against a
 * planted route and a skipped registration. A gate nobody has seen fail is a
 * gate nobody knows the shape of.
 * ---------------------------------------------------------------------------
 */
const ROOT = join(import.meta.dirname, '../..');
const APP = join(ROOT, 'src/app');

export function realInput(): AuditInput {
  return {
    apiRoutes: apiRoutesIn(APP),
    pageRoutes: pageRoutesIn(APP),
    apiRegistry: API_REGISTRY,
    pageRegistry: PAGE_REGISTRY,
    tests: collectTests([join(ROOT, 'e2e'), join(ROOT, 'src')], ROOT),
    contractSource: readFileSync(join(ROOT, 'e2e/api-contract.spec.ts'), 'utf8'),
  };
}

describe('the gate scans something real', () => {
  it('finds the routes at all', () => {
    // Guards the scan: a rename that emptied these lists would make every
    // assertion below vacuously true.
    expect(apiRoutesIn(APP).length).toBeGreaterThan(30);
    expect(pageRoutesIn(APP).length).toBeGreaterThan(10);
  });

  it('finds the tests at all', () => {
    expect(collectTests([join(ROOT, 'e2e')], ROOT).length).toBeGreaterThan(40);
  });
});

describe('every route and API is covered', () => {
  const problems = auditCoverage(realInput());

  it('registers every route that exists', () => {
    const unregistered = problems.filter((problem) => problem.kind === 'unregistered');

    expect(
      unregistered.map((p) => p.detail),
      'unregistered routes',
    ).toEqual([]);
  });

  it('registers nothing that no longer exists', () => {
    // A registration for a deleted route hides the next unregistered one.
    expect(problems.filter((p) => p.kind === 'stale').map((p) => p.detail)).toEqual([]);
  });

  it('names a test that actually exists, for every declared case', () => {
    expect(problems.filter((p) => p.kind === 'missing-test').map((p) => p.detail)).toEqual([]);
  });

  it('counts a skipped test as absent', () => {
    expect(problems.filter((p) => p.kind === 'skipped-test').map((p) => p.detail)).toEqual([]);
  });

  it('gives a real reason wherever a case cannot exist', () => {
    expect(problems.filter((p) => p.kind === 'vague-exemption').map((p) => p.detail)).toEqual([]);
  });
});

describe('the four cases are declared for every API route', () => {
  it('leaves none of them unanswered', () => {
    /**
     * Four different code paths: the handler, the guard's session check, the
     * guard's capability check, and the schema. A route with a green success
     * test and nothing else is a route whose AUTHORISATION has never run under
     * test, which is the part where a mistake stays invisible until somebody
     * exploits it.
     */
    const incomplete = API_REGISTRY.filter(
      (entry) => !entry.success || !entry.unauthenticated || !entry.forbidden || !entry.validation,
    ).map((entry) => entry.route);

    expect(incomplete).toEqual([]);
  });

  it('uses the shared builders so the registry and the sweep cannot drift', () => {
    // Titles are constructed by the same functions the sweep calls, which is
    // what makes "registered" and "emitted" the same string by construction.
    const cases = covered('x');
    const exempt = notApplicable('a reason long enough to be a reason');

    expect('covered' in cases).toBe(true);
    expect('notApplicable' in exempt).toBe(true);
  });
});
