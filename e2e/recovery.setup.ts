import { execFileSync } from 'node:child_process';

import { expect, test as setup } from '@playwright/test';

/**
 * Storage state for an account that is already past the recovery thresholds.
 *
 * ---------------------------------------------------------------------------
 * A FIXTURE PROBLEM, NOT AN UNCOVERABLE SCREEN.
 * ---------------------------------------------------------------------------
 * Recovery mode was recorded as untestable because reaching it "would wreck
 * the fixture for every other spec" -- which is true of the PRIMARY's account
 * and only of the primary's account. It replaces the dashboard outright, so
 * pushing the primary over the thresholds would replace the dashboard for the
 * Today suite, the motion suite and the responsive sweep at once.
 *
 * The overseer's pages had the identical shape of gap and it was solved with a
 * second account. This is the third, seeded straight into the state the screen
 * exists for.
 * ---------------------------------------------------------------------------
 */
export const RECOVERY_STORAGE = 'test-results/.auth/recovery.json';

const USERNAME = 'behind1';
const PASSWORD = 'BehindPass2026x';

setup.skip(
  !process.env.PACT_E2E_IDENTIFIER || !process.env.PACT_E2E_PASSWORD,
  'Set PACT_E2E_IDENTIFIER and PACT_E2E_PASSWORD to run.',
);

setup('provision and authenticate an account in recovery', async ({ page, baseURL }) => {
  execFileSync('npm', ['run', 'seed:recovery', '--', '--reset'], {
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
      callbackUrl: `${baseURL}/dashboard`,
      json: 'true',
    },
    maxRedirects: 0,
  });

  const location = signIn.headers().location ?? '';
  expect(location, 'recovery-fixture sign-in was rejected').not.toContain('error=');

  // The state is derived on read, so this also proves the seeded rows actually
  // trip it -- a fixture that quietly failed to would leave the specs below
  // asserting against an ordinary dashboard.
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Recovery', exact: true })).toBeVisible();

  await page.context().storageState({ path: RECOVERY_STORAGE });
});
