import { expect, request, test, type APIRequestContext } from '@playwright/test';

import {
  anonymousTitle,
  forbiddenTitle,
  isCovered,
  successTitle,
  validationTitle,
  type ApiRegistration,
} from './coverage/cases';
import { API_REGISTRY, OVERSEER_CAPABILITIES } from './coverage/api-registry';
import { OVERSEER_STORAGE } from './fixtures';

/**
 * The three cases every guarded route owes, generated from the registry.
 *
 * ---------------------------------------------------------------------------
 * GENERATED, AND STILL EXPLICITLY REGISTERED.
 * ---------------------------------------------------------------------------
 * Every case here exists because a line in `coverage/api-registry.ts` names it.
 * That is the difference the coverage gate is about: the route is not covered
 * because a test happened to touch it, it is covered because somebody wrote
 * down that it should be and said which caller and which status.
 *
 * Writing forty-six of each by hand would produce forty-six chances to paste
 * the wrong capability into the wrong route, and one of them would be wrong in
 * the direction that passes.
 *
 * SUCCESS lives here only for routes that can be read without changing
 * anything. A POST's success is a step in `walkthrough.spec.ts`, where it has
 * the surrounding state that makes it mean something.
 * ---------------------------------------------------------------------------
 */
test.skip(
  !process.env.PACT_E2E_IDENTIFIER || !process.env.PACT_E2E_PASSWORD,
  'Set PACT_E2E_IDENTIFIER and PACT_E2E_PASSWORD to run.',
);

const BASE = process.env.PACT_E2E_URL ?? 'http://127.0.0.1:3000';

/** Substituted into `[id]` segments so a guarded route reaches its handler. */
let commitmentId = '';
let anonymous: APIRequestContext;
let overseer: APIRequestContext;

test.beforeAll(async ({ browser }) => {
  /**
   * EXPLICITLY EMPTY, and this is not belt and braces.
   *
   * `request.newContext()` inherits the project's `use` options, storage state
   * included -- so an "anonymous" context created without saying otherwise is
   * signed in as the primary. Every 401 assertion then received a 200 and the
   * sweep reported forty failures that were all the same mistake in the
   * fixture rather than in the app.
   */
  anonymous = await request.newContext({
    baseURL: BASE,
    storageState: { cookies: [], origins: [] },
  });
  overseer = await request.newContext({ baseURL: BASE, storageState: OVERSEER_STORAGE });

  const context = await browser.newContext();
  const created = await context.request.post('/api/commitments', {
    data: {
      title: `Contract fixture ${Date.now()}`,
      outcome: 'The contract sweep has a real id to address',
      dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      estimateMinutes: 15,
      priority: 'maintenance',
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  commitmentId = ((await created.json()) as { id: string }).id;
  await context.close();
});

test.afterAll(async () => {
  await anonymous.dispose();
  await overseer.dispose();
});

/** `/api/commitments/[id]/complete` -> a path that actually resolves. */
function pathFor(route: string): string {
  return route.replace('[id]', commitmentId).replace('[commitmentId]', commitmentId);
}

/**
 * The method to probe with, which is not the same question for every case.
 *
 * For the guard's checks -- 401 and 403 -- the cheapest method that reaches it
 * will do, and a GET is cheapest. For VALIDATION it must be a write: a schema
 * only runs on a body, and sending a malformed body with a GET tests nothing
 * except that GET ignores bodies, which it does, with a 200. That mistake made
 * eleven routes report a passing validation case that had never validated
 * anything.
 */
function probeMethod(
  entry: ApiRegistration,
  purpose: 'guard' | 'body',
): 'get' | 'post' | 'patch' | 'delete' {
  if (purpose === 'guard' && entry.methods.includes('GET')) return 'get';
  if (entry.methods.includes('POST')) return 'post';
  if (entry.methods.includes('PATCH')) return 'patch';
  if (entry.methods.includes('DELETE')) return 'delete';

  return 'get';
}

async function call(
  context: APIRequestContext,
  entry: ApiRegistration,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const method = probeMethod(entry, body === undefined ? 'guard' : 'body');
  const path = pathFor(entry.route);

  const response =
    method === 'get' ? await context.get(path) : await context[method](path, { data: body ?? {} });

  return { status: response.status(), text: (await response.text()).slice(0, 300) };
}

/**
 * A body that no schema accepts.
 *
 * Deliberately not "missing a field": a wrong TYPE fails every schema in the
 * app, where an empty object is legitimately valid for a route whose fields are
 * all optional.
 */
const MALFORMED = { title: 12345, dueAt: 'not-a-date', __proto__unexpected: true };

for (const entry of API_REGISTRY) {
  const generated = (title: string, coverage: ApiRegistration['success']): boolean =>
    isCovered(coverage) && coverage.covered === title;

  // ---- Unauthenticated ---------------------------------------------------
  if (generated(anonymousTitle(entry.route), entry.unauthenticated)) {
    test(anonymousTitle(entry.route), async () => {
      const { status, text } = await call(anonymous, entry);

      // 401 and nothing else. A 500 here means the guard threw before deciding,
      // and a 200 means the route never asked who was calling.
      expect(status, `${entry.route}: ${text}`).toBe(401);
    });
  }

  // ---- Signed in, and still not allowed ----------------------------------
  if (generated(forbiddenTitle(entry.route), entry.forbidden)) {
    test(forbiddenTitle(entry.route), async () => {
      /**
       * The overseer is the signed-in caller who legitimately lacks most of
       * the primary's capabilities. Using them rather than a hand-made session
       * means the test exercises the real matrix rather than a mock of it.
       */
      expect(
        entry.capability,
        `${entry.route} registers a 403 but requires no capability`,
      ).toBeTruthy();
      expect(
        OVERSEER_CAPABILITIES as readonly string[],
        `${entry.route} registers a 403 against a capability the overseer HOLDS`,
      ).not.toContain(entry.capability);

      const { status, text } = await call(overseer, entry);

      expect(status, `${entry.route}: ${text}`).toBe(403);
    });
  }

  // ---- A body the schema refuses -----------------------------------------
  if (generated(validationTitle(entry.route), entry.validation)) {
    test(validationTitle(entry.route), async ({ page }) => {
      /**
       * Sent by somebody who is ALLOWED to make the request.
       *
       * The capability check runs before the schema -- correctly -- so probing
       * a stakes route as the primary gets a 403 and never reaches the
       * validation at all. Testing the schema means using the role that holds
       * the capability, which for `consequence:write` is the overseer.
       */
      const caller = entry.capability === 'consequence:write' ? overseer : page.request;
      const { status, text } = await call(caller, entry, MALFORMED);

      /**
       * 422 from Zod, 400 from a hand-rolled check or a Mongoose validator.
       * What matters is that it is a refusal naming the request rather than a
       * 500 -- an escaped exception is the failure mode the translator exists
       * to prevent, and it looks identical to a server fault from outside.
       */
      expect([400, 409, 422], `${entry.route} answered ${status}: ${text}`).toContain(status);
    });
  }

  // ---- Success, for anything readable without side effects ---------------
  if (generated(successTitle(entry.route), entry.success) && entry.methods.includes('GET')) {
    test(successTitle(entry.route), async ({ page }) => {
      const response = await page.request.get(pathFor(entry.route));

      expect(response.status(), await response.text()).toBe(200);

      const body = (await response.json()) as Record<string, unknown>;
      for (const key of entry.shape ?? []) {
        expect(body, `${entry.route} is missing "${key}"`).toHaveProperty(key);
      }
    });
  }
}
