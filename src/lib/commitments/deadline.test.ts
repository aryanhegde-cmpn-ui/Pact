import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  commitments: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
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
