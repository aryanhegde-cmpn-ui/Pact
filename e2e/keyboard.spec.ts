import { expect, test, type Page } from '@playwright/test';

/**
 * The keyboard, in a real browser.
 *
 * Focus order, focus restoration and whether a shortcut is inert while typing
 * are runtime properties: the unit tests assert the rules, and these assert
 * that the rules are actually wired to the page a person uses.
 */
test.skip(
  !process.env.PACT_E2E_IDENTIFIER || !process.env.PACT_E2E_PASSWORD,
  'Set PACT_E2E_IDENTIFIER and PACT_E2E_PASSWORD to run.',
);

/** What has focus, described well enough to read in a failure message. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return '(body)';

    return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}:${(
      element.textContent ?? ''
    )
      .trim()
      .slice(0, 30)}`;
  });
}

/** Hydration has to have happened before any key press means anything. */
async function ready(page: Page): Promise<void> {
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: 'Make a commitment' })).toBeVisible();
}

test.describe('navigating by keyboard alone', () => {
  test('the first Tab reaches the skip link, and it moves focus to the content', async ({
    page,
  }) => {
    await ready(page);
    await page.evaluate(() => document.body.focus());

    await page.keyboard.press('Tab');
    expect(await focused(page)).toContain('Skip to content');

    await page.keyboard.press('Enter');

    /**
     * The anchor alone is not enough: without `tabIndex={-1}` on the target the
     * browser scrolls but leaves focus in the nav, so the next Tab goes
     * straight back to the first nav item and the link achieves nothing.
     */
    expect(await focused(page)).toContain('main#content');
  });

  test('reaches every interactive element on Today', async ({ page }) => {
    await ready(page);

    const reachable = new Set<string>();
    await page.evaluate(() => document.body.focus());

    /**
     * Tabs until the cycle wraps rather than a fixed number of times.
     *
     * A fixed count is a trap here: Today lists every commitment due, each with
     * four controls, so the page had 68 stops before the ones underneath it.
     * A hundred-and-twenty-tab test passed on an empty fixture and reported the
     * footer links as unreachable on a real one.
     */
    for (let index = 0; index < 400; index += 1) {
      await page.keyboard.press('Tab');
      const current = await focused(page);
      if (index > 0 && current.includes('Skip to content')) break;
      reachable.add(current);
    }

    const interactive = await page.evaluate(() =>
      [...document.querySelectorAll('main button, main a[href], main select, main input')]
        .filter((element) => (element as HTMLElement).offsetParent !== null)
        .map(
          (element) =>
            `${element.tagName.toLowerCase()}:${(element.textContent ?? '').trim().slice(0, 30)}`,
        ),
    );

    const unreachable = interactive.filter(
      (description) => ![...reachable].some((seen) => seen.endsWith(description.split(':')[1]!)),
    );

    expect(unreachable, `not reachable by Tab: ${unreachable.join(', ')}`).toEqual([]);
  });

  test('shows a visible focus ring', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const outline = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement as Element);

      return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor };
    });

    // 2px solid, in the attention colour: 6.09:1 against the ground, well over
    // the 3:1 that a non-text indicator needs.
    expect(outline.style).toBe('solid');
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  });
});

test.describe('shortcuts', () => {
  test('? opens the sheet, and it lists every binding', async ({ page }) => {
    await ready(page);

    await page.keyboard.press('?');

    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Today');
    await expect(dialog).toContainText('New commitment');
    await expect(dialog).toContainText('Start the next action');
  });

  test('focus is trapped in the sheet and restored when it closes', async ({ page }) => {
    await ready(page);

    const trigger = page.getByRole('button', { name: 'Make a commitment' });
    await trigger.focus();

    await page.keyboard.press('?');
    await expect(page.getByRole('dialog')).toBeVisible();

    // Ten tabs is more than the sheet holds: without a trap, focus would be
    // somewhere in the page behind by now.
    for (let index = 0; index < 10; index += 1) await page.keyboard.press('Tab');

    const inside = await page.evaluate(() =>
      document.querySelector('[role="dialog"]')?.contains(document.activeElement),
    );
    expect(inside).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await focused(page)).toContain('Make a commitment');
  });

  test('g then t navigates', async ({ page }) => {
    await page.goto('/progress');
    await page.waitForLoadState('networkidle');

    await page.keyboard.press('g');
    await page.keyboard.press('t');

    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('every single key is inert while an input has focus', async ({ page }) => {
    await ready(page);

    // Open the create form, so there is a real field to type into.
    await page.getByRole('button', { name: 'Make a commitment' }).click();
    const title = page.locator('input[name="title"]');
    await title.click();

    /**
     * The whole vocabulary, typed as text. "n" would open a new commitment,
     * "1" would start a block, "s" would start the next action, "/" would
     * steal focus and "?" would cover the form with a dialog.
     */
    await title.fill('');
    await page.keyboard.type('n1s/?gt');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(title).toHaveValue('n1s/?gt');
    await expect(title).toBeFocused();
  });

  test('no shortcut abandons anything', async ({ page }) => {
    await ready(page);

    /**
     * Abandoning is the one action on Today that cannot be undone. It is
     * reachable by mouse and by Tab, and by nothing else -- there is no key
     * that reaches it, and the binding list has a test saying there never will
     * be.
     */
    const before = await page.locator('main li').count();

    for (const key of ['a', 'x', 'd', 'Delete', 'Backspace']) {
      await page.keyboard.press(key);
    }

    await page.waitForTimeout(500);
    expect(await page.locator('main li').count()).toBe(before);
  });
});

test.describe('what changed is announced', () => {
  test('there is exactly one live region, and it is polite', async ({ page }) => {
    await ready(page);

    const regions = await page.evaluate(() =>
      [...document.querySelectorAll('[aria-live]')].map((element) => ({
        live: element.getAttribute('aria-live'),
        atomic: element.getAttribute('aria-atomic'),
      })),
    );

    // Polite rather than assertive: it waits for a pause instead of cutting in.
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions.every((region) => region.live === 'polite')).toBe(true);
  });

  test('the ring says in words what it draws', async ({ page }) => {
    await ready(page);

    const ring = page.getByRole('img', { name: /of \d+/ });
    await expect(ring).toBeVisible();
    await expect(ring).toHaveAttribute('aria-label', /\d+ of \d+/);
  });
});
