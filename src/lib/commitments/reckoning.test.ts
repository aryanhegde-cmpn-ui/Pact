import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-memory commitments and event log.
 *
 * The event mock enforces the same unique key the real index does --
 * (entityId, type, ts) for once-per-entity types -- because reckoning
 * idempotency rests on it and a mock that always succeeds would prove nothing.
 */
const store = vi.hoisted(() => ({
  commitments: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  cancelled: [] as string[],
  enqueued: [] as string[],
}));

const ONCE_PER_ENTITY = ['DEADLINE_MISSED', 'RECKONING_SUBMITTED'];

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ APP_TIMEZONE: 'Asia/Kolkata' }),
  EnvironmentError: class extends Error {},
}));

vi.mock('@/lib/db/models/commitment', () => ({
  CommitmentModel: {
    findOne: (query: { _id: string; ownerId?: string }) => ({
      lean: async () =>
        store.commitments.find(
          (c) =>
            String(c._id) === String(query._id) &&
            (query.ownerId === undefined || c.ownerId === query.ownerId),
        ) ?? null,
    }),
    updateOne: async (
      filter: { _id: string; ownerId?: string },
      update: { $set: Record<string, unknown> },
    ) => {
      const row = store.commitments.find(
        (c) =>
          String(c._id) === String(filter._id) &&
          (filter.ownerId === undefined || c.ownerId === filter.ownerId),
      );
      if (row) Object.assign(row, update.$set);
      return { modifiedCount: row ? 1 : 0 };
    },
    create: async (doc: Record<string, unknown>) => {
      const saved = { ...doc, _id: `new-${store.commitments.length + 1}` };
      store.commitments.push(saved);
      return saved;
    },
  },
}));

vi.mock('@/lib/db/events', () => ({
  appendEvent: async (event: Record<string, unknown>) => {
    const ts = (event.ts as Date) ?? new Date();
    if (ONCE_PER_ENTITY.includes(event.type as string)) {
      const clash = store.events.some(
        (e) =>
          e.entityId === event.entityId &&
          e.type === event.type &&
          (e.ts as Date).getTime() === ts.getTime(),
      );
      if (clash) return { appended: false, type: event.type };
    }
    store.events.push({ ...event, ts });
    return { appended: true, type: event.type };
  },
  readEntityEvents: async (entityId: string, _ownerId?: string) =>
    store.events
      .filter((e) => e.entityId === entityId)
      .map((e) => ({
        ts: e.ts as Date,
        type: e.type as string,
        payload: (e.payload ?? {}) as Record<string, unknown>,
        source: 'user',
      })),
}));

vi.mock('@/lib/notifications/queue', () => ({
  cancelPendingForCommitment: async (id: string) => {
    store.cancelled.push(id);
    return 0;
  },
  enqueueForCommitment: async (commitment: { id: string }) => {
    store.enqueued.push(commitment.id);
    return { created: 3, revived: 0, duplicates: 0 };
  },
  reenqueueForCommitment: async (commitment: { id: string }) => {
    store.enqueued.push(commitment.id);
    return { cancelled: 3, created: 3, revived: 0, duplicates: 0 };
  },
}));

vi.mock('@/lib/notifications/settings', () => ({
  getSettings: async (_ownerId?: string) => ({
    quietHoursStart: '00:00',
    quietHoursEnd: '07:00',
    dailyReviewAt: '07:30',
    defaultLeadMinutes: 30,
    disabledTypes: [],
    shareNotesWithOverseer: false,
    lastDispatchAt: null,
  }),
}));

const { submitReckoning } = await import('./reckoning');
const { changeDeadline } = await import('./deadline');

const DUE = new Date('2026-09-05T12:00:00.000Z');
const NOW = new Date('2026-09-05T18:00:00.000Z');
/** Every scoped query filters on this. */
const OWNER = 'owner-1';

function seedCommitment(overrides: Record<string, unknown> = {}) {
  store.commitments.push({
    _id: 'c1',
    ownerId: OWNER,
    title: 'Ship the report',
    outcome: 'The report is sent to Priya',
    dueAt: DUE,
    originalDueAt: DUE,
    estimateMinutes: 90,
    status: 'pending',
    priority: 'must-win',
    nextAction: null,
    ...overrides,
  });
}

const eventsOfType = (type: string) => store.events.filter((e) => e.type === type);
const commitment = () => store.commitments.find((c) => c._id === 'c1');

beforeEach(() => {
  store.commitments = [];
  store.events = [];
  store.cancelled = [];
  store.enqueued = [];
  seedCommitment();
});

