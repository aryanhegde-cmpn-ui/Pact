import { expect, test } from '@playwright/test';

/**
 * The preconditions every other spec quietly assumes.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SPEC EXISTS
 * ---------------------------------------------------------------------------
 * Several checks in this suite are only meaningful in a particular state: the
 * ring needs an imported curriculum, the Start button needs an open block, and
 * none of the Today assertions apply while recovery mode has replaced the page.
 * Written as `test.skip(...)` those degrade into silence -- a spec that never
 * runs is indistinguishable from a spec that was deleted, and the suite still
 * reports green.
 *
 * So the conditional skips stay, and this spec is the one thing that goes RED
 * when the reason for them is present. If half of `today.spec.ts` skipped, this
 * says why in one line rather than leaving it to be noticed.
 *
 * It asserts nothing about the product. It asserts the fixture.
 * ---------------------------------------------------------------------------
 */
test.describe('the fixture this suite needs', () => {
  test('is signed in as the primary', async ({ page }) => {
    await page.goto('/dashboard');

    // The setup project's storage state actually authorises something.
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('has a curriculum imported, so the block assertions are reachable', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const inRecovery = await page.getByRole('heading', { name: 'Recovery' }).isVisible();
    test.skip(inRecovery, 'Recovery mode is active — see the next test.');

    await expect(
      page.getByRole('img', { name: /of 3 blocks done/ }),
      'no curriculum: run `npm run curriculum:import` against this database',
    ).toBeVisible();
  });

  test('is not in recovery mode, which replaces most of what is checked', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('heading', { name: 'Recovery' }),
      'recovery mode is active: the Today assertions are all skipped until the backlog is under the thresholds',
    ).toHaveCount(0);
  });
});
