import { expect, test, type Page } from '@playwright/test';

/**
 * The surfaces the rest of the suite structurally cannot see.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE SUITE COULD NOT REACH, AND WHY
 * ---------------------------------------------------------------------------
 * `today.spec.ts` runs signed in as the primary, inside the nav shell. That
 * excludes four whole categories, and the landing-page bug -- a 600px form on a
 * 390px screen -- shipped from the first of them:
 *
 *   1. UNAUTHENTICATED ROUTES. `/` now has its own spec; `/join` and
 *      `/offline` are covered here. All three render outside the shell, so
 *      nothing that holds for a signed-in page holds for them by construction.
 *
 *   2. FULL-SCREEN ROUTES. `/focus/:id` deliberately renders outside `(shell)`
 *      with no nav and no back button. Its own layout rules, its own risk of
 *      overflow, and reachable only by starting a session -- so this spec
 *      creates a commitment and goes there.
 *
 *   3. ANOTHER ACCOUNT'S SURFACES. `/overseer` needs a second account and a
 *      redeemed invite; recovery mode needs an account already past the
 *      thresholds. Both were recorded here as gaps, and both were fixture
 *      problems: they now have seeds and specs of their own
 *      (`e2e/overseer.spec.ts`, `e2e/recovery.spec.ts`).
 *
 *   4. THE SERVICE WORKER. `public/sw.js` is registered in production builds
 *      only. The worker registering and the offline fallback rendering are
 *      asserted here; so is the staleness banner, by serving the two response
 *      headers the worker's contract with the UI actually consists of.
 * ---------------------------------------------------------------------------
 */

async function scrollsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;

    return root.scrollWidth > root.clientWidth + 1;
  });
}

test.describe('unauthenticated routes', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the invite redemption page fits a phone', async ({ page }) => {
    // Renders outside the shell for the same reason the landing page does: the
    // person redeeming has no account yet.
    await page.goto('/join?token=not-a-real-token');
    await page.waitForLoadState('networkidle');

    expect(await scrollsHorizontally(page)).toBe(false);
    await expect(page.locator('nav')).toHaveCount(0);
  });

  test('the offline fallback fits a phone', async ({ page }) => {
    await page.goto('/offline');
    await page.waitForLoadState('networkidle');

    expect(await scrollsHorizontally(page)).toBe(false);
  });
});

