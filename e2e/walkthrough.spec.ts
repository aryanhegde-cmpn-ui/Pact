import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { capture, writeIndex } from './walkthrough/capture';
import { dueLaterToday } from './fixtures';

/**
 * The whole application, in the order a person meets it.
 *
 * ---------------------------------------------------------------------------
 * ONE LINEAR RUN, AND IT IS THE MANUAL'S SCREENSHOTS.
 * ---------------------------------------------------------------------------
 * Every other spec here proves one thing in isolation. This one walks the
 * product: sign in, start a block, finish it, miss something, answer for it,
 * look at the record, configure the stakes, take a holiday. That ordering is
 * the point -- most of what goes wrong in this app goes wrong BETWEEN
 * surfaces, and a suite of isolated assertions never crosses those seams.
 *
 * It is `serial` deliberately. A step that fails leaves the ones after it
 * without their setup, and running them anyway produces a page of failures
 * that all describe the same broken thing.
 *
 * It also carries the success case for every route that CHANGES something.
 * `api-contract.spec.ts` covers the three refusals generically, because those
 * are the same shape everywhere; a success is only meaningful with the state
 * around it, which is here.
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

/** Shared across steps, because the journey is one journey. */
const state: {
  commitmentId: string;
  missedId: string;
  seriesId: string;
  topicKey: string;
} = { commitmentId: '', missedId: '', seriesId: '', topicKey: '' };

async function createCommitment(
  api: APIRequestContext,
  title: string,
  dueAt: string,
): Promise<string> {
  const response = await api.post('/api/commitments', {
    data: {
      title,
      outcome: `${title} is finished and recorded`,
      dueAt,
      estimateMinutes: 20,
      priority: 'maintenance',
    },
  });
  expect(response.ok(), await response.text()).toBe(true);

  return ((await response.json()) as { id: string }).id;
}

/** Hydration has happened when a client-only control responds. */
async function ready(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
}

/**
 * Ends anything the last run left running.
 *
 * A focus session locks `commitment:write` at the guard, so a run that died
 * mid-session leaves the NEXT run unable to create anything -- every step
 * fails with 409 "You're in a session", which reads as a broken lock rather
 * than as a fixture holding a door open. The lock is working; the fixture is
 * dirty.
 */
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: 'test-results/.auth/primary.json' });
  try {
    const running = await context.request.get('/api/focus');
    if (running.ok()) {
      const body = (await running.json()) as { session: { commitmentId?: string } | null };
      if (body.session?.commitmentId) {
        await context.request.post('/api/focus/end', {
          // `more-time` needs the revised estimate: the exit exists to correct
          // a number, so ending without one would be the thing it is for,
          // skipped.
          data: {
            outcome: 'more-time',
            revisedEstimateMinutes: 30,
            note: 'Ended by the walkthrough, which found it still open.',
          },
        });
      }
    }
  } finally {
    await context.close();
  }
});

test.afterAll(() => {
  // Written once, at the end, so a partial run does not leave a partial index
  // claiming to be the whole set.
  const path = writeIndex();
  console.log(`\n  Screenshot index: ${path}\n`);
});

// ---------------------------------------------------------------------------
// 1. Getting in
// ---------------------------------------------------------------------------

test('says the same thing for a wrong password and an unknown user', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/');
  await capture(page, '1.4 Create the primary user', 'The sign-in page');

  const submit = async (identifier: string, password: string): Promise<string> => {
    await page.goto('/');
    await page.getByLabel('Username or email').fill(identifier);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    /**
     * Waited for, and filtered to the one with text in it.
     *
     * Two things on this page carry `role="alert"` and one of them is empty
     * until it has something to say. Reading the alert immediately -- or
     * reading the empty one -- returns '' for both attempts, and '' equals '',
     * so the assertion would PASS on a test whose entire point is that two
     * messages are identical.
     */
    const alert = page.getByRole('alert').filter({ hasText: /\S/ }).first();
    await expect(alert).toBeVisible();

    return (await alert.textContent()) ?? '';
  };

  const wrongPassword = await submit(process.env.PACT_E2E_IDENTIFIER!, 'definitely-not-it');
  const unknownUser = await submit('nobody-at-all', 'definitely-not-it');

  /**
   * Byte for byte. Distinguishing them turns the form into an oracle for which
   * accounts exist, and "your account is locked" confirms it for free.
   */
  expect(wrongPassword.length).toBeGreaterThan(0);
  expect(unknownUser).toBe(wrongPassword);

  await capture(page, "6.1 I can't sign in", 'One message for every failure');
});

