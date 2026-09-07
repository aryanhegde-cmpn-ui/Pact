import { expect, test as setup } from '@playwright/test';

/**
 * Signs in once, for the whole run.
 *
 * Through the API rather than the form, deliberately. The sign-in form is a
 * client component holding both fields in React state, so a `fill` that lands
 * before hydration is discarded and the submit that follows is a native GET --
 * which reloads an empty form and looks exactly like a wrong password. Racing
 * hydration in every spec is a flake generator, and it tests the login form
 * rather than the thing each spec is actually about.
 *
 * Doing it once also matters for a reason specific to this app: sign-in
 * attempts are throttled per account. Thirteen specs each signing in is
 * thirteen attempts in a few seconds, which is exactly the shape the throttle
 * exists to refuse.
 */
const IDENTIFIER = process.env.PACT_E2E_IDENTIFIER;
const PASSWORD = process.env.PACT_E2E_PASSWORD;

export const STORAGE_STATE = 'test-results/.auth/primary.json';

setup.skip(!IDENTIFIER || !PASSWORD, 'Set PACT_E2E_IDENTIFIER and PACT_E2E_PASSWORD to run.');

setup('authenticate', async ({ page, baseURL }) => {
  const api = page.context().request;

  // Auth.js requires the CSRF token and its cookie to travel together; sharing
  // the page's context means both live in the same jar.
  const csrfResponse = await api.get('/api/auth/csrf');
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };

  const signIn = await api.post('/api/auth/callback/credentials', {
    form: {
      csrfToken,
      identifier: IDENTIFIER ?? '',
      password: PASSWORD ?? '',
      callbackUrl: `${baseURL}/dashboard`,
      json: 'true',
    },
    maxRedirects: 0,
  });

  /**
   * A failed credentials sign-in also redirects, to `/?error=...`. Checking the
   * location is what tells the two apart -- Auth.js deliberately returns the
   * same status either way.
   */
  const location = signIn.headers().location ?? '';
  expect(location, 'sign-in was rejected; check PACT_E2E_PASSWORD').not.toContain('error=');

  // Proves the cookie actually authorises something, rather than merely existing.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard/);

  await page.context().storageState({ path: STORAGE_STATE });
});