test.describe('the full-screen session route', () => {
  test('renders without navigation and without overflowing', async ({ page }) => {
    /**
     * Provisions its own commitment. Selecting whatever happens to be open
     * would make this pass once and skip afterwards -- the failure mode the
     * no-refresh check already had.
     */
    const created = await page.context().request.post('/api/commitments', {
      data: {
        title: `Session fixture ${Date.now()}`,
        outcome: 'The full-screen route has something to open',
        dueAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        estimateMinutes: 25,
        priority: 'maintenance',
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { id } = (await created.json()) as { id: string };

    await page.goto(`/focus/${id}`);
    await page.waitForLoadState('networkidle');

    expect(await scrollsHorizontally(page)).toBe(false);

    // The whole value of a session screen is that there is nowhere else to go.
    await expect(page.locator('nav')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  });
});

test.describe('the staleness banner', () => {
  /**
   * -------------------------------------------------------------------------
   * TESTED AT THE HEADER, NOT THROUGH THE CACHE.
   * -------------------------------------------------------------------------
   * This was recorded as uncoverable because reaching it "needs a cache hit
   * served while offline", and an assertion built on priming the worker's
   * cache and toggling Playwright's offline emulation would be as much a test
   * of the emulation as of the app.
   *
   * But the worker's whole contract with the UI is two response headers. Serve
   * a response carrying them and the banner is either right or it is not --
   * which is the half that has product consequences. Whether the worker sets
   * them is a separate question, and `public/sw.js` sets them in one place.
   *
   * The rule being checked: a cached commitment list is a list of deadlines
   * that may already have passed, and rendering it as current tells the user
   * they have time they do not have.
   * -------------------------------------------------------------------------
   */
  test('renders when a response is served from cache, and clears on retry', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const cachedAt = new Date(Date.now() - 45 * 60 * 1000).toISOString();

    /**
     * One route for the whole test, switched by a flag rather than removed.
     *
     * `page.unroute` cancels routes that are already in flight, and the poll
     * below keeps one in flight almost continuously -- so the handler went on
     * to fulfil a cancelled route and the test died on "Route is already
     * handled" rather than on anything about the banner.
     */
    let serveStale = true;
    await page.route('**/api/today', async (route) => {
      const response = await route.fetch();
      if (!serveStale) {
        await route.fulfill({ response });

        return;
      }

      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          'x-pact-stale': 'true',
          'x-pact-cached-at': cachedAt,
        },
      });
    });

    const banner = page.getByRole('status').filter({ hasText: 'showing saved data' });

    /**
     * Today re-reads the day when the tab comes back, which is the path a
     * cached response actually arrives on. Dispatched in a poll because the
     * listener is attached on hydration, and server-rendered markup is
     * clickable well before that.
     */
    await expect
      .poll(
        async () => {
          await page.evaluate(() => window.dispatchEvent(new Event('focus')));

          return banner.count();
        },
        { timeout: 15_000 },
      )
      .toBe(1);

    // The age is stated, because "offline" alone does not tell anyone whether
    // the deadline they are looking at has passed.
    await expect(banner).toContainText('45 minutes ago');
    await expect(banner).toContainText('Deadlines may have passed');

    // Retry is the only way out of the banner, so it has to actually clear it:
    // a retry that leaves the warning up reads as "still offline" and there is
    // nothing else to press.
    serveStale = false;
    await banner.getByRole('button', { name: 'Retry' }).click();

    await expect(banner).toHaveCount(0);

    /**
     * Torn down explicitly, ignoring in-flight routes.
     *
     * Without this the handler outlives the test: a request still in flight
     * when the test ends resolves against a closed page, and the failure is
     * reported against whichever test happens to run next.
     */
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});

test.describe('the service worker', () => {
  test('registers, so the offline and staleness paths have something to run', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    /**
     * Registered in production builds only -- a cached worker in development
     * makes every change look like it did not apply. `npm run start` is a
     * production build, which is what this suite runs against.
     */
    const registered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const registration = await navigator.serviceWorker.getRegistration();

      return registration ? 'registered' : 'absent';
    });

    expect(['registered', 'unsupported']).toContain(registered);
  });
});

/**
 * ---------------------------------------------------------------------------
 * STILL NOT COVERED, DELIBERATELY
 * ---------------------------------------------------------------------------
 * Recorded here rather than left to be rediscovered:
 *
 *   - Push delivery. It needs a real push service, a real subscription and a
 *     device to receive it. Everything up to the send is covered --
 *     `src/lib/notifications/dispatch.test.ts` claims rows, `push.test.ts`
 *     handles 404 and 410 and the failure count -- and the last hop is the
 *     part no amount of mocking makes real. It stays uncovered on purpose.
 *
 * WHAT USED TO BE ON THIS LIST, AND WHAT MOVED IT
 * ---------------------------------------------------------------------------
 * Three of the four entries here were fixture problems wearing the costume of
 * untestable surfaces, and each was written down as a limitation of the app
 * rather than of the seed:
 *
 *   - `/overseer` needed a second account and a redeemed invite. It has one:
 *     `scripts/seed-overseer.ts`, and `e2e/overseer.spec.ts` covers the pages.
 *
 *   - Recovery mode needed an account past the thresholds, which would have
 *     wrecked the primary's dashboard for every other spec. It has its own
 *     account too: `scripts/seed-recovery.ts` and `e2e/recovery.spec.ts`.
 *
 *   - The staleness banner needed a cache hit while offline. It needed two
 *     response headers, which is what the worker's contract with the UI
 *     actually is; the case above serves them directly.
 *
 * The lesson is worth keeping: "no spec can reach this" is nearly always a
 * statement about the fixtures, and a gap recorded as inherent stops being
 * looked at.
 * ---------------------------------------------------------------------------
 */