describe('an unreckoned miss cannot be rescheduled', () => {
  it('refuses changeDeadline while the miss is unanswered', async () => {
    await expect(
      changeDeadline(
        'c1',
        { newDueAt: new Date('2026-09-09T12:00:00Z'), reason: 'later', category: 'underestimated' },
        OWNER,
        NOW,
      ),
    ).rejects.toThrow(/not been reckoned with/);
  });

  it('names the reason in a way that says what to do next', async () => {
    try {
      await changeDeadline(
        'c1',
        { newDueAt: new Date('2026-09-09T12:00:00Z'), reason: 'later', category: 'avoidance' },
        OWNER,
        NOW,
      );
    } catch (error) {
      expect((error as { code: string }).code).toBe('needs-reckoning');
    }
  });

  it('ALLOWS rescheduling once it has been reckoned with', async () => {
    await submitReckoning(
      'c1',
      {
        completed: false,
        reason: 'underestimated',
        recovery: { action: 'reduce-scope', newOutcome: 'A draft exists', newEstimateMinutes: 30 },
      },
      OWNER,
      NOW,
    );

    await expect(
      changeDeadline(
        'c1',
        {
          newDueAt: new Date('2026-09-09T12:00:00Z'),
          reason: 'replanned',
          category: 'deliberate-replan',
        },
        OWNER,
        NOW,
      ),
    ).resolves.toBeDefined();
  });

  it('does not block a commitment that is not yet due', async () => {
    store.commitments = [];
    seedCommitment({
      dueAt: new Date('2026-12-01T00:00:00Z'),
      originalDueAt: new Date('2026-12-01T00:00:00Z'),
    });

    await expect(
      changeDeadline(
        'c1',
        {
          newDueAt: new Date('2026-12-05T00:00:00Z'),
          reason: 'replan',
          category: 'deliberate-replan',
        },
        OWNER,
        NOW,
      ),
    ).resolves.toBeDefined();
  });

  it('blocks again after being rescheduled and missed a second time', async () => {
    await submitReckoning(
      'c1',
      {
        completed: false,
        reason: 'forgot',
        recovery: { action: 'schedule-start-session', startAt: NOW },
      },
      OWNER,
      NOW,
    );

    const second = new Date('2026-09-09T12:00:00.000Z');
    await changeDeadline(
      'c1',
      { newDueAt: second, reason: 'replan', category: 'deliberate-replan' },
      OWNER,
      NOW,
    );

    // Missed again. The earlier reckoning answered a different deadline.
    const later = new Date('2026-09-09T18:00:00.000Z');
    await expect(
      changeDeadline(
        'c1',
        { newDueAt: new Date('2026-09-12T12:00:00Z'), reason: 'again', category: 'avoidance' },
        OWNER,
        later,
      ),
    ).rejects.toThrow(/not been reckoned with/);
  });
});

describe('step 1 — it was actually done, late', () => {
  it('records the REAL completion time, not the submission time', async () => {
    const actuallyFinished = new Date('2026-09-05T14:30:00.000Z');

    await submitReckoning('c1', { completed: true, completedAt: actuallyFinished }, OWNER, NOW);

    expect(commitment()?.completedAt).toEqual(actuallyFinished);
    const completion = eventsOfType('COMMITMENT_COMPLETED')[0];
    expect(completion?.ts).toEqual(actuallyFinished);
  });

  it('records it as LATE, never as on time', async () => {
    await submitReckoning(
      'c1',
      { completed: true, completedAt: new Date('2026-09-05T14:30:00.000Z') },
      OWNER,
      NOW,
    );

    const payload = eventsOfType('COMMITMENT_COMPLETED')[0]?.payload as Record<string, unknown>;
    expect(payload.lateAgainstDueAt).toBe(true);
    expect(payload.lateAgainstOriginal).toBe(true);
    expect(payload.minutesLate).toBe(150);
  });

  it('marks it done and stops its notifications', async () => {
    await submitReckoning('c1', { completed: true }, OWNER, NOW);

    expect(commitment()?.status).toBe('done');
    expect(store.cancelled).toContain('c1');
  });

  it('needs no reason or recovery when it was completed', async () => {
    await expect(submitReckoning('c1', { completed: true }, OWNER, NOW)).resolves.toMatchObject({
      recorded: true,
    });
  });
});

