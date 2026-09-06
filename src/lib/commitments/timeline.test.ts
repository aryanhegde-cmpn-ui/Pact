import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  commitments: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));
vi.mock('@/lib/db/models/commitment', () => ({
  CommitmentModel: {
    findById: (id: string) => ({
      lean: async () => store.commitments.find((c) => String(c._id) === String(id)) ?? null,
    }),
    find: () => ({ lean: async () => store.commitments }),
  },
}));
vi.mock('@/lib/db/models/event', () => ({
  EventModel: {
    aggregate: async () => [],
    find: () => ({ sort: () => ({ lean: async () => store.events }) }),
  },
}));
vi.mock('@/lib/db/events', () => ({
  readEntityEvents: async (entityId: string) =>
    store.events
      .filter((e) => e.entityId === entityId)
      .map((e) => ({
        ts: e.ts as Date,
        type: e.type as string,
        payload: (e.payload ?? {}) as Record<string, unknown>,
        source: 'user',
      })),
}));

const { buildTimeline } = await import('./timeline');

const DEADLINE = new Date('2026-09-05T12:00:00.000Z');

beforeEach(() => {
  store.commitments = [
    {
      _id: 'c1',
      title: 'Ship the report',
      dueAt: DEADLINE,
      originalDueAt: DEADLINE,
    },
  ];
  store.events = [];
});

function event(type: string, ts: string, payload: Record<string, unknown> = {}) {
  store.events.push({ entityId: 'c1', type, ts: new Date(ts), payload });
}

describe('buildTimeline ordering', () => {
  it('renders the sequence in the order things HAPPENED', async () => {
    // Written deliberately out of order, and with the timestamps the real
    // system produces: a miss and its reckoning are stamped at the DEADLINE,
    // not at the moment they were observed or submitted.
    event('COMMITMENT_CREATED', '2026-09-04T09:00:00Z');
    event('DEADLINE_SET', '2026-09-04T09:00:00Z', { dueAt: DEADLINE.toISOString() });
    event('DEADLINE_MISSED', DEADLINE.toISOString(), {
      noticedAt: '2026-09-05T18:00:00Z',
    });
    event('RECKONING_SUBMITTED', DEADLINE.toISOString(), {
      reason: 'too-vague',
      submittedAt: '2026-09-05T18:05:00Z',
    });
    event('RECOVERY_ACTION_SELECTED', '2026-09-05T18:05:01Z', { action: 'define-next-action' });

    const timeline = await buildTimeline('c1');
    const types = timeline.entries.map((entry) => entry.type);

    // Sorting by `ts` would put the reckoning before the commitment was even
    // created, which is exactly what this guards against.
    expect(types).toEqual([
      'COMMITMENT_CREATED',
      'DEADLINE_SET',
      'DEADLINE_MISSED',
      'RECKONING_SUBMITTED',
      'RECOVERY_ACTION_SELECTED',
    ]);
  });

  it('displays each entry at its occurrence time, so the column reads monotonically', async () => {
    event('COMMITMENT_CREATED', '2026-09-04T09:00:00Z');
    event('DEADLINE_MISSED', DEADLINE.toISOString(), { noticedAt: '2026-09-05T18:00:00Z' });

    const timeline = await buildTimeline('c1');
    const stamps = timeline.entries.map((entry) => entry.ts);

    expect(stamps).toEqual([...stamps].sort());
  });

  it('never renders a late completion as on time', async () => {
    event('COMMITMENT_COMPLETED', '2026-09-05T14:30:00Z', {
      lateAgainstDueAt: true,
      minutesLate: 150,
    });

    const [entry] = (await buildTimeline('c1')).entries;

    expect(entry?.line).toContain('late');
    expect(entry?.line).not.toBe('Completed on time');
    expect(entry?.significant).toBe(true);
  });

  it('renders an on-time completion plainly', async () => {
    event('COMMITMENT_COMPLETED', '2026-09-05T11:00:00Z', { lateAgainstDueAt: false });

    expect((await buildTimeline('c1')).entries[0]?.line).toBe('Completed on time');
  });

  it('shows the category and the drift on a deadline change', async () => {
    event('DEADLINE_CHANGED', '2026-09-05T10:00:00Z', {
      to: '2026-09-09T12:00:00Z',
      category: 'avoidance',
      reason: 'Kept putting it off',
      deltaDaysFromPrevious: 4,
    });

    const [entry] = (await buildTimeline('c1')).entries;

    expect(entry?.line).toContain('Avoidance');
    expect(entry?.line).toContain('+4d');
    expect(entry?.line).toContain('Kept putting it off');
  });
});
