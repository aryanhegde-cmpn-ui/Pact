import { expect, test } from '@playwright/test';

import { dueLaterToday } from './fixtures';

/**
 * The dispatch endpoint, over HTTP.
 *
 * The queue, the staleness cap, the claim and the subscription lifecycle are
 * all covered as units -- see `src/lib/notifications/`. What a unit test cannot
 * show is that the ROUTE is wired to them and that its one credential actually
 * gates it, which is the part a deploy gets wrong.
 *
 * Real delivery to a device stays uncovered, and stays recorded as uncovered:
 * it needs a real push service, a real endpoint and a real handset.
 */
test.skip(
  !process.env.PACT_E2E_IDENTIFIER || !process.env.PACT_E2E_PASSWORD,
  'Set PACT_E2E_IDENTIFIER and PACT_E2E_PASSWORD to run.',
);

/**
 * The secret, with surrounding quotes stripped.
 *
 * `.env.local` quotes its values and Next's loader unquotes them; a shell that
 * exports one with `grep` does not. The token then differs from the server's
 * by two characters and every dispatch answers 401 -- which reads as a broken
 * endpoint rather than a mis-copied variable.
 */
const CRON_SECRET = (process.env.CRON_SECRET ?? '').replace(/^["']|["']$/g, '');

test('the dispatch endpoint refuses a wrong bearer token', async ({ request }) => {
  const wrong = await request.post('/api/notifications/dispatch', {
    headers: { authorization: 'Bearer definitely-not-the-secret' },
  });
  expect(wrong.status()).toBe(401);

  const absent = await request.post('/api/notifications/dispatch');
  expect(absent.status()).toBe(401);

  /**
   * A prefix of the real secret is refused too. The comparison is constant
   * time, so response timing cannot tell an attacker how many leading bytes
   * were right -- which a `===` would leak on the first differing character.
   */
  const prefix = await request.post('/api/notifications/dispatch', {
    headers: { authorization: `Bearer ${(CRON_SECRET || 'x').slice(0, 4)}` },
  });
  expect(prefix.status()).toBe(401);
});

test('the dispatch endpoint delivers what is due', async ({ page, request }) => {
  test.skip(!CRON_SECRET, 'CRON_SECRET is needed to authorise the dispatch.');

  // Something in the queue to act on. Creating a commitment enqueues three
  // types on two channels.
  const created = await page.request.post('/api/commitments', {
    data: {
      title: `Dispatch fixture ${Date.now()}`,
      outcome: 'The dispatch has something queued to find',
      dueAt: dueLaterToday(),
      estimateMinutes: 10,
      priority: 'maintenance',
    },
  });
  expect(created.ok(), await created.text()).toBe(true);

  const dispatched = await request.post('/api/notifications/dispatch', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });

  expect(dispatched.status(), await dispatched.text()).toBe(200);

  const body = (await dispatched.json()) as { ok: boolean; scanned: number; sent: number };
  expect(body.ok).toBe(true);

  /**
   * A SCAN, not a trigger. It asks what is due and still pending and acts on
   * all of it, which is what makes a missed tick deliver late rather than not
   * at all -- and what makes the daily Vercel cron a real backstop rather than
   * a second chance at the same instant.
   */
  expect(body).toHaveProperty('scanned');
  expect(body).toHaveProperty('sent');
});