describe('step 3 — every recovery produces a system effect', () => {
  it('reduce-scope rewrites the outcome and the estimate', async () => {
    await submitReckoning(
      'c1',
      {
        completed: false,
        reason: 'underestimated',
        recovery: {
          action: 'reduce-scope',
          newOutcome: 'A rough draft exists',
          newEstimateMinutes: 25,
        },
      },
      OWNER,
      NOW,
    );

    expect(commitment()).toMatchObject({ outcome: 'A rough draft exists', estimateMinutes: 25 });
  });

  it('split creates the parts NOW and closes the original', async () => {
    await submitReckoning(
      'c1',
      {
        completed: false,
        reason: 'underestimated',
        recovery: {
          action: 'split',
          parts: [
            {
              title: 'Outline',
              outcome: 'An outline exists',
              estimateMinutes: 30,
              dueAt: new Date('2026-09-06T12:00:00Z'),
            },
            {
              title: 'Draft',
              outcome: 'A draft exists',
              estimateMinutes: 60,
              dueAt: new Date('2026-09-07T12:00:00Z'),
            },
          ],
        },
      },
      OWNER,
      NOW,
    );

    // Created, not planned: a split producing no documents is an intention.
    expect(store.commitments).toHaveLength(3);
    expect(commitment()?.status).toBe('abandoned');
    expect(commitment()?.splitInto).toHaveLength(2);
    // The new parts get their own notifications.
    expect(store.enqueued).toHaveLength(2);
  });

  it('define-next-action sets the field that unblocks rescheduling', async () => {
    await submitReckoning(
      'c1',
      {
        completed: false,
        reason: 'too-vague',
        recovery: { action: 'define-next-action', nextAction: 'List the three sections' },
      },
      OWNER,
      NOW,
    );

    expect(commitment()?.nextAction).toBe('List the three sections');
  });

  it('define-starting-action caps the estimate at the starting size', async () => {
    await submitReckoning(
      'c1',
      {
        completed: false,
        reason: 'didnt-know-how-to-start',
        recovery: {
          action: 'define-starting-action',
          nextAction: 'Open the doc and write one line',
          startingMinutes: 20,
        },
      },
      OWNER,
      NOW,
    );

    // A 20-minute start you will begin beats a 90-minute block you will not.
    expect(commitment()).toMatchObject({
      estimateMinutes: 20,
      nextAction: 'Open the doc and write one line',
    });
  });

  it('schedule-start-session creates a real 15-minute commitment today', async () => {
    await submitReckoning(
      'c1',
      {
        completed: false,
        reason: 'avoided',
        recovery: { action: 'schedule-start-session', startAt: new Date('2026-09-05T19:00:00Z') },
      },
      OWNER,
      NOW,
    );

    const session = store.commitments.find((c) => c.startSessionFor === 'c1');
    expect(session).toMatchObject({ estimateMinutes: 15 });
    expect(eventsOfType('SESSION_SCHEDULED')).toHaveLength(1);
    expect(store.enqueued).toContain(String(session?._id));
  });

  it('mark-blocked sets the status, the person and the follow-up date', async () => {
    const followUp = new Date('2026-09-08T09:00:00.000Z');

    await submitReckoning(
      'c1',
      {
        completed: false,
        reason: 'waiting-on-someone',
        recovery: { action: 'mark-blocked', blockedOn: 'Priya', followUpDate: followUp },
      },
      OWNER,
      NOW,
    );

    // "Blocked" with nobody named is a status change that changes nothing.
    expect(commitment()).toMatchObject({
      status: 'blocked',
      blockedOn: 'Priya',
      followUpDate: followUp,
    });
  });

  it('lower-quality-bar replaces the outcome with the smaller one', async () => {
    await submitReckoning(
      'c1',
      {
        completed: false,
        reason: 'perfectionism',
        recovery: {
          action: 'lower-quality-bar',
          newOutcome: 'A serviceable draft is sent, unpolished',
        },
      },
      OWNER,
      NOW,
    );

    expect(commitment()?.outcome).toBe('A serviceable draft is sent, unpolished');
  });

  it('abandon closes it with the reason recorded', async () => {
    await submitReckoning(
      'c1',
      {
        completed: false,
        reason: 'not-important',
        recovery: { action: 'abandon', abandonReason: 'Overtaken by events' },
      },
      OWNER,
      NOW,
    );

    expect(commitment()?.status).toBe('abandoned');
    expect(
      (eventsOfType('COMMITMENT_ABANDONED')[0]?.payload as Record<string, unknown>).reason,
    ).toBe('Overtaken by events');
    expect(store.cancelled).toContain('c1');
  });

  it('link-displacing-commitment records what took priority', async () => {
    await submitReckoning(
      'c1',
      {
        completed: false,
        reason: 'higher-priority-appeared',
        recovery: { action: 'link-displacing-commitment', displacedBy: 'other-commitment-id' },
      },
      OWNER,
      NOW,
    );

    expect(commitment()?.displacedBy).toBe('other-commitment-id');
  });

  it('emits both events with the full payload', async () => {
    await submitReckoning(
      'c1',
      {
        completed: false,
        reason: 'avoided',
        note: 'kept opening other tabs',
        recovery: { action: 'schedule-start-session', startAt: NOW },
      },
      OWNER,
      NOW,
    );

    const submitted = eventsOfType('RECKONING_SUBMITTED')[0]?.payload as Record<string, unknown>;
    expect(submitted).toMatchObject({ reason: 'avoided', note: 'kept opening other tabs' });

    const selected = eventsOfType('RECOVERY_ACTION_SELECTED')[0]?.payload as Record<
      string,
      unknown
    >;
    expect(selected).toMatchObject({ action: 'schedule-start-session', reason: 'avoided' });
  });
});

