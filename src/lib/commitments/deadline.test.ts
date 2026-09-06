import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  commitments: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  notifications: [] as Record<string, unknown>[],
}));

const findById = (id: string) =>
  store.commitments.find((row) => String(row._id) === String(id)) ?? null;

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));

vi.mock('@/lib/db/models/commitment', () => ({
  CommitmentModel: {
    findById: (id: string) => ({ lean: async () => findById(id) }),
    updateOne: async (filter: { _id: string }, update: { $set: Record<string, unknown> }) => {
      // Mirrors the model's immutability guard.
      if ('originalDueAt' in update.$set) {
        throw new Error('originalDueAt is written once at creation and never again.');
      }
      const row = findById(filter._id);
      if (row) Object.assign(row, update.$set);
      return { modifiedCount: 1 };
    },
  },
}));

vi.mock('@/lib/env', () => ({
  getEnv: () => ({ APP_TIMEZONE: 'Asia/Kolkata' }),
  EnvironmentError: class extends Error {},
}));

vi.mock('@/lib/db/models/settings', () => ({
  SettingsModel: {
    findOneAndUpdate: () => ({
      lean: async () => ({
        quietHoursStart: '00:00',
        quietHoursEnd: '07:00',
        dailyReviewAt: '07:30',
        defaultLeadMinutes: 30,
      }),
    }),
  },
}));

/**
 * In-memory notifications, enforcing the same unique index the real collection
 * has on (commitmentId, type, scheduledFor, channel). The queue module itself
 * is deliberately NOT mocked -- whether a deadline change actually cancels and
 * re-enqueues is the behaviour under test.
 */
vi.mock('@/lib/db/models/notification', () => ({
  NotificationModel: {
    create: async (doc: Record<string, unknown>) => {
      const clash = store.notifications.some(
        (row) =>
          row.commitmentId === doc.commitmentId &&
          row.type === doc.type &&
          (row.scheduledFor as Date).getTime() === (doc.scheduledFor as Date).getTime() &&
          row.channel === doc.channel,
      );
      if (clash) {
        const error = new Error('E11000 duplicate key') as Error & { code: number };
        error.code = 11000;
        throw error;
      }
      store.notifications.push({ ...doc, _id: `n${store.notifications.length + 1}` });
      return doc;
    },
    updateOne: async (
      filter: {
        commitmentId: string;
        type: string;
        scheduledFor: Date;
        channel: string;
        status?: { $ne: string };
      },
      update: { $set: Record<string, unknown> },
    ) => {
      const row = store.notifications.find(
        (r) =>
          r.commitmentId === filter.commitmentId &&
          r.type === filter.type &&
          (r.scheduledFor as Date).getTime() === filter.scheduledFor.getTime() &&
          r.channel === filter.channel &&
          (!filter.status || r.status !== filter.status.$ne),
      );
      if (!row) return { modifiedCount: 0 };
      Object.assign(row, update.$set);
      return { modifiedCount: 1 };
    },
    updateMany: async (
      filter: { commitmentId: string; status: string },
      update: { $set: Record<string, unknown> },
    ) => {
      let modifiedCount = 0;
      for (const row of store.notifications) {
        if (row.commitmentId === filter.commitmentId && row.status === filter.status) {
          Object.assign(row, update.$set);
          modifiedCount += 1;
        }
      }
      return { modifiedCount };
    },
  },
}));

vi.mock('@/lib/db/events', () => ({
  appendEvent: async (event: Record<string, unknown>) => {
    store.events.push(event);
    return { appended: true, type: event.type };
  },
}));

const { changeDeadline, DeadlineError } = await import('./deadline');

const ORIGINAL = new Date('2026-09-05T12:00:00.000Z');
const NOW = new Date('2026-09-05T08:00:00.000Z');

beforeEach(() => {
  store.commitments = [
    {
      _id: 'c1',
      title: 'Ship the report',
      dueAt: ORIGINAL,
      originalDueAt: ORIGINAL,
      status: 'pending',
    },
  ];
  store.events = [];
  store.notifications = [];
});

