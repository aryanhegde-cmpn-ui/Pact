import { expect, test, type Page } from '@playwright/test';

/**
 * Motion, in the browser.
 *
 * The source scans in `src/lib/motion-invariants.test.ts` say what the code
 * may contain. These say what actually happens on screen -- specifically that
 * `prefers-reduced-motion` produces cuts rather than shorter animations, which
 * is a runtime property no scan can prove.
 */
test.skip(
  !process.env.PACT_E2E_IDENTIFIER || !process.env.PACT_E2E_PASSWORD,
  'Set PACT_E2E_IDENTIFIER and PACT_E2E_PASSWORD to run.',
);

type Captured = { properties: string[]; heights: string[] };

/** Every element currently mid-animation, by the browser's own reckoning. */
async function runningAnimations(page: Page): Promise<number> {
  return page.evaluate(
    () => document.getAnimations().filter((animation) => animation.playState === 'running').length,
  );
}

/**
 * Records what animates, from BOTH places animation happens.
 *
 * ---------------------------------------------------------------------------
 * `document.getAnimations()` DOES NOT SEE MOTION.
 * ---------------------------------------------------------------------------
 * It reports WAAPI animations and CSS transitions. Motion animates `height`
 * from a measured pixel value on the main thread and writes an inline style
 * every frame, which appears in neither. Watching only `getAnimations()` gave
 * a test that captured the button's hover transition, saw no exit, and read as
 * "the row does not animate" while the row was visibly collapsing.
 *
 * So: a MutationObserver on inline styles for Motion, and the frame loop for
 * everything the browser drives itself. The heights are kept separately
 * because the count of distinct values is what separates an animation from a
 * cut -- reduced motion still ends at `height: 0`, it just does not pass
 * through anything on the way.
 * ---------------------------------------------------------------------------
 */
async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    const properties = new Set<string>();
    const heights = new Set<string>();
    (window as unknown as { __pactMotion: unknown }).__pactMotion = { properties, heights };

    const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

    new MutationObserver((records) => {
      for (const entry of records) {
        const { style } = entry.target as HTMLElement;
        for (const property of style) properties.add(camel(property));
        if (style.height) heights.add(style.height);
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true });

    const ignored = ['offset', 'composite', 'computedOffset', 'easing'];
    const tick = () => {
      for (const animation of document.getAnimations()) {
        const effect = animation.effect as KeyframeEffect | null;
        for (const frame of effect?.getKeyframes() ?? []) {
          for (const key of Object.keys(frame)) if (!ignored.includes(key)) properties.add(key);
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function captured(page: Page): Promise<Captured> {
  return page.evaluate(() => {
    const store = (
      window as unknown as { __pactMotion?: { properties: Set<string>; heights: Set<string> } }
    ).__pactMotion;

    return { properties: [...(store?.properties ?? [])], heights: [...(store?.heights ?? [])] };
  });
}

/**
 * Waits until React has actually attached its handlers.
 *
 * Server-rendered markup is clickable long before it is interactive, and
 * Playwright's actionability checks cannot tell the difference: the click
 * lands, nothing happens, and the test reports that the feature is broken.
 * Toggling a control that only exists client-side is the honest proof.
 */
async function waitForHydration(page: Page): Promise<void> {
  const history = page.getByRole('button', { name: 'History' }).first();
  await expect(history).toBeVisible();

  await expect
    .poll(
      async () => {
        await history.click();

        return page.getByRole('button', { name: 'Hide history' }).count();
      },
      { timeout: 15_000, message: 'Today never hydrated' },
    )
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Hide history' }).first().click();
}

async function givenSomethingToComplete(page: Page, label: string): Promise<void> {
  const created = await page.context().request.post('/api/commitments', {
    data: {
      title: `${label} ${Date.now()}`,
      outcome: 'The motion suite has something to complete',
      dueAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
      estimateMinutes: 10,
      priority: 'maintenance',
    },
  });
  expect(created.ok()).toBe(true);
}

/** The open rows in "also today" -- the list the exit animation acts on. */
function openRows(page: Page) {
  return page
    .getByRole('region', { name: 'Other commitments due today' })
    .locator('ul')
    .first()
    .locator('> li');
}

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('animates nothing on Today', async ({ page }) => {
    /**
     * REDUCED MOTION MEANS CUTS, NOT SLOWER ANIMATION.
     *
     * Halving a duration misreads the setting: someone who asked for reduced
     * motion is often asking because motion makes them ill, and a shorter
     * animation is still animation.
     */
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    expect(await runningAnimations(page)).toBe(0);
  });

  test('completes without passing through intermediate frames', async ({ page }) => {
    await givenSomethingToComplete(page, 'Reduced motion fixture');

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    const before = await openRows(page).count();
    await record(page);
    await openRows(page).first().getByRole('button', { name: 'Complete' }).click();

    // The row still leaves. It simply does not travel there.
    await expect.poll(async () => openRows(page).count(), { timeout: 15_000 }).toBe(before - 1);

    const { heights } = await captured(page);
    expect(heights.length, `heights written: ${heights.join(', ')}`).toBeLessThanOrEqual(1);
    expect(await runningAnimations(page)).toBe(0);
  });

  test('animates nothing entering focus mode', async ({ page }) => {
    const created = await page.context().request.post('/api/commitments', {
      data: {
        title: `Focus fixture ${Date.now()}`,
        outcome: 'The focus route has something to open',
        dueAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        estimateMinutes: 20,
        priority: 'maintenance',
      },
    });
    const { id } = (await created.json()) as { id: string };

    await page.goto(`/focus/${id}`);
    await page.waitForLoadState('networkidle');

    expect(await runningAnimations(page)).toBe(0);
  });
});

test.describe('with motion allowed', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('does not animate on page load', async ({ page }) => {
    /**
     * No staggered entrance. It is fashionable, it animates nothing that
     * changed, and it adds perceived latency to the screen opened most often.
     *
     * Checked immediately after load rather than after settling: a stagger
     * would still be running here.
     */
    await page.goto('/dashboard');
    await page.waitForSelector('h1');

    expect(await runningAnimations(page)).toBe(0);
  });

  test('completing a commitment animates the row leaving, and nothing else', async ({ page }) => {
    await givenSomethingToComplete(page, 'Exit fixture');

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await waitForHydration(page);

    const before = await openRows(page).count();
    await record(page);
    await openRows(page).first().getByRole('button', { name: 'Complete' }).click();

    await expect.poll(async () => openRows(page).count(), { timeout: 15_000 }).toBe(before - 1);

    const { properties, heights } = await captured(page);

    /**
     * Asserted as what is BANNED, not as an exhaustive allow-list.
     *
     * The allow-list version failed on `borderBottomColor` -- an ordinary CSS
     * hover transition on the button that was just clicked, which is affordance
     * feedback rather than a flourish and predates any of this. Listing every
     * legitimate property would mean re-listing it whenever a hover state was
     * added, and the rule was never about the list.
     *
     * The rule is that a completion produces the row leaving and nothing
     * expressive. Scale, rotation and a background flash are the vocabulary of
     * a reward; height and opacity are the vocabulary of something going away.
     */
    const expressive = properties.filter((property) =>
      /^(scale|rotate|transform|backgroundColor|boxShadow|filter)/.test(property),
    );

    expect(expressive).toEqual([]);
    // And the row was in fact leaving, through more than one frame, so neither
    // assertion above is vacuous.
    expect(properties).toContain('height');
    expect(heights.length).toBeGreaterThan(3);
  });
});
