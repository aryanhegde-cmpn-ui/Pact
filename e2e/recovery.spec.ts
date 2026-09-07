import { expect, test, type Page } from '@playwright/test';

/**
 * Recovery mode's own screen.
 *
 * Runs as its own account -- see `e2e/recovery.setup.ts` -- because the screen
 * REPLACES the dashboard, and the primary's dashboard is what most of the rest
 * of the suite is about.
 *
 * What is asserted here is what unit tests over `getRecoveryState` cannot see:
 * that the replacement actually happens over HTTP, that the gated surfaces
 * redirect, that settings stays reachable, and that the screen fits the widths
 * it will be read at.
 */
test.skip(
  !process.env.PACT_E2E_IDENTIFIER || !process.env.PACT_E2E_PASSWORD,
  'Set PACT_E2E_IDENTIFIER and PACT_E2E_PASSWORD to run.',
);

async function scrollsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;

    return root.scrollWidth > root.clientWidth + 1;
  });
}

test('replaces the dashboard rather than annotating it', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Recovery', exact: true })).toBeVisible();

  /**
   * The ordinary dashboard is GONE, not pushed below a banner. A banner would
   * leave the long overdue list underneath it, which is the thing recovery
   * mode exists to take away.
   */
  await expect(page.getByRole('heading', { name: /^Other commitments/ })).toHaveCount(0);
  await expect(page.getByText('also today')).toHaveCount(0);
});

test('offers three slots and nothing to scroll', async ({ page }) => {
  await page.goto('/dashboard');

  for (const label of ['Finish today', 'Move it, deliberately', 'Let it go']) {
    await expect(page.getByRole('heading', { name: label })).toBeVisible();
  }

  // The count is stated once. It is not a metric, and there is nothing to
  // scroll: three slots, no list of what is left. Scoped to `main`, because
  // the nav is a list and it is not part of this screen.
  await expect(page.getByText(/commitments are past due/)).toBeVisible();
  await expect(page.locator('main ul li')).toHaveCount(0);
});

test('takes the planning surfaces away and leaves settings', async ({ page }) => {
  for (const path of ['/study', '/study/curriculum', '/postponements', '/week']) {
    await page.goto(path);
    await expect(page, `${path} should redirect during recovery`).toHaveURL(/\/dashboard$/);
  }

  /**
   * Settings stays reachable, deliberately. A restrictive state with no way to
   * change quiet hours or end an overseer arrangement is a trap, not a tool.
   */
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings$/);
});

for (const size of [
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
]) {
  test(`fits at ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Recovery', exact: true })).toBeVisible();
    expect(await scrollsHorizontally(page)).toBe(false);
  });
}