describe('the reckoning is idempotent', () => {
  it('records once under a double submission', async () => {
    const submission = {
      completed: false,
      reason: 'forgot' as const,
      recovery: { action: 'define-next-action' as const, nextAction: 'Draft the intro' },
    };

    const first = await submitReckoning('c1', submission, OWNER, NOW);
    const second = await submitReckoning('c1', submission, OWNER, NOW);

    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    expect(eventsOfType('RECKONING_SUBMITTED')).toHaveLength(1);
    // And the recovery is not applied twice.
    expect(eventsOfType('RECOVERY_ACTION_SELECTED')).toHaveLength(1);
  });

  it('does not double-create on a repeated split', async () => {
    const submission = {
      completed: false,
      reason: 'underestimated' as const,
      recovery: {
        action: 'split' as const,
        parts: [
          {
            title: 'A',
            outcome: 'A done',
            estimateMinutes: 15,
            dueAt: new Date('2026-09-06T12:00:00Z'),
          },
          {
            title: 'B',
            outcome: 'B done',
            estimateMinutes: 15,
            dueAt: new Date('2026-09-07T12:00:00Z'),
          },
        ],
      },
    };

    await submitReckoning('c1', submission, OWNER, NOW);
    await submitReckoning('c1', submission, OWNER, NOW).catch(() => undefined);

    // Two parts, not four.
    expect(store.commitments.filter((c) => String(c._id).startsWith('new-'))).toHaveLength(2);
  });

  it('is a quiet no-op on re-submission, not an error', async () => {
    // The second half of a double tap must not surface an error over a form
    // the user already submitted successfully.
    const submission = {
      completed: false,
      reason: 'forgot' as const,
      recovery: { action: 'define-next-action' as const, nextAction: 'Draft the intro' },
    };
    await submitReckoning('c1', submission, OWNER, NOW);

    await expect(submitReckoning('c1', submission, OWNER, NOW)).resolves.toMatchObject({
      recorded: false,
    });
  });

  it('refuses a reckoning for a commitment that was never missed', async () => {
    store.commitments = [];
    seedCommitment({ dueAt: new Date('2026-12-01T00:00:00Z') });

    await expect(
      submitReckoning(
        'c1',
        {
          completed: false,
          reason: 'forgot',
          recovery: { action: 'define-next-action', nextAction: 'x' },
        },
        OWNER,
        NOW,
      ),
    ).rejects.toThrow(/not awaiting a reckoning/);
  });
});

describe('a missed, reckoned, rescheduled, missed-again commitment', () => {
  it('produces two full reckoning records', async () => {
    await submitReckoning(
      'c1',
      {
        completed: false,
        reason: 'underestimated',
        recovery: { action: 'reduce-scope', newOutcome: 'Smaller', newEstimateMinutes: 30 },
      },
      OWNER,
      NOW,
    );

    const second = new Date('2026-09-09T12:00:00.000Z');
    await changeDeadline(
      'c1',
      { newDueAt: second, reason: 'replan', category: 'deliberate-replan' },
      OWNER,
      NOW,
    );

    const later = new Date('2026-09-09T18:00:00.000Z');
    await submitReckoning(
      'c1',
      {
        completed: false,
        reason: 'avoided',
        recovery: { action: 'schedule-start-session', startAt: later },
      },
      OWNER,
      later,
    );

    const reckonings = eventsOfType('RECKONING_SUBMITTED');
    expect(reckonings).toHaveLength(2);
    // Each keyed to the deadline it answered.
    expect(reckonings.map((r) => (r.ts as Date).toISOString()).sort()).toEqual([
      DUE.toISOString(),
      second.toISOString(),
    ]);
    expect(eventsOfType('RECOVERY_ACTION_SELECTED')).toHaveLength(2);
  });
});
