import { expect, test } from '@playwright/test';

import { capture } from './walkthrough/capture';

/**
 * The arrangement, from invitation to revocation.
 *
 * ---------------------------------------------------------------------------
 * THE HALF THAT NEEDS TWO PEOPLE.
 * ---------------------------------------------------------------------------
 * Everything here crosses an account boundary, which is exactly why it kept
 * being untested: a suite that signs in as one user cannot watch a second one
 * grant them something. It runs after the overseer project, in its own, because
 * it revokes and re-invites -- and a revoked relationship is a signed-out
 * overseer for everything that runs afterwards.
 * ---------------------------------------------------------------------------
 */
test.describe.configure({ mode: 'serial' });

test.skip(
  !process.env.PACT_E2E_IDENTIFIER || !process.env.PACT_E2E_PASSWORD,
  'Set PACT_E2E_IDENTIFIER and PACT_E2E_PASSWORD to run.',
);

/**
 * A write succeeded.
 *
 * 200 or 201: routes here use both, and which one a given handler chose is not
 * something a walkthrough should be asserting. What matters is that it was
 * accepted -- the status code's exact value is the handler's business and
 * pinning it makes this spec fail on a refactor that changed nothing.
 */
async function expectAccepted(response: { status: () => number; text: () => Promise<string> }) {
  expect([200, 201], await response.text()).toContain(response.status());
}

const JOINER = {
  username: `walkthrough${Date.now().toString().slice(-6)}`,
  email: `walkthrough${Date.now().toString().slice(-6)}@example.test`,
  password: 'WalkthroughPass2026',
};

const state = { inviteToken: '', rewardId: '', consequenceId: '' };

test('the overseer joins by invite and lands on the record', async ({ page, browser, baseURL }) => {
  const primary = page.context().request;

  /**
   * Revoke first. There is one arrangement at a time, and the fixture already
   * has one -- inviting over the top of it would be testing a state the
   * product does not allow.
   */
  await primary.post('/api/relationship/revoke', { data: {} });

  const invited = await primary.post('/api/relationship/invite', { data: {} });
  await expectAccepted(invited);

  const body = (await invited.json()) as { token?: string; inviteUrl?: string };
  state.inviteToken = body.token ?? (body.inviteUrl ?? '').split('token=')[1] ?? '';
  expect(state.inviteToken, 'the invite carried no token').not.toBe('');

  // The joiner is a stranger: a fresh context with no session at all.
  const guest = await browser.newContext();
  await guest.request.get('/api/auth/csrf');

  const guestPage = await guest.newPage();
  await guestPage.goto(`/join?token=${state.inviteToken}`);
  await capture(guestPage, '1.5 Add the overseer', 'The join page');

  const redeemed = await guest.request.post('/api/relationship/redeem', {
    data: { token: state.inviteToken, ...JOINER },
  });
  await expectAccepted(redeemed);

  /**
   * The codes come back with the account, once. An overseer created without
   * them has no way back in: no reset email, and they cannot ask the primary
   * to run a script.
   */
  const created = (await redeemed.json()) as { recoveryCodes?: string[] };
  expect(created.recoveryCodes ?? []).toHaveLength(10);

  const { csrfToken } = (await (await guest.request.get('/api/auth/csrf')).json()) as {
    csrfToken: string;
  };
  await guest.request.post('/api/auth/callback/credentials', {
    form: {
      csrfToken,
      identifier: JOINER.username,
      password: JOINER.password,
      callbackUrl: `${baseURL}/overseer`,
      json: 'true',
    },
    maxRedirects: 0,
  });

  await guestPage.goto('/overseer');
  await expect(guestPage.getByRole('heading', { name: 'The record' })).toBeVisible();
  await capture(guestPage, '4.1 Configuring them (overseer only)', 'The overseer record');

  await guestPage.close();
  await guest.close();
});

