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
 * There are no specs yet, so there is no `webServer` block. Add one alongside
 * the first spec rather than in advance -- a `webServer` pointing at a build
 * nothing tests is a slow no-op that still has to be maintained.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',

  // CI must never silently run a subset because a `.only` was committed.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,

  reporter: process.env.CI ? [['html'], ['list']] : 'list',
});