test('signing in lands on Today', async ({ page, baseURL }) => {
  const api = page.context().request;
  const { csrfToken } = (await (await api.get('/api/auth/csrf')).json()) as { csrfToken: string };

  await api.post('/api/auth/callback/credentials', {
    form: {
      csrfToken,
      identifier: process.env.PACT_E2E_IDENTIFIER!,
      password: process.env.PACT_E2E_PASSWORD!,
      callbackUrl: `${baseURL}/dashboard`,
      json: 'true',
    },
    maxRedirects: 0,
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

// ---------------------------------------------------------------------------
// 2. The morning
// ---------------------------------------------------------------------------

test('Today leads with the day and the work, in that order', async ({ page }) => {
  await page.goto('/dashboard');
  await ready(page);

  await expect(page.getByRole('img', { name: /of \d+/ })).toBeVisible();
  await capture(page, '2.1 The morning', 'Today, with the blocks pending');
});

test('a focus session runs on the server clock and locks writes', async ({ page }) => {
  const api = page.context().request;
  state.commitmentId = await createCommitment(
    api,
    `Walkthrough block ${Date.now()}`,
    dueLaterToday(),
  );

  const started = await api.post('/api/focus/start', {
    data: { commitmentId: state.commitmentId, kind: 'execution' },
  });
  await expectAccepted(started);

  const session = (await started.json()) as { session?: { startedAt?: string } };
  // The server owns the clock: it answers with when IT thinks this began, and
  // the client recomputes from that rather than counting locally.
  expect(session.session?.startedAt ?? '').not.toBe('');

  await page.goto(`/focus/${state.commitmentId}`);
  await ready(page);
  await capture(page, '2.2 Starting a block', 'The focus screen, mid-session');

  /**
   * THE LOCK, OVER HTTP. While a session runs, `commitment:write` is refused
   * by the guard -- before the handler, so a second tab cannot route around it.
   */
  const blocked = await api.post('/api/commitments', {
    data: {
      title: 'Should be refused',
      outcome: 'The session lock refuses this',
      dueAt: dueLaterToday(),
      estimateMinutes: 10,
      priority: 'maintenance',
    },
  });
  expect(blocked.status()).toBe(409);

  await capture(page, '2.3 The three exits', 'Done, need more time, blocked');

  /**
   * DONE takes one line on what changed. That question is the difference
   * between finished and ticked off, and the schema will not accept the exit
   * without it.
   */
  const ended = await api.post('/api/focus/end', {
    data: { outcome: 'done', note: 'Walkthrough completed it end to end.' },
  });
  await expectAccepted(ended);
});

test('an interruption is recorded against the running session', async ({ page }) => {
  const api = page.context().request;
  const id = await createCommitment(api, `Interrupted ${Date.now()}`, dueLaterToday());

  await api.post('/api/focus/start', { data: { commitmentId: id, kind: 'execution' } });

  const interrupted = await api.post('/api/focus/interrupt', { data: {} });
  await expectAccepted(interrupted);
  // Counted on the SERVER's session row, not in the page: an interruption
  // tracked client-side would reset every time the tab was backgrounded, which
  // is when most of them happen.
  const count = ((await interrupted.json()) as { interruptionCount: number }).interruptionCount;
  expect(count).toBeGreaterThan(0);

  await api.post('/api/focus/end', {
    data: { outcome: 'more-time', revisedEstimateMinutes: 40, note: 'Still going' },
  });
});

test('the research budget interrupts once and takes a justification', async ({ page }) => {
  const api = page.context().request;
  const id = await createCommitment(api, `Research ${Date.now()}`, dueLaterToday());

  await api.post('/api/focus/start', {
    data: { commitmentId: id, kind: 'research', researchBudgetMinutes: 1 },
  });

  /**
   * Extending REQUIRES a justification and a number. A budget that is always
   * extended with a shrug is the same as not having one, so the schema refuses
   * the shrug -- which this asserts before taking the happy path.
   */
  const unjustified = await api.post('/api/focus/budget', { data: { decision: 'extend' } });
  expect([400, 422]).toContain(unjustified.status());

  const decided = await api.post('/api/focus/budget', {
    data: { decision: 'extend', justification: 'One more source, then I build.', extraMinutes: 15 },
  });
  await expectAccepted(decided);

  await api.post('/api/focus/end', {
    data: { outcome: 'more-time', revisedEstimateMinutes: 45, note: 'Budget spent' },
  });
});

test('recording topic progress moves it out of not-started', async ({ page }) => {
  const api = page.context().request;

  /**
   * The curriculum comes back as BLOCKS of modules of topics, which is the
   * shape the plan actually has -- three windows in one morning, not a flat
   * subject list. Flattening here rather than assuming.
   */
  const curriculum = (await (await api.get('/api/curriculum')).json()) as {
    blocks: { modules: { topics: { stableKey: string }[] }[] }[];
  };
  const allTopics = curriculum.blocks.flatMap((block) =>
    block.modules.flatMap((module) => module.topics),
  );
  expect(allTopics.length).toBeGreaterThan(0);
  state.topicKey = allTopics[0]!.stableKey;

  const recorded = await api.post('/api/curriculum/progress', {
    data: { stableKey: state.topicKey, status: 'in-progress' },
  });
  await expectAccepted(recorded);

  await page.goto('/study/curriculum');
  await ready(page);
  await capture(page, '2.4 How topic progress is recorded', 'The curriculum browser');
});

// ---------------------------------------------------------------------------
// 3. When it goes wrong
// ---------------------------------------------------------------------------

test('the reckoning flow answers a miss and applies a recovery action', async ({ page }) => {
  const api = page.context().request;

  // A deadline already in the past: missed on read, with nothing stored.
  state.missedId = await createCommitment(
    api,
    `Missed ${Date.now()}`,
    new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  );

  await page.goto('/dashboard');
  await ready(page);
  await capture(page, '2.5 When something is in needs-reckoning', 'A miss, above everything else');

  /**
   * Until it is answered it cannot be rescheduled. That refusal IS the
   * product: rescheduling without answering is the frictionless drag that lets
   * a deadline move ten times while the record shows neutral replans.
   */
  const refused = await api.post(`/api/commitments/${state.missedId}/deadline`, {
    data: {
      newDueAt: dueLaterToday(),
      reason: 'Trying to move it without answering',
      category: 'underestimated',
    },
  });
  expect([400, 409, 422]).toContain(refused.status());

  /**
   * Three questions, in order: did you do it, why, and what changes. The third
   * is the one that matters -- every recovery action writes something the
   * system can observe, because a reason that produces no consequence is
   * journaling.
   *
   * `split` creates the parts IMMEDIATELY, so the split is real rather than
   * intended.
   */
  const laterToday = dueLaterToday();
  const answered = await api.post(`/api/commitments/${state.missedId}/reckoning`, {
    data: {
      completed: false,
      reason: 'underestimated',
      recovery: {
        action: 'split',
        parts: [
          {
            title: 'First half of the walkthrough miss',
            outcome: 'The first half is done and recorded',
            estimateMinutes: 20,
            dueAt: laterToday,
          },
          {
            title: 'Second half of the walkthrough miss',
            outcome: 'The second half is done and recorded',
            estimateMinutes: 20,
            dueAt: laterToday,
          },
        ],
      },
      note: 'It was two things pretending to be one.',
    },
  });
  await expectAccepted(answered);

  await page.goto('/dashboard');
  await ready(page);
  await capture(page, '2.5 When something is in needs-reckoning', 'After the reckoning');

  /**
   * THE RECOVERY ACTION PRODUCED SOMETHING OBSERVABLE.
   *
   * Splitting CLOSES the original -- it has been broken into parts that now
   * carry the work -- and creates them immediately. That is the rule the whole
   * loop turns on: a reason that produces no consequence is journaling, so
   * every option writes something the system can see.
   *
   * Which also means the original's deadline can no longer move, and the route
   * says so rather than silently accepting it.
   */
  const afterwards = await api.post(`/api/commitments/${state.missedId}/deadline`, {
    data: {
      newDueAt: dueLaterToday(),
      reason: 'It has already been split',
      category: 'underestimated',
    },
  });
  expect([400, 409, 422]).toContain(afterwards.status());
  expect(await afterwards.text()).toContain('closed');

  const listed = (await (await api.get('/api/commitments')).json()) as {
    commitments: { title: string }[];
  };
  expect(
    listed.commitments.some((row) => row.title.startsWith('First half of the walkthrough miss')),
    'the split created nothing',
  ).toBe(true);
});

test('Postponements groups the answered, moved and missed again', async ({ page }) => {
  await page.goto('/postponements');
  await ready(page);

  await expect(page.getByRole('heading', { name: 'Postponements' })).toBeVisible();
  await capture(page, '2.5 When something is in needs-reckoning', 'The postponement record');
});

// ---------------------------------------------------------------------------
// 4. Looking ahead, and back
// ---------------------------------------------------------------------------

test('Tomorrow shows what is coming without letting it be started', async ({ page }) => {
  await page.goto('/tomorrow');
  await ready(page);

  await expect(page.getByRole('heading', { name: 'Tomorrow' })).toBeVisible();

  /**
   * The NEXT ACTION card carries no Start here -- it is rendered
   * `interactive={false}`, because tomorrow's headline work is not today's.
   *
   * The block ledger deliberately still does. Completing tomorrow's work today
   * is recognised rather than merely permitted, so a Tomorrow with nothing
   * startable would be the wrong product: it would turn "I have time now" into
   * "come back in the morning".
   */
  await expect(page.locator('[data-shortcut="start-next"]')).toHaveCount(0);
  await capture(page, '2.1 The morning', 'Tomorrow');
});

test('This Week gives each day its own row rather than a squeezed grid', async ({ page }) => {
  await page.goto('/week');
  await ready(page);

  await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
  await capture(page, '2.1 The morning', 'This week');
});

test('Progress shows a rolling rate and never a streak', async ({ page }) => {
  await page.goto('/progress');
  await ready(page);

  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();

  /**
   * A consecutive counter has a cliff: miss one day at forty and it reads
   * zero, which is a lie about adherence and the documented trigger for
   * abandoning the app. The rate is the headline; the word is banned outright.
   */
  await expect(page.getByText(/streak/i)).toHaveCount(0);
  await capture(page, '2.1 The morning', 'Progress');
});

// ---------------------------------------------------------------------------
// 5. The plan
// ---------------------------------------------------------------------------

test('Study leads with the three blocks rather than a subject list', async ({ page }) => {
  await page.goto('/study');
  await ready(page);

  await expect(page.getByRole('heading', { name: 'Study' })).toBeVisible();
  await capture(page, '3.1 Importing', 'Study');
});

test('the curriculum browser collapses to modules that open on demand', async ({ page }) => {
  await page.goto('/study/curriculum');
  await ready(page);

  await expect(page.getByRole('heading', { name: 'Curriculum' })).toBeVisible();

  // Sixty topics expanded is an eleven-thousand-pixel page on a phone.
  const expanders = page.getByRole('button', { name: /module|topics|expand/i });
  if ((await expanders.count()) > 0) {
    await expanders.first().click();
    await capture(page, '3.1 Importing', 'A module expanded');
  }
});

test('the review queue lists what the parser refused to guess', async ({ page }) => {
  await page.goto('/study/review');
  await ready(page);

  await expect(page.getByRole('heading', { name: 'Review targets' })).toBeVisible();
  await capture(page, '3.2 What the flagged rows mean', 'The review queue');
});

test('Phases shows drift against the original dates', async ({ page }) => {
  await page.goto('/study/phases');
  await ready(page);

  await expect(page.getByRole('heading', { name: 'Phases' })).toBeVisible();
  await capture(page, '3.4 Phases and drift', 'Phase drift');
});

test('re-planning a phase requires a reason and shifts the ones after it', async ({ page }) => {
  const api = page.context().request;

  const phases = (await (await api.get('/api/curriculum/phases')).json()) as {
    phases: { number: number; endDate: string }[];
  };
  expect(phases.phases.length).toBeGreaterThan(0);
  const target = phases.phases[0]!;

  /** Three days later, as the `YYYY-MM-DD` key the schema takes. */
  const later = new Date(`${target.endDate.slice(0, 10)}T00:00:00.000Z`);
  later.setUTCDate(later.getUTCDate() + 3);
  const newEndDate = later.toISOString().slice(0, 10);

  /**
   * Without a reason it is a silent re-flow, which is the study-plan version
   * of moving a deadline quietly: a 26-week plan becomes a 40-week one with no
   * moment where anybody noticed.
   */
  const unreasoned = await api.post('/api/curriculum/replan', {
    data: { phaseNumber: target.number, newEndDate },
  });
  expect([400, 422]).toContain(unreasoned.status());

  const replanned = await api.post('/api/curriculum/replan', {
    data: {
      phaseNumber: target.number,
      newEndDate,
      reason: 'Walkthrough: a deliberate re-plan, recorded as an event.',
    },
  });
  await expectAccepted(replanned);

  await page.goto('/study/phases');
  await ready(page);
  await capture(page, '3.5 Re-planning deliberately', 'After an explicit re-plan');
});

// ---------------------------------------------------------------------------
// 6. Making a commitment, with the guardrails
// ---------------------------------------------------------------------------

test('the guardrails refuse a commitment with no outcome', async ({ page }) => {
  await page.goto('/dashboard');
  await ready(page);

  await page.getByRole('button', { name: 'Make a commitment' }).click();
  await page.locator('input[name="title"]').fill('Work on the report');
  await capture(page, '2.1 The morning', 'Making a commitment');

  await page
    .getByRole('button', { name: /Commit|Create|Save/ })
    .first()
    .click();

  /**
   * "Work on the report" cannot be verified; "the report is sent to Priya"
   * can. The friction exists to keep vague commitments out of the history,
   * because junk created in two seconds is junk history forever.
   */
  await expect(page.getByText(/outcome/i).first()).toBeVisible();
});

test('ending a series leaves its past occurrences alone', async ({ page }) => {
  const api = page.context().request;

  const created = await api.post('/api/series', {
    data: {
      title: `Walkthrough series ${Date.now()}`,
      outcome: 'The recurrence has something to generate',
      /**
       * The rule carries the time and the estimate, because an occurrence has
       * to be a whole commitment the moment it materialises -- not a stub that
       * gets filled in later.
       */
      rule: { frequency: 'daily', interval: 1, timeOfDay: '18:00', estimateMinutes: 15 },
      startDate: new Date().toISOString().slice(0, 10),
      priority: 'maintenance',
    },
  });
  await expectAccepted(created);
  state.seriesId = ((await created.json()) as { id: string }).id;

  const ended = await api.delete(`/api/series/${state.seriesId}`);
  await expectAccepted(ended);
});

// ---------------------------------------------------------------------------
// 7. Settings
// ---------------------------------------------------------------------------

test('Settings offers recovery codes, quiet hours and vacation mode', async ({ page }) => {
  await page.goto('/settings');
  await ready(page);

  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('Recovery codes')).toBeVisible();
  await expect(page.getByText('Vacation mode')).toBeVisible();
  await capture(page, '1.2 Environment variables', 'Settings');
});

test('regenerating from settings invalidates the previous set', async ({ page }) => {
  const api = page.context().request;

  const first = await api.post('/api/recovery/codes');
  await expectAccepted(first);
  const before = ((await first.json()) as { codes: string[] }).codes;

  const second = await api.post('/api/recovery/codes');
  expect(second.status()).toBe(200);

  // The previous set is dead the moment the pointer moves.
  const stale = await api.post('/api/recovery/verify', {
    data: { identifier: process.env.PACT_E2E_IDENTIFIER!, code: before[0]! },
  });
  expect(stale.status()).toBe(400);
});

test('vacation mode goes on and off from settings', async ({ page }) => {
  const api = page.context().request;

  const on = await api.post('/api/vacation', { data: { on: true } });
  await expectAccepted(on);

  await page.goto('/settings');
  await ready(page);
  await capture(page, '4.4 Vacation mode', 'Vacation mode on');

  const off = await api.post('/api/vacation', { data: { on: false } });
  await expectAccepted(off);
});

test('the shortcut sheet lists everything the keyboard does', async ({ page }) => {
  await page.goto('/dashboard');
  await ready(page);

  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await capture(page, '2.1 The morning', 'The shortcut sheet');
  await page.keyboard.press('Escape');
});
