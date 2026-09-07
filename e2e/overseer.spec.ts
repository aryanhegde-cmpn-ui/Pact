import { expect, test, type Page } from '@playwright/test';

/**
 * The overseer's surfaces, from a real redeemed invite.
 *
 * These pages had never been rendered by any test. Authorization was covered
 * by directory enumeration in `src/lib/stakes-authorization.test.ts` -- which
 * is the half that matters and is not what this replaces -- but nothing
 * checked that the pages come up, that the forms work, or that what the
 * overseer configures reaches the primary.
 *
 * Runs from `overseer.setup.ts`, which provisions the second account through
 * the invite and redemption path rather than by inserting a user.
 */
test.skip(
  !process.env.PACT_E2E_IDENTIFIER || !process.env.PACT_E2E_PASSWORD,
  'Set PACT_E2E_IDENTIFIER and PACT_E2E_PASSWORD to run.',
);

const WIDTHS = [
  { name: '390 (phone)', width: 390, height: 844 },
  { name: '768 (tablet)', width: 768, height: 1024 },
  { name: '1024 (laptop)', width: 1024, height: 768 },
  { name: '1440 (desktop)', width: 1440, height: 900 },
];

async function scrollsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;

    return root.scrollWidth > root.clientWidth + 1;
  });
}

test.describe('the record', () => {
  test('renders, which nothing checked before', async ({ page }) => {
    await page.goto('/overseer');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'The record' })).toBeVisible();
  });

  test('shows adherence as a rate over a window', async ({ page }) => {
    await page.goto('/overseer');
    await page.waitForLoadState('networkidle');

    // A rolling rate, never a consecutive count. docs/product.md, Conflict 1.
    await expect(page.getByText(/Kept \d+ of the last \d+/)).toBeVisible();

    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/\bstreak\b/i);
  });

  test('shows no free-text notes unless the primary shared them', async ({ page }) => {
    await page.goto('/overseer');
    await page.waitForLoadState('networkidle');

    // The default is private. Structured categories carry the accountability
    // value; the free text is where the primary is honest with themselves.
    await expect(page.getByText(/Free-text notes are private/)).toBeVisible();
  });

  for (const size of WIDTHS) {
    test(`does not scroll sideways at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/overseer');
      await page.waitForLoadState('networkidle');

      expect(await scrollsHorizontally(page)).toBe(false);
    });
  }
});

test.describe('configuring the stakes', () => {
  test('adds a consequence, and the window is capped', async ({ page }) => {
    await page.goto('/overseer');
    await page.waitForLoadState('networkidle');

    // Scoped to the form: both forms carry `name` and `description` fields,
    // which is correct markup and ambiguous to a bare selector.
    const form = page.getByRole('form', { name: 'Add a consequence' });

    const name = `No cinema ${Date.now()}`;
    await form.locator('input[name="name"]').fill(name);
    await form
      .locator('input[name="description"]')
      .fill('Nothing at the cinema until the mornings are back on track.');
    await form.getByRole('button', { name: 'Add consequence' }).click();

    await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });

    // The cap is in the schema, not the form -- but the form should not offer
    // a value the schema will refuse either.
    await expect(form.locator('input[name="windowDays"]')).toHaveAttribute('max', '7');
  });

  test('adds a reward and grants it by hand', async ({ page }) => {
    await page.goto('/overseer');
    await page.waitForLoadState('networkidle');

    const form = page.getByRole('form', { name: 'Add a reward' });

    const name = `Climbing day ${Date.now()}`;
    await form.locator('input[name="name"]').fill(name);
    await form.locator('input[name="description"]').fill('Paid for, no argument.');
    await form.locator('select[name="trigger"]').selectOption('manual-grant');
    await form.getByRole('button', { name: 'Add reward' }).click();

    const row = page.locator('li').filter({ hasText: name });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // The overseer's decision, with no rule. Evaluation must never award it.
    await row.getByRole('button', { name: 'Grant it' }).click();
    await expect(row.getByText('earned')).toBeVisible({ timeout: 15_000 });
  });

  for (const size of WIDTHS) {
    test(`the forms are usable at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/overseer');
      await page.waitForLoadState('networkidle');

      expect(await scrollsHorizontally(page)).toBe(false);

      const form = page.getByRole('form', { name: 'Add a consequence' });
      for (const selector of ['input[name="name"]', 'input[name="windowDays"]']) {
        const box = await form.locator(selector).boundingBox();
        expect(box?.height ?? 0, `${selector} at ${size.name}`).toBeGreaterThanOrEqual(44);
        expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
      }
    });
  }
});

test.describe('what the overseer configures reaches the primary', () => {
  test.use({ storageState: 'test-results/.auth/primary.json' });

  test('the primary sees it on their stakes page', async ({ page }) => {
    await page.goto('/stakes');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Stakes' })).toBeVisible();
    // Something exists to see: the overseer specs above configured it.
    await expect(page.getByText('None configured.')).toHaveCount(0);
  });

  test('the primary cannot configure anything', async ({ page }) => {
    /**
     * The authorization boundary, checked at the boundary rather than only in
     * the unit test. An arrangement whose subject can edit their own
     * consequences is not an arrangement.
     */
    const response = await page.context().request.post('/api/stakes/consequences', {
      data: {
        name: 'Self-serve',
        description: 'Should never be accepted.',
        trigger: 'adherence-threshold',
        triggerConfig: { thresholdRate: 0.1 },
        windowDays: 1,
        dischargeCondition: { kind: 'adherence-recovered', thresholdRate: 0.1 },
      },
    });

    expect(response.status()).toBe(403);
  });

  test('the primary cannot grant themselves a reward', async ({ page }) => {
    const response = await page.context().request.post('/api/stakes/grant', {
      data: { rewardId: '000000000000000000000000' },
    });

    expect(response.status()).toBe(403);
  });
});
