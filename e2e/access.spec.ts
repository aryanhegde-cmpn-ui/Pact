import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

/**
 * Getting back in.
 *
 * ---------------------------------------------------------------------------
 * THE PATH THAT WAS BROKEN, END TO END.
 * ---------------------------------------------------------------------------
 * Production sign-in failed for two reasons at once, and neither was visible
 * from inside the app: `/api/auth/providers` returned 500 because AUTH_SECRET
 * was not set, and the password had been reset against a different database
 * because no script said which one it was connected to.
 *
 * So this covers the recovery path as a whole: the auth endpoints answer, the
 * reset command produces a password, and that password actually signs in. A
 * test of the command alone would have passed throughout the outage.
 *
 * It runs against the OVERSEER fixture, not the primary. Resetting the
 * primary's password would invalidate `PACT_E2E_PASSWORD` for every later run,
 * and a test that breaks the suite's own credentials is a test nobody runs
 * twice.
 * ---------------------------------------------------------------------------
 */
test.skip(
  !process.env.PACT_E2E_IDENTIFIER || !process.env.PACT_E2E_PASSWORD,
  'Set PACT_E2E_IDENTIFIER and PACT_E2E_PASSWORD to run.',
);

const FIXTURE_USERNAME = 'overseer1';

test.describe('the auth endpoints answer', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('providers returns 200 with the credentials provider', async ({ request }) => {
    /**
     * This endpoint touches no database and takes no session, so a 500 here is
     * always configuration -- specifically AUTH_SECRET, which Auth.js reads
     * from `process.env` itself and never through the Zod schema. That is why
     * the schema "passed" while every auth route was failing: it was never
     * called on that path.
     */
    const response = await request.get('/api/auth/providers');

    expect(response.status(), await response.text()).toBe(200);

    const providers = (await response.json()) as Record<string, { id: string; type: string }>;
    expect(providers.credentials?.type).toBe('credentials');
  });

  test('csrf returns a token', async ({ request }) => {
    const response = await request.get('/api/auth/csrf');

    expect(response.status()).toBe(200);
    expect((await response.json()).csrfToken).toBeTruthy();
  });
});

test.describe('access:reset', () => {
  test('names the database and refuses without --confirm', () => {
    /**
     * The refusal exits non-zero, which is the point: a script that reports
     * success without acting is how a password ends up in the wrong database.
     */
    let stdout = '';
    let exitCode = 0;
    try {
      stdout = execFileSync('npm', ['run', 'access:reset', '--', '--username', FIXTURE_USERNAME], {
        encoding: 'utf8',
        env: process.env,
        stdio: 'pipe',
      }).toString();
    } catch (error) {
      const failure = error as { status?: number; stdout?: Buffer; stderr?: Buffer };
      exitCode = failure.status ?? 1;
      stdout = `${failure.stdout?.toString() ?? ''}${failure.stderr?.toString() ?? ''}`;
    }

    expect(exitCode).not.toBe(0);
    // Target first, accounts second, refusal last -- so the operator can see
    // what they were about to do, and to which database.
    expect(stdout).toContain('Target:');
    expect(stdout).toContain('Accounts here:');
    expect(stdout).toContain('without --confirm');
  });
});

test('a freshly reset password signs in', async ({ page, baseURL }) => {
  let output = '';
  try {
    output = execFileSync(
      'npm',
      ['run', 'access:reset', '--', '--username', FIXTURE_USERNAME, '--confirm'],
      { encoding: 'utf8', env: process.env, stdio: 'pipe' },
    ).toString();
  } catch (error) {
    throw new Error(
      `access:reset failed:\n${String((error as { stdout?: Buffer }).stdout ?? error)}`,
    );
  }

  expect(output).toContain('Target:');
  expect(output).toContain('Password reset for');

  /**
   * The password is the only indented token in the block, printed once and
   * never written anywhere. Parsed rather than passed in, because a command
   * that accepted a password would put it in shell history -- which is the
   * thing this tool exists to avoid.
   */
  const match = /\n {6}(\S+)\n/.exec(output);
  expect(match, `no password in output:\n${output}`).not.toBeNull();
  const password = match![1]!;

  const api = page.context().request;
  const { csrfToken } = (await (await api.get('/api/auth/csrf')).json()) as { csrfToken: string };

  const signIn = await api.post('/api/auth/callback/credentials', {
    form: {
      csrfToken,
      identifier: FIXTURE_USERNAME,
      password,
      callbackUrl: `${baseURL}/overseer`,
      json: 'true',
    },
    maxRedirects: 0,
  });

  expect(signIn.headers().location ?? '', 'sign-in was rejected').not.toContain('error=');

  // And the session it issued is real, not just a redirect without an error.
  await page.goto('/overseer');
  await expect(page.getByRole('heading', { name: 'The record' })).toBeVisible();
});
