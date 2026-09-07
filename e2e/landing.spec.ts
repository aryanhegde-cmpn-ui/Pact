import { expect, test } from '@playwright/test';

/**
 * The signed-OUT landing page.
 *
 * Its own spec because it needs its own session state -- or rather, none.
 * `today.spec.ts` runs with the storage state from `auth.setup.ts`, so every
 * assertion in it is about a page behind the sign-in wall. The one surface
 * that is not behind that wall had no coverage at all, which is exactly how a
 * 600px-wide form shipped on a 390px screen: the suite was green and had never
 * looked at it.
 *
 * This is also the first page anyone ever sees, and the only one they can see
 * before deciding whether the app works.
 */
test.use({ storageState: { cookies: [], origins: [] } });

async function scrollsHorizontally(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;

    return root.scrollWidth > root.clientWidth + 1;
  });
}

test.describe('at 390px', () => {
  test('does not scroll sideways', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(await scrollsHorizontally(page)).toBe(false);
  });

  test('fits the form inside the viewport', async ({ page }) => {
    await page.goto('/');

    // The specific failure: a container with a min-width larger than the
    // screen. The box being inside the viewport is the thing the user cares
    // about, and it catches any future cause of the same symptom.
    for (const selector of ['input[name="identifier"]', 'input[name="password"]', 'form']) {
      const box = await page.locator(selector).boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box!.x, `${selector} starts off-screen`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${selector} runs off-screen`).toBeLessThanOrEqual(390);
    }
  });

  test('gives every control a finger-sized target', async ({ page }) => {
    await page.goto('/');

    for (const selector of [
      'input[name="identifier"]',
      'input[name="password"]',
      'button[type="submit"]',
    ]) {
      const box = await page.locator(selector).boundingBox();
      expect(box?.height ?? 0, selector).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('the visual rules', () => {
  test('uses no emoji', async ({ page }) => {
    await page.goto('/');

    expect(await page.locator('body').innerText()).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  test('says why it is asking, when it was reached from a protected route', async ({ page }) => {
    await page.goto('/?returnTo=%2Fstudy');

    await expect(page.getByText('Sign in to continue.')).toBeVisible();
  });

  test('shows no navigation to routes a signed-out visitor cannot reach', async ({ page }) => {
    await page.goto('/');

    // The landing page sits outside `(shell)` for exactly this reason.
    await expect(page.locator('nav')).toHaveCount(0);
  });
});
