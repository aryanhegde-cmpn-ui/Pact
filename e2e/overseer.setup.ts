import { execFileSync } from 'node:child_process';

import { expect, test as setup } from '@playwright/test';

/**
 * Storage state for the overseer, from a real redeemed invite.
 *
 * ---------------------------------------------------------------------------
 * A FIXTURE PROBLEM, NOT A SPEC PROBLEM.
 * ---------------------------------------------------------------------------
 * The overseer's pages had no coverage because no spec could reach them: every
 * spec signs in as the primary, since the primary was the only account any seed
 * produced. That is the same structural gap that shipped the 600px landing
 * page, and it had cost three bugs before it was worth solving properly.
 *
 * `npm run seed:overseer` provisions the account through the real invite and
 * redemption path -- not by inserting a user with a role field -- so the
 * fixture exercises the flow it depends on. This runs it, then signs in.
 * ---------------------------------------------------------------------------
 */
export const OVERSEER_STORAGE = 'test-results/.auth/overseer.json';

const USERNAME = 'overseer1';
const PASSWORD = 'OverseerPass2026x';

setup.skip(
  !process.env.PACT_E2E_IDENTIFIER || !process.env.PACT_E2E_PASSWORD,
  'Set PACT_E2E_IDENTIFIER and PACT_E2E_PASSWORD to run.',
);

setup('provision and authenticate the overseer', async ({ page, baseURL }) => {
  /**
   * Provisioned here rather than assumed, so the suite is self-sufficient and
   * a second run does not depend on the state the first left behind. The seed
   * refuses to touch anything but a scratch database.
   */
  execFileSync('npm', ['run', 'seed:overseer', '--', '--reset'], {
    stdio: 'pipe',
    env: process.env,
  });

  const api = page.context().request;

  const csrfResponse = await api.get('/api/auth/csrf');
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };

  const signIn = await api.post('/api/auth/callback/credentials', {
    form: {
      csrfToken,
      identifier: USERNAME,
      password: PASSWORD,
      callbackUrl: `${baseURL}/overseer`,
      json: 'true',
    },
    maxRedirects: 0,
  });

  const location = signIn.headers().location ?? '';
  expect(location, 'overseer sign-in was rejected').not.toContain('error=');

  // Proves the relationship is live, not just that the account exists: the
  // guard re-checks it on every request, so a revoked overseer would render
  // nothing.
  await page.goto('/overseer');
  await expect(page).toHaveURL(/\/overseer/);
  await expect(page.getByRole('heading', { name: 'The record' })).toBeVisible();

  await page.context().storageState({ path: OVERSEER_STORAGE });
});