describe('changeDeadline', () => {
  it('moves dueAt', async () => {
    const later = new Date('2026-09-07T12:00:00.000Z');
    await changeDeadline('c1', { newDueAt: later, reason: 'Blocked on review' }, NOW);

    expect(findById('c1')?.dueAt).toEqual(later);
  });

  it('never touches originalDueAt', async () => {
    await changeDeadline(
      'c1',
      { newDueAt: new Date('2026-09-07T12:00:00.000Z'), reason: 'Blocked' },
      NOW,
    );

    // The number the whole postponement history is measured against.
    expect(findById('c1')?.originalDueAt).toEqual(ORIGINAL);
  });

  it('requires a reason', async () => {
    await expect(
      changeDeadline('c1', { newDueAt: new Date('2026-09-07T12:00:00Z'), reason: '' }, NOW),
    ).rejects.toThrow();
    await expect(
      changeDeadline('c1', { newDueAt: new Date('2026-09-07T12:00:00Z'), reason: '   ' }, NOW),
    ).rejects.toThrow();
  });

  it('logs the change against the original, with a direction', async () => {
    const later = new Date('2026-09-07T12:00:00.000Z');
    await changeDeadline('c1', { newDueAt: later, reason: 'Blocked on review' }, NOW);

    const event = store.events.find((e) => e.type === 'DEADLINE_CHANGED');
    expect(event?.payload).toMatchObject({
      from: ORIGINAL.toISOString(),
      to: later.toISOString(),
      originalDueAt: ORIGINAL.toISOString(),
      reason: 'Blocked on review',
      direction: 'later',
    });
  });

  it('distinguishes pulling a deadline forward from pushing it back', async () => {
    await changeDeadline(
      'c1',
      { newDueAt: new Date('2026-09-04T12:00:00Z'), reason: 'Finishing early' },
      NOW,
    );

    expect((store.events[0]?.payload as { direction: string }).direction).toBe('earlier');
  });

  it('accumulates one event per move, so drift is auditable', async () => {
    await changeDeadline('c1', { newDueAt: new Date('2026-09-06T12:00:00Z'), reason: 'a' }, NOW);
    await changeDeadline('c1', { newDueAt: new Date('2026-09-07T12:00:00Z'), reason: 'b' }, NOW);
    await changeDeadline('c1', { newDueAt: new Date('2026-09-08T12:00:00Z'), reason: 'c' }, NOW);

    const changes = store.events.filter((e) => e.type === 'DEADLINE_CHANGED');
    expect(changes).toHaveLength(3);
    // Every one still measured against the deadline first committed to.
    for (const change of changes) {
      expect((change.payload as { originalDueAt: string }).originalDueAt).toBe(
        ORIGINAL.toISOString(),
      );
    }
  });

  it('is a no-op when the deadline has not actually moved', async () => {
    await changeDeadline('c1', { newDueAt: ORIGINAL, reason: 'no change' }, NOW);

    // A non-move is not a postponement and must not pollute the history.
    expect(store.events).toHaveLength(0);
  });

  it('refuses to move the deadline of a closed commitment', async () => {
    for (const status of ['done', 'abandoned']) {
      store.commitments[0]!.status = status;

      await expect(
        changeDeadline('c1', { newDueAt: new Date('2026-09-09T12:00:00Z'), reason: 'x' }, NOW),
      ).rejects.toThrow(DeadlineError);
    }
  });

  it('rejects an unknown commitment', async () => {
    await expect(
      changeDeadline('nope', { newDueAt: new Date('2026-09-09T12:00:00Z'), reason: 'x' }, NOW),
    ).rejects.toThrow(DeadlineError);
  });
});

