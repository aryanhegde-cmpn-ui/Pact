import { execFileSync } from 'node:child_process';

import { expect, test, type Page } from '@playwright/test';

import { OVERSEER_USERNAME } from './fixtures';

/**
 * Recovering an account from the sign-in page, with no terminal.
 *
 * ---------------------------------------------------------------------------
 * THE DEFINITION OF DONE, AS A TEST.
 * ---------------------------------------------------------------------------
 * A forgotten password, a code, a new password, and back in -- through the UI,
 * on the deployed page, without a script. Everything else in this file exists
 * because it is the kind of thing that passes in isolation and fails as a
 * whole: that the used code is dead afterwards, that the sign-in page offers
 * the way in at all, and that the code entry accepts what a person actually
 * types.
 *
 * It runs against the OVERSEER fixture and resets ITS password, never the
 * primary's: `PACT_E2E_PASSWORD` has to keep working for every later run, and
 * a test that breaks the suite's own credentials is one nobody runs twice.
 *
 * It also has its OWN Playwright project, which depends on the overseer's and
 * therefore runs after it. Sharing one meant six workers interleaving the two
 * files, and since recovering an account ends every session it had, half of
 * `overseer.spec.ts` ran signed out. The next run re-provisions the account in
 * `setup:overseer`, which is what restores the password.
 * ---------------------------------------------------------------------------
 */
test.skip(
  !process.env.PACT_E2E_IDENTIFIER || !process.env.PACT_E2E_PASSWORD,
  'Set PACT_E2E_IDENTIFIER and PACT_E2E_PASSWORD to run.',
);

const FIXTURE_USERNAME = OVERSEER_USERNAME;

/** A fresh set, through the script, because this fixture starts without one. */
function issueCodes(): string[] {
  const output = execFileSync(
    'npm',
    ['run', 'recovery:generate', '--', '--username', FIXTURE_USERNAME, '--confirm'],
    { encoding: 'utf8', env: process.env, stdio: 'pipe' },
  ).toString();

  // Six spaces of indent is the codes block; nothing else in the output is
  // indented that far.
  const codes = [...output.matchAll(/^ {6}([A-Z2-9]{5}-[A-Z2-9]{5})$/gm)].map((match) => match[1]!);

  expect(codes, `no codes in output:\n${output}`).toHaveLength(10);

  return codes;
}

async function recover(page: Page, code: string): Promise<void> {
  await page.goto('/recover');

  await page.getByLabel('Username or email').fill(FIXTURE_USERNAME);
  await page.getByLabel('Recovery code').fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
}

test.describe('the way in is on the sign-in page', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('offers recovery before anything has failed', async ({ page }) => {
    await page.goto('/');

    /**
     * Present from the start, not revealed after a failed attempt. Somebody who
     * has forgotten their password knows it before they type anything, and a
     * link that appears only once you have failed makes you fail first.
     */
    const link = page.getByRole('link', { name: 'Forgot your password?' });
    await expect(link).toBeVisible();

    await link.click();
    await expect(page).toHaveURL(/\/recover$/);
    await expect(page.getByRole('heading', { name: 'Recover access' })).toBeVisible();
  });

  test('asks for the identifier and the code together', async ({ page }) => {
    await page.goto('/recover');

    /**
     * One step, both fields. Asking for the identifier first and the code
     * second would answer "does this account exist" before any secret had been
     * presented -- an enumeration oracle on a public page.
     */
    await expect(page.getByLabel('Username or email')).toBeVisible();
    await expect(page.getByLabel('Recovery code')).toBeVisible();
  });

  test('says the same thing for an unknown account and a wrong code', async ({ page }) => {
    await page.goto('/recover');
    await page.getByLabel('Username or email').fill('nobody-at-all');
    await page.getByLabel('Recovery code').fill('AAAAA-BBBBB');
    await page.getByRole('button', { name: 'Continue' }).click();

    const first = await page.getByRole('alert').textContent();

    await page.goto('/recover');
    await page.getByLabel('Username or email').fill(FIXTURE_USERNAME);
    await page.getByLabel('Recovery code').fill('AAAAA-BBBBB');
    await page.getByRole('button', { name: 'Continue' }).click();

    // Byte for byte. A difference here is an oracle for which accounts exist.
    expect(await page.getByRole('alert').textContent()).toBe(first);
  });

  test('fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/recover');

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});

test.describe('recovering', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a code sets a new password, signs in, and cannot be used twice', async ({
    page,
    baseURL,
  }) => {
    const codes = issueCodes();
    const code = codes[0]!;
    const password = `Recovered${Date.now()}x`;

    // ---- 1. Identifier and code ------------------------------------------
    await recover(page, code);
    await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();

    // ---- 2. The new password ---------------------------------------------
    await page.getByLabel('New password').fill(password);
    await page.getByLabel('Confirm').fill(password);
    await page.getByRole('button', { name: 'Set password' }).click();

    await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();
    // Nine left, stated rather than left to be discovered.
    await expect(page.getByText(/9 recovery codes left/)).toBeVisible();

    // ---- 3. It actually signs in ------------------------------------------
    const api = page.context().request;
    const { csrfToken } = (await (await api.get('/api/auth/csrf')).json()) as {
      csrfToken: string;
    };
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
    expect(signIn.headers().location ?? '', 'the new password was rejected').not.toContain(
      'error=',
    );

    // ---- 4. And the code is spent -----------------------------------------
    const second = await api.post('/api/recovery/verify', {
      data: { identifier: FIXTURE_USERNAME, code },
    });
    expect(second.status()).toBe(400);
  });

  test('accepts the code unformatted and in lower case', async ({ page }) => {
    const codes = issueCodes();
    // Transcribed by hand out of a password manager: the hyphen is a display
    // convenience and the case is not part of the secret.
    const typed = codes[0]!.replace('-', '').toLowerCase();

    const response = await page.request.post('/api/recovery/verify', {
      data: { identifier: FIXTURE_USERNAME, code: ` ${typed} ` },
    });

    expect(response.status()).toBe(200);
    expect(((await response.json()) as { token?: string }).token).toBeTruthy();
  });

  test('the token it issues does nothing but set a password', async ({ page }) => {
    const codes = issueCodes();
    const issued = await page.request.post('/api/recovery/verify', {
      data: { identifier: FIXTURE_USERNAME, code: codes[0]! },
    });
    const { token } = (await issued.json()) as { token: string };

    /**
     * It is not a session. Presented as a bearer credential, as a cookie, or
     * as a query parameter, it authenticates nothing -- no route but the reset
     * route has ever heard of it.
     */
    const asBearer = await page.request.get('/api/health/detail', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(asBearer.status()).toBe(401);

    const asCookie = await page.request.get('/api/today', {
      headers: { cookie: `authjs.session-token=${token}` },
    });
    expect(asCookie.status()).toBe(401);
  });
});
