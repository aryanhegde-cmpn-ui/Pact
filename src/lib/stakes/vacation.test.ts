import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeCollection } from '@/test/fake-collection';

const store = vi.hoisted(() => ({
  vacations: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ APP_TIMEZONE: 'Asia/Kolkata' }),
  EnvironmentError: class extends Error {},
}));
vi.mock('@/lib/db/models/vacation', () => ({
  // The real unique partial index: one open period per owner.
  VacationModel: fakeCollection(store.vacations, { uniqueBy: ['ownerId', 'endedAt'] }),
}));
vi.mock('@/lib/db/events', () => ({
  appendEvent: async (event: Record<string, unknown>) => {
    store.events.push(event);
    return { appended: true, type: event.type };
  },
}));

const { getVacationState, setVacation, vacationDaysBetween } = await import('./vacation');

const OWNER = 'owner-1';
const NOW = new Date('2026-09-10T09:00:00.000Z');

beforeEach(() => {
  store.vacations.length = 0;
  store.events = [];
});

describe('turning it on and off', () => {
  it('opens a period and records it', async () => {
    const state = await setVacation({ on: true }, OWNER, NOW);

    expect(state.on).toBe(true);
    expect(store.events.map((event) => event.type)).toEqual(['VACATION_STARTED']);
  });

  it('is idempotent: asking for a state you are in is not a second period', async () => {
    await setVacation({ on: true }, OWNER, NOW);
    await setVacation({ on: true }, OWNER, NOW);

    expect(store.vacations).toHaveLength(1);
    expect(store.events).toHaveLength(1);
  });

  it('closes the period and records that too', async () => {
    await setVacation({ on: true }, OWNER, NOW);
    const ended = new Date('2026-09-13T09:00:00.000Z');

    const state = await setVacation({ on: false }, OWNER, ended);

    expect(state.on).toBe(false);
    expect(store.events.map((event) => event.type)).toEqual(['VACATION_STARTED', 'VACATION_ENDED']);
  });

  it('turning it off when it is already off does nothing', async () => {
    await setVacation({ on: false }, OWNER, NOW);

    expect(store.events).toEqual([]);
  });

  it('records both edges so the exclusion is auditable', async () => {
    /**
     * The events are what make the adherence exclusion checkable after the
     * fact. Without them, "these nine days did not count" is a claim with
     * nothing behind it.
     */
    await setVacation({ on: true }, OWNER, NOW);
    await setVacation({ on: false }, OWNER, new Date('2026-09-13T09:00:00.000Z'));

    expect(store.events[1]?.payload).toMatchObject({ days: 3 });
  });

  it('does not erase the period when it ends', async () => {
    await setVacation({ on: true }, OWNER, NOW);
    await setVacation({ on: false }, OWNER, new Date('2026-09-13T09:00:00.000Z'));

    // A pause, not a lie: last month's adherence still has to know which days
    // in it were paused, and it can only know that if the period survives.
    expect(store.vacations).toHaveLength(1);
    expect(store.vacations[0]?.endedAt).toBeInstanceOf(Date);
  });

  it('keeps the note out of the event log', async () => {
    await setVacation({ on: true, note: 'Wedding in Goa' }, OWNER, NOW);

    // Free text is the primary's, and the overseer's read model is built from
    // events.
    expect(JSON.stringify(store.events)).not.toContain('Goa');
    expect((await getVacationState(OWNER, NOW)).note).toBe('Wedding in Goa');
  });
});

describe('which days were paused', () => {
  it('marks every local day the period covered', async () => {
    store.vacations.push({
      ownerId: OWNER,
      startedAt: new Date('2026-09-10T00:00:00.000Z'),
      endedAt: new Date('2026-09-12T23:00:00.000Z'),
      note: '',
    });

    const days = await vacationDaysBetween(OWNER, '2026-09-08', '2026-09-15');

    expect([...days].sort()).toEqual(['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']);
  });

  it('counts a partial day as paused', async () => {
    // Half a day off is a day the expectations were not in force.
    store.vacations.push({
      ownerId: OWNER,
      startedAt: new Date('2026-09-10T18:00:00.000Z'),
      endedAt: new Date('2026-09-10T19:00:00.000Z'),
      note: '',
    });

    const days = await vacationDaysBetween(OWNER, '2026-09-09', '2026-09-12');

    expect(days.has('2026-09-11')).toBe(true);
  });

  it('treats an open period as running to now', async () => {
    store.vacations.push({
      ownerId: OWNER,
      startedAt: new Date('2026-09-10T00:00:00.000Z'),
      endedAt: null,
      note: '',
    });

    const days = await vacationDaysBetween(OWNER, '2026-09-09', '2026-09-12');

    expect(days.has('2026-09-10')).toBe(true);
    expect(days.has('2026-09-12')).toBe(true);
  });

  it('marks nothing outside the window it was asked about', async () => {
    store.vacations.push({
      ownerId: OWNER,
      startedAt: new Date('2026-08-01T00:00:00.000Z'),
      endedAt: new Date('2026-08-05T00:00:00.000Z'),
      note: '',
    });

    const days = await vacationDaysBetween(OWNER, '2026-09-09', '2026-09-12');

    expect(days.size).toBe(0);
  });

  it('is per owner, like every other query here', async () => {
    store.vacations.push({
      ownerId: 'someone-else',
      startedAt: new Date('2026-09-10T00:00:00.000Z'),
      endedAt: null,
      note: '',
    });

    expect((await vacationDaysBetween(OWNER, '2026-09-09', '2026-09-12')).size).toBe(0);
  });
});