describe('the notification queue follows the deadline', () => {
  const pending = () => store.notifications.filter((n) => n.status === 'pending');
  const cancelled = () => store.notifications.filter((n) => n.status === 'cancelled');

  async function queueInitial(): Promise<void> {
    const { enqueueForCommitment } = await import('@/lib/notifications/queue');
    await enqueueForCommitment(
      {
        id: 'c1',
        title: 'Ship the report',
        outcome: 'It is sent',
        dueAt: ORIGINAL,
        estimateMinutes: 60,
        priority: 'must-win',
      },
      {
        quietHoursStart: '00:00',
        quietHoursEnd: '07:00',
        dailyReviewAt: '07:30',
        defaultLeadMinutes: 30,
      },
      'Asia/Kolkata',
      NOW,
    );
  }

  it('cancels the old notifications and enqueues against the new deadline', async () => {
    await queueInitial();
    expect(pending()).toHaveLength(3);

    const later = new Date('2026-09-07T12:00:00.000Z');
    await changeDeadline('c1', { newDueAt: later, reason: 'Blocked' }, NOW);

    // The three queued against the OLD deadline are cancelled...
    expect(cancelled()).toHaveLength(3);
    for (const row of cancelled()) {
      expect((row.scheduledFor as Date).getTime()).toBeLessThan(later.getTime() - 3_600_000);
    }

    // ...and three fresh ones exist against the new deadline.
    expect(pending()).toHaveLength(3);
  });

  it('points DEADLINE_NOW at exactly the new deadline', async () => {
    await queueInitial();
    const later = new Date('2026-09-07T12:00:00.000Z');

    await changeDeadline('c1', { newDueAt: later, reason: 'Blocked' }, NOW);

    const now_ = pending().find((n) => n.type === 'DEADLINE_NOW');
    expect((now_?.scheduledFor as Date).toISOString()).toBe(later.toISOString());
  });

  it('leaves NOTHING pending that points at the old deadline', async () => {
    await queueInitial();
    const later = new Date('2026-09-07T12:00:00.000Z');

    await changeDeadline('c1', { newDueAt: later, reason: 'Blocked' }, NOW);

    // The quiet failure this guards against: a stale DEADLINE_APPROACHING
    // firing about a deadline that no longer exists.
    const stale = pending().filter(
      (n) => (n.scheduledFor as Date).getTime() < ORIGINAL.getTime() + 60_000,
    );
    expect(stale).toEqual([]);
  });

  it('does not touch the queue when the deadline has not moved', async () => {
    await queueInitial();
    const before = store.notifications.map((n) => ({ ...n }));

    await changeDeadline('c1', { newDueAt: ORIGINAL, reason: 'no change' }, NOW);

    expect(store.notifications).toEqual(before);
  });

  it('revives cancelled rows rather than leaving nothing pending', async () => {
    await queueInitial();
    const later = new Date('2026-09-07T12:00:00.000Z');
    await changeDeadline('c1', { newDueAt: later, reason: 'a' }, NOW);

    const { reenqueueForCommitment } = await import('@/lib/notifications/queue');
    const result = await reenqueueForCommitment(
      {
        id: 'c1',
        title: 'Ship the report',
        outcome: 'It is sent',
        dueAt: later,
        estimateMinutes: 60,
        priority: 'must-win',
      },
      {
        quietHoursStart: '00:00',
        quietHoursEnd: '07:00',
        dailyReviewAt: '07:30',
        defaultLeadMinutes: 30,
      },
      'Asia/Kolkata',
      NOW,
    );

    // Cancelling leaves the rows in place and the unique key ignores status, so
    // the re-enqueue collides with what it just cancelled. Counting that as
    // "already queued" left the commitment with nothing pending at all.
    expect(result.revived).toBe(3);
    expect(pending()).toHaveLength(3);
  });

  it('still has live notifications after a deadline moves and moves back', async () => {
    await queueInitial();
    const later = new Date('2026-09-07T12:00:00.000Z');

    await changeDeadline('c1', { newDueAt: later, reason: 'slipped' }, NOW);
    await changeDeadline('c1', { newDueAt: ORIGINAL, reason: 'back on track' }, NOW);

    // The realistic route into the bug: every row for the original deadline had
    // been cancelled, so recreating them collided and produced silence.
    expect(pending()).toHaveLength(3);
    const deadlineNow = pending().find((n) => n.type === 'DEADLINE_NOW');
    expect((deadlineNow?.scheduledFor as Date).toISOString()).toBe(ORIGINAL.toISOString());
  });

  it('never resurrects a notification the user has already been sent', async () => {
    await queueInitial();
    // Pretend the approaching notice already went out.
    const sent = store.notifications.find((n) => n.type === 'DEADLINE_APPROACHING');
    Object.assign(sent!, { status: 'sent', sentAt: NOW });

    const { enqueueForCommitment } = await import('@/lib/notifications/queue');
    const result = await enqueueForCommitment(
      {
        id: 'c1',
        title: 'Ship the report',
        outcome: 'It is sent',
        dueAt: ORIGINAL,
        estimateMinutes: 60,
        priority: 'must-win',
      },
      {
        quietHoursStart: '00:00',
        quietHoursEnd: '07:00',
        dailyReviewAt: '07:30',
        defaultLeadMinutes: 30,
      },
      'Asia/Kolkata',
      NOW,
    );

    // Re-sending something already seen is worse than not sending it.
    expect(result.duplicates).toBeGreaterThan(0);
    expect(sent!.status).toBe('sent');
  });
});
