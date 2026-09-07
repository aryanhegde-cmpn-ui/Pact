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
 *   3. THE OVERSEER'S SURFACES. `/overseer` is not covered, and cannot be
 *      without a second seeded account and a redeemed invite. That is a real
 *      gap, recorded rather than papered over: see the note at the bottom.
 *
 *   4. THE SERVICE WORKER. `public/sw.js` is registered in production builds
 *      only, and the staleness banner it drives is reachable only from a cache
 *      hit while offline. Partially covered here by asserting the worker
 *      registers and the offline fallback renders; the stale-response path is
 *      not, and is recorded below.
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
 *   - `/overseer` and every consequence-configuration route. They need a
 *     second account and a redeemed single-use invite, which means seeding a
 *     relationship before the suite runs. The authorization rules are covered
 *     by enumeration in `src/lib/route-permissions.test.ts` and
 *     `src/lib/stakes-authorization.test.ts`, which is the half that actually
 *     matters -- but nothing checks that the overseer's PAGES render.
 *
 *   - The staleness banner. It needs a cache hit served while offline, which
 *     means priming the worker's cache, going offline, and reloading. Possible,
 *     but the assertion would be about Playwright's offline emulation as much
 *     as about the app.
 *
 *   - Recovery mode's own screen. Reachable only by pushing the account over
 *     the thresholds, which would wreck the fixture for every other spec. It
 *     is covered by unit tests over `getRecoveryState`.
 *
 *   - Push delivery. Needs a real push service.
 * ---------------------------------------------------------------------------
 */
