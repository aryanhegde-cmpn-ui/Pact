import { defineConfig } from '@playwright/test';

/**
 * Playwright's scope, and nothing else yet.
 *
 * This file exists primarily as a boundary. With no config at all Playwright
 * defaults `testDir` to the repository root and `testMatch` to
 * `**\/*.@(spec|test).?(c|m)[jt]s?(x)`, which matches every Vitest unit test
 * under `src/`. It then loads them in plain Node, outside any React Server
 * Component graph, where `server-only` resolves to its throwing entry rather
 * than the `react-server` no-op -- so the run died during test *discovery* with
 * "This module cannot be imported from a Client Component module", pointing at
 * a module that was never Playwright's to load.
 *
 * The `server-only` error was the first wall, not the only one: neutralise it
 * and discovery fails again on `vi.mock`, because these are Vitest tests and
 * Playwright cannot run them. The fix is therefore scope, not a change to how
 * the environment module is protected. Nothing in `src/lib/env.ts` was wrong.
 *
 * Two independent barriers, deliberately:
 *
 *  - `testDir` confines Playwright to `e2e/`, so `src/` is unreachable.
 *  - `testMatch` takes `.spec.ts` only, while Vitest owns `.test.ts`
 *    (see `vitest.config.mts`). Either barrier alone is sufficient; together a
 *    file has to be both misplaced and misnamed before the suites collide.
 *
 * The `webServer` block reuses an already-running `next start` when there is
 * one, so the local loop is "build once, run the specs many times" rather than
 * a rebuild per invocation.
 */
export default defineConfig({
  /**
   * 390px is an iPhone 14/15 at its narrowest, and the width the definition of
   * done names. Every layout assertion here is at that width -- the desktop
   * case is the secondary one and a desktop-only check would prove the wrong
   * thing.
   */
  use: {
    baseURL: process.env.PACT_E2E_URL ?? 'http://127.0.0.1:3000',
    viewport: { width: 390, height: 844 },
  },

  webServer: {
    command: 'npm run start',
    url: process.env.PACT_E2E_URL ?? 'http://127.0.0.1:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },

  testDir: './e2e',

  /**
   * Two projects: sign in once, then run everything against that session.
   *
   * Signing in per spec is both slow and flaky here -- attempts are throttled
   * per account, and thirteen of them in a few seconds is the shape the
   * throttle exists to refuse.
   */
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      /**
       * Provisions the second account through the real invite flow, so the
       * overseer's pages are reachable at all. Depends on the primary's
       * session: minting an invite is the primary's action.
       */
      name: 'setup:overseer',
      testMatch: /overseer\.setup\.ts$/,
      dependencies: ['setup'],
      use: { storageState: 'test-results/.auth/primary.json' },
    },
    {
      /**
       * A third account, seeded past the recovery thresholds. It cannot be the
       * primary: recovery mode replaces the dashboard, which is the surface
       * most of the suite is about.
       */
      name: 'setup:recovery',
      testMatch: /recovery\.setup\.ts$/,
    },
    {
      name: 'app',
      testMatch: '**/*.spec.ts',
      testIgnore: ['**/overseer.spec.ts', '**/recovery.spec.ts', '**/access.spec.ts'],
      dependencies: ['setup'],
      use: { storageState: 'test-results/.auth/primary.json' },
    },
    {
      /**
       * The recovery path runs against the OVERSEER fixture and resets its
       * password, so it belongs to the project that owns that account. Doing it
       * to the primary would invalidate PACT_E2E_PASSWORD for every later run.
       */
      name: 'overseer',
      testMatch: ['**/overseer.spec.ts', '**/access.spec.ts'],
      dependencies: ['setup:overseer'],
      use: { storageState: 'test-results/.auth/overseer.json' },
    },
    {
      name: 'recovery',
      testMatch: '**/recovery.spec.ts',
      dependencies: ['setup:recovery'],
      use: { storageState: 'test-results/.auth/recovery.json' },
    },
  ],

  // CI must never silently run a subset because a `.only` was committed.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,

  reporter: process.env.CI ? [['html'], ['list']] : 'list',
});
