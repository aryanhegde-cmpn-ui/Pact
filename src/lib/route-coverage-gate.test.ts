import { describe, expect, it } from 'vitest';

import { covered, type ApiRegistration, type PageRegistration } from '../../e2e/coverage/cases';
import { auditCoverage, type AuditInput, type KnownTest } from '../../e2e/coverage/scan';

/**
 * The gate, watched failing.
 *
 * ---------------------------------------------------------------------------
 * A GATE NOBODY HAS SEEN FAIL IS A GATE NOBODY KNOWS THE SHAPE OF.
 * ---------------------------------------------------------------------------
 * `route-coverage.test.ts` asserts the real codebase passes. That is exactly
 * the assertion that also passes when the scanner is broken, matches nothing,
 * or quietly returns an empty list -- which is the failure mode every scanner
 * in this repository has had to be defended against.
 *
 * So: plant an unregistered route, plant a registration pointing at a skipped
 * test, and require the gate to catch both.
 * ---------------------------------------------------------------------------
 */
const CONTRACT = 'test(anonymousTitle(entry.route), async () => {});';

function input(overrides: Partial<AuditInput> = {}): AuditInput {
  const api: ApiRegistration[] = [
    {
      route: '/api/thing',
      methods: ['GET'],
      capability: 'commitment:read',
      success: covered('the thing answers'),
      unauthenticated: covered('the thing refuses an anonymous caller'),
      forbidden: covered('the thing refuses the wrong role'),
      validation: { notApplicable: 'takes no request body, so there is nothing to reject' },
    },
  ];
  const pages: PageRegistration[] = [
    { route: '/thing', rendered: covered('the thing page renders'), public: false },
  ];
  const tests: KnownTest[] = [
    { title: 'the thing answers', file: 'e2e/a.spec.ts', skipped: false },
    { title: 'the thing refuses an anonymous caller', file: 'e2e/a.spec.ts', skipped: false },
    { title: 'the thing refuses the wrong role', file: 'e2e/a.spec.ts', skipped: false },
    { title: 'the thing page renders', file: 'e2e/a.spec.ts', skipped: false },
  ];

  return {
    apiRoutes: ['/api/thing'],
    pageRoutes: ['/thing'],
    apiRegistry: api,
    pageRegistry: pages,
    tests,
    contractSource: CONTRACT,
    ...overrides,
  };
}

describe('the gate passes a complete registry', () => {
  it('reports nothing when everything lines up', () => {
    // The control. Without it, every assertion below could pass because the
    // audit always returns problems.
    expect(auditCoverage(input())).toEqual([]);
  });
});

describe('a planted route fails the gate', () => {
  it('catches an API route nobody registered', () => {
    const problems = auditCoverage(input({ apiRoutes: ['/api/thing', '/api/smuggled-in'] }));

    expect(problems).toContainEqual({ kind: 'unregistered', detail: '/api/smuggled-in' });
  });

  it('catches a page nobody registered', () => {
    /**
     * This is the landing-page bug as a test. That page was loaded by every
     * spec in the suite -- each one signed in through it -- and shipped broken
     * anyway, because being touched is not being asserted against.
     */
    const problems = auditCoverage(input({ pageRoutes: ['/thing', '/forgotten'] }));

    expect(problems).toContainEqual({ kind: 'unregistered', detail: '/forgotten' });
  });

  it('catches a registration for a route that has been deleted', () => {
    const problems = auditCoverage(input({ apiRoutes: [] }));

    // A stale exemption hides the next unregistered route behind it.
    expect(problems).toContainEqual({ kind: 'stale', detail: '/api/thing' });
  });
});

describe('a skipped registration counts as absent', () => {
  it('fails when the registered test is test.skip', () => {
    const tests = input().tests.map((test) =>
      test.title === 'the thing refuses an anonymous caller' ? { ...test, skipped: true } : test,
    );

    const problems = auditCoverage(input({ tests }));

    expect(problems).toContainEqual({
      kind: 'skipped-test',
      detail: '/api/thing unauthenticated: the thing refuses an anonymous caller',
    });
  });

  it('fails when the page test is skipped', () => {
    const tests = input().tests.map((test) =>
      test.title === 'the thing page renders' ? { ...test, skipped: true } : test,
    );

    expect(auditCoverage(input({ tests }))).toContainEqual({
      kind: 'skipped-test',
      detail: '/thing: the thing page renders',
    });
  });

  it('fails when the whole generated sweep is skipped', () => {
    /**
     * The generated cases are only as real as the generator. A
     * `describe.skip` on the sweep silently removes a hundred and thirty
     * assertions, and every registry entry would still look satisfied.
     */
    const api: ApiRegistration[] = [
      {
        ...input().apiRegistry[0]!,
        unauthenticated: covered('/api/thing refuses an anonymous caller'),
      },
    ];

    const problems = auditCoverage(
      input({ apiRegistry: api, contractSource: `describe.skip('x', () => { ${CONTRACT} })` }),
    );

    expect(problems.some((problem) => problem.kind === 'skipped-test')).toBe(true);
  });
});

describe('a registration that names nothing fails', () => {
  it('catches a test title that does not exist', () => {
    const api: ApiRegistration[] = [
      { ...input().apiRegistry[0]!, success: covered('a test nobody ever wrote') },
    ];

    expect(auditCoverage(input({ apiRegistry: api }))).toContainEqual({
      kind: 'missing-test',
      detail: '/api/thing success: a test nobody ever wrote',
    });
  });

  it('catches an exemption with no real reason', () => {
    // "n/a" is an omission wearing a decision's clothes.
    const api: ApiRegistration[] = [
      { ...input().apiRegistry[0]!, validation: { notApplicable: 'n/a' } },
    ];

    expect(auditCoverage(input({ apiRegistry: api }))).toContainEqual({
      kind: 'vague-exemption',
      detail: '/api/thing validation',
    });
  });

  it('accepts a generated title only when the sweep really emits it', () => {
    const api: ApiRegistration[] = [
      {
        ...input().apiRegistry[0]!,
        unauthenticated: covered('/api/thing refuses an anonymous caller'),
      },
    ];

    // Imported but never called: the registry is claiming a test that nothing
    // generates.
    const problems = auditCoverage(
      input({ apiRegistry: api, contractSource: 'import { anonymousTitle } from "./cases";' }),
    );

    expect(problems.some((problem) => problem.kind === 'missing-test')).toBe(true);
  });
});
