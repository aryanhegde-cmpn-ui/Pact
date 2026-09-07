import { expect, test, type Page } from '@playwright/test';

/**
 * Every surface at every width.
 *
 * Today was verified at 390px and desktop was explicitly the secondary case,
 * which is a reasonable order to build in and a bad place to stop: nothing
 * above 390 had ever been measured, and the overseer's pages had never been
 * designed at all.
 *
 * Landscape phone is in the list because nothing had been checked against a
 * short viewport, and a `min-h-dvh` centred layout is exactly what breaks
 * there.
 */
test.skip(
  !process.env.PACT_E2E_IDENTIFIER || !process.env.PACT_E2E_PASSWORD,
  'Set PACT_E2E_IDENTIFIER and PACT_E2E_PASSWORD to run.',
);

const WIDTHS = [
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1440', width: 1440, height: 900 },
  { name: '844x390 landscape', width: 844, height: 390 },
];

const SURFACES = [
  '/dashboard',
  '/tomorrow',
  '/week',
  '/study',
  '/study/curriculum',
  '/study/phases',
  '/study/review',
  '/progress',
  '/postponements',
  '/settings',
  '/stakes',
];

async function scrollsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;

    return root.scrollWidth > root.clientWidth + 1;
  });
}

/**
 * Anything wider than the viewport, other than a deliberate scroller.
 *
 * `[data-scrollable]` marks a genuinely tabular region that is allowed to
 * scroll sideways inside its own box. A table collapsed into unlabelled
 * stacked rows is not an acceptable alternative -- the labels are the table.
 */
async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const limit = document.documentElement.clientWidth;

    for (const element of document.querySelectorAll('body *')) {
      if (element.closest('[data-scrollable]')) continue;

      const box = element.getBoundingClientRect();
      if (box.width === 0) continue;
      if (box.right > limit + 1 || box.left < -1) {
        out.push(
          `${element.tagName.toLowerCase()}.${(element.className || '').toString().slice(0, 40)}`,
        );
      }
    }

    return out.slice(0, 5);
  });
}

for (const size of WIDTHS) {
  test.describe(`at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const path of SURFACES) {
      test(`${path} fits`, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState('networkidle');

        expect(await scrollsHorizontally(page), `${path} scrolls sideways`).toBe(false);
        expect(await overflowingElements(page), `${path} has content past the edge`).toEqual([]);
      });
    }

    test('content is not full-bleed on a wide screen', async ({ page }) => {
      test.skip(size.width < 1440, 'Only meaningful above the widest breakpoint.');

      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');

      /**
       * Text measured in characters, not pixels. Unbounded prose at 1440 runs
       * to well over a hundred characters a line, which is unreadable however
       * good the type is.
       */
      const widest = await page.evaluate(() => {
        let max = 0;
        for (const element of document.querySelectorAll('p, h1, h2, li')) {
          const box = element.getBoundingClientRect();
          if (box.width > max) max = box.width;
        }

        return max;
      });

      expect(widest).toBeLessThanOrEqual(1100);
    });
  });
}

test.describe('touch targets', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of SURFACES) {
    test(`${path} has none below 44px`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const small = await page.evaluate(() => {
        const out: string[] = [];
        for (const element of document.querySelectorAll(
          'button, a[href], select, input:not([type="hidden"]), textarea',
        )) {
          const box = element.getBoundingClientRect();
          // Zero-sized elements are hidden, not small.
          if (box.width === 0 || box.height === 0) continue;
          // Inline links inside a sentence are text, not targets.
          if (element.tagName === 'A' && getComputedStyle(element).display === 'inline') continue;
          if (box.height < 44) {
            out.push(
              `${element.tagName.toLowerCase()} "${(element.textContent ?? '').trim().slice(0, 30)}" ${Math.round(box.height)}px`,
            );
          }
        }

        return out.slice(0, 6);
      });

      expect(small).toEqual([]);
    });
  }
});