test('a consequence is configured, and its status cannot be set by hand', async ({
  browser,
  baseURL,
}) => {
  const overseer = await browser.newContext();
  const { csrfToken } = (await (await overseer.request.get('/api/auth/csrf')).json()) as {
    csrfToken: string;
  };
  await overseer.request.post('/api/auth/callback/credentials', {
    form: {
      csrfToken,
      identifier: JOINER.username,
      password: JOINER.password,
      callbackUrl: `${baseURL}/overseer`,
      json: 'true',
    },
    maxRedirects: 0,
  });

  const configured = await overseer.request.post('/api/stakes/consequences', {
    data: {
      name: `No cinema ${Date.now()}`,
      description: 'Until the adherence rate comes back up',
      trigger: 'adherence-threshold',
      triggerConfig: { thresholdRate: 0.6 },
      windowDays: 7,
      dischargeCondition: { kind: 'adherence-recovered', thresholdRate: 0.8 },
    },
  });
  await expectAccepted(configured);
  state.consequenceId = ((await configured.json()) as { id: string }).id;

  /**
   * THE WINDOW IS CAPPED BY THE SCHEMA, NOT THE FORM.
   *
   * A month-long consequence stops being motivation and becomes background
   * resentment, and a cap that only exists in the UI is a cap the API does not
   * have.
   */
  const tooLong = await overseer.request.post('/api/stakes/consequences', {
    data: {
      name: 'A month of no cinema',
      description: 'Far too long to be motivating',
      trigger: 'adherence-threshold',
      triggerConfig: { thresholdRate: 0.6 },
      windowDays: 30,
      dischargeCondition: { kind: 'adherence-recovered', thresholdRate: 0.8 },
    },
  });
  expect([400, 422]).toContain(tooLong.status());

  /**
   * A CONSEQUENCE DISCHARGES BY DOING THE WORK, NEVER BY BEING SET.
   *
   * `editStakeSchema` carries a name and a description and nothing else --
   * status is derived from triggers, discharge and expiry. Letting it be
   * written would make "discharged" something that can be granted rather than
   * earned, which is the dismiss button arriving through the back door.
   */
  const renamed = await overseer.request.patch(`/api/stakes/consequences/${state.consequenceId}`, {
    data: { name: 'No cinema, renamed' },
  });
  await expectAccepted(renamed);

  const forced = await overseer.request.patch(`/api/stakes/consequences/${state.consequenceId}`, {
    data: { status: 'discharged' },
  });

  /**
   * Refused. `status` is not a field the edit schema knows about, so an update
   * carrying only that matches nothing -- and there is no route anywhere that
   * accepts a consequence status, which is the actual guarantee. Discharging
   * is something the primary earns by doing the work; a status the overseer
   * could write would be the dismiss button arriving through the back door.
   */
  expect([400, 404, 422], await forced.text()).toContain(forced.status());

  await overseer.close();
});

test('the primary claims a reward the overseer granted', async ({ page, browser, baseURL }) => {
  const overseer = await browser.newContext();
  const { csrfToken } = (await (await overseer.request.get('/api/auth/csrf')).json()) as {
    csrfToken: string;
  };
  await overseer.request.post('/api/auth/callback/credentials', {
    form: {
      csrfToken,
      identifier: JOINER.username,
      password: JOINER.password,
      callbackUrl: `${baseURL}/overseer`,
      json: 'true',
    },
    maxRedirects: 0,
  });

  /**
   * `manual-grant`: the overseer decides, rather than a rule firing. That is
   * the whole mechanism -- a second person holding an outcome that matters
   * outside the app, which is what separates this from a badge.
   */
  const reward = await overseer.request.post('/api/stakes/rewards', {
    data: {
      name: `Long lunch ${Date.now()}`,
      description: 'For a week kept',
      trigger: 'manual-grant',
      triggerConfig: {},
    },
  });
  await expectAccepted(reward);
  state.rewardId = ((await reward.json()) as { id: string }).id;

  /**
   * A malformed edit, against a REAL reward id.
   *
   * The generic contract sweep cannot reach this one: it substitutes a
   * commitment id into every `[id]`, so a stakes route 404s before its schema
   * ever runs. Asserted here, where there is an actual reward to address.
   */
  const malformed = await overseer.request.patch(`/api/stakes/rewards/${state.rewardId}`, {
    data: { name: 12345, description: { nope: true } },
  });
  expect([400, 422], await malformed.text()).toContain(malformed.status());

  const granted = await overseer.request.post('/api/stakes/grant', {
    data: { rewardId: state.rewardId, note: 'Earned it' },
  });
  await expectAccepted(granted);

  // And the PRIMARY claims it. The overseer decides; the primary collects.
  const claimed = await page.context().request.post('/api/rewards/claim', {
    data: { rewardId: state.rewardId },
  });
  await expectAccepted(claimed);

  await page.goto('/stakes');
  await page.waitForLoadState('networkidle');
  await capture(page, '4.3 How a consequence discharges', 'The primary stakes page');

  await overseer.close();
});

test('revoking ends the arrangement and leaves what was earned', async ({ page }) => {
  const primary = page.context().request;

  const revoked = await primary.post('/api/relationship/revoke', { data: {} });
  await expectAccepted(revoked);

  /**
   * What was already granted stays. If revoking cleared it, the fastest way
   * out of any consequence would be revoke, wait, re-invite -- which is the
   * arrangement defeating itself.
   */
  const stakes = await primary.get('/api/recovery');
  expect(stakes.status()).toBe(200);

  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  await capture(page, '4.5 Revoking the overseer', 'After revocation');
});
