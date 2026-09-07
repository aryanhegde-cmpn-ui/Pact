import { expect, test, type Page } from '@playwright/test';

/**
 * The definition of done, checked on the thing rather than asserted about it.
 *
 * Everything here is at 390px, because that is where commitments actually get
 * created and completed. A layout assertion at desktop width would prove the
 * secondary case and miss the one that matters.
 *
 * Requires a running server and a seeded account:
 *
 *   PACT_E2E_IDENTIFIER=aryan-hegde PACT_E2E_PASSWORD='...' npm run test:e2e
 *
 * Skipped without those, rather than failing -- a spec that cannot sign in has
 * nothing to say about the layout, and a red suite that means "no credentials"
 * teaches people to ignore a red suite.
 *
 * The session comes from `auth.setup.ts`, once for the whole run.
 */
test.skip(
  !process.env.PACT_E2E_IDENTIFIER || !process.env.PACT_E2E_PASSWORD,
  'Set PACT_E2E_IDENTIFIER and PACT_E2E_PASSWORD to run.',
);

/**
 * Whether the page scrolls sideways.
 *
 * `scrollWidth > clientWidth` on the document element is the honest test: it
 * catches a single wide table or an unbroken 96-character title just as well
 * as a broken grid, and it is what the user experiences.
 */
async function scrollsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;

    return root.scrollWidth > root.clientWidth + 1;
  });
}

const TABS = [
  { path: '/dashboard', name: 'Today' },
  { path: '/tomorrow', name: 'Tomorrow' },
  { path: '/week', name: 'This week' },
  { path: '/study', name: 'Study' },
  { path: '/progress', name: 'Progress' },
  { path: '/postponements', name: 'Postponements' },
  { path: '/settings', name: 'Settings' },
];

test.describe('at 390px', () => {
  for (const tab of TABS) {
    test(`${tab.name} does not scroll sideways`, async ({ page }) => {
      const response = await page.goto(tab.path);

      // A redirect is a valid outcome: recovery mode sends the gated surfaces
      // back to the dashboard, and that page must not scroll either.
      expect(response?.status()).toBeLessThan(400);
      await page.waitForLoadState('networkidle');

      expect(await scrollsHorizontally(page)).toBe(false);
    });
  }
});

test.describe('Today', () => {
  test('leads with a greeting and the next action', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Recovery mode replaces the page entirely; there is nothing to assert
    // about the greeting when it is on.
    const inRecovery = await page.getByRole('heading', { name: 'Recovery' }).isVisible();
    test.skip(inRecovery, 'Recovery mode is active for this account.');

    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible();

    // The greeting is the h1 and the next action's title is the h2 beneath it.
    const greeting = (await heading.textContent()) ?? '';
    expect(greeting.length).toBeGreaterThan(0);
    expect(greeting.length).toBeLessThanOrEqual(60);
  });

  test('makes the next action the largest thing on the page', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    test.skip(
      await page.getByRole('heading', { name: 'Recovery' }).isVisible(),
      'Recovery mode is active.',
    );

    const start = page.getByRole('link', { name: /^(Start|Answer for it)$/ }).first();
    if ((await start.count()) === 0) test.skip(true, 'Nothing open today.');

    const box = await start.boundingBox();
    // The one button, full width on a phone, at a real touch size.
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    expect(box?.width ?? 0).toBeGreaterThan(250);
  });

  test('shows a ring whose denominator is three', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    test.skip(
      await page.getByRole('heading', { name: 'Recovery' }).isVisible(),
      'Recovery mode is active.',
    );

    const ring = page.getByRole('img', { name: /of 3 blocks done/ });
    if ((await ring.count()) === 0) test.skip(true, 'No curriculum imported.');

    await expect(ring).toBeVisible();
  });

  test('every tab target is reachable and finger-sized', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const tabs = page.locator('nav[aria-label="Primary"]').last().getByRole('link');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(4);

    for (let i = 0; i < count; i += 1) {
      const box = await tabs.nth(i).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('the visual rules', () => {
  test('uses no emoji anywhere on Today', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const text = (await page.locator('body').innerText()) ?? '';
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  test('shows no XP, badge or streak on any surface', async ({ page }) => {
    for (const tab of TABS) {
      /**
       * Retried, because a `goto` issued while the App Router still has a
       * prefetch in flight aborts with ERR_ABORTED. That is a race in the
       * driving, not a fault in the page.
       */
      await expect(async () => {
        await page.goto(tab.path, { waitUntil: 'domcontentloaded' });
      }).toPass({ timeout: 15_000 });

      await page.waitForLoadState('networkidle');

      const text = (await page.locator('body').innerText()) ?? '';
      expect(text, `${tab.name} renders a reward-layer word`).not.toMatch(
        /\b(xp|badge|leaderboard|streak)\b/i,
      );
    }
  });
});

test.describe('completing without a refresh', () => {
  test('updates the page from the API rather than reloading it', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    test.skip(
      await page.getByRole('heading', { name: 'Recovery' }).isVisible(),
      'Recovery mode is active.',
    );

    const complete = page.getByRole('button', { name: 'Complete' }).first();
    if ((await complete.count()) === 0) test.skip(true, 'Nothing completable on Today.');

    /**
     * Marks the document so a full navigation is detectable. If the page
     * reloaded, this property is gone -- which is exactly the thing being
     * ruled out.
     */
    await page.evaluate(() => {
      (window as unknown as { __pactNoReload: boolean }).__pactNoReload = true;
    });

    const before = await page.locator('body').innerText();
    await complete.click();

    // The list re-renders from /api/today; nothing navigates.
    await expect
      .poll(async () => (await page.locator('body').innerText()) !== before, { timeout: 15_000 })
      .toBe(true);

    expect(
      await page.evaluate(
        () => (window as unknown as { __pactNoReload?: boolean }).__pactNoReload === true,
      ),
    ).toBe(true);
  });
});
