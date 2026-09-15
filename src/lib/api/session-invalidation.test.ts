import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A password reset ends every existing session.
 *
 * ---------------------------------------------------------------------------
 * THE HALF THAT IS NOT IN THE SERVICE.
 * ---------------------------------------------------------------------------
 * `account-recovery.test.ts` asserts the reset stamps `sessionsValidFrom`.
 * That is only half a revocation: the stamp does nothing unless something
 * checks it, and an Auth.js session is a ninety-day JWT that no server can
 * reach out and revoke. This is the other half -- the guard refusing a token
 * minted before the reset.
 *
 * Getting it wrong is quiet. The reset would report success, the codes would be
 * spent, and whoever knew the old password would stay signed in on their own
 * device for three months.
 * ---------------------------------------------------------------------------
 */
const store = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  user: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));
vi.mock('@/lib/auth', () => ({
  auth: async () => (store.session ? { user: store.session } : null),
}));
vi.mock('@/lib/db/models/user', () => ({
  UserModel: { findOne: () => ({ lean: async () => store.user }) },
}));

const { currentActor } = await import('./guard');

const RESET_AT = new Date('2026-09-12T10:00:00.000Z');

beforeEach(() => {
  store.session = {
    id: 'u1',
    role: 'primary',
    ownerId: 'u1',
    signedInAt: RESET_AT.getTime() + 1000,
  };
  store.user = { role: 'primary', sessionsValidFrom: null };
});

describe('a session older than the last reset', () => {
  it('is refused', async () => {
    store.user = { role: 'primary', sessionsValidFrom: RESET_AT };
    store.session = { ...store.session, signedInAt: RESET_AT.getTime() - 1 };

    expect(await currentActor()).toBeNull();
  });

  it('lets a session minted after the reset through', async () => {
    store.user = { role: 'primary', sessionsValidFrom: RESET_AT };
    store.session = { ...store.session, signedInAt: RESET_AT.getTime() + 1 };

    expect(await currentActor()).toMatchObject({ userId: 'u1', role: 'primary' });
  });

  it('treats an unstamped session as older than any reset', async () => {
    /**
     * Tokens minted before this existed carry no `signedInAt`. "Sign in again"
     * is the right answer for one of them once a reset has happened -- the
     * alternative is a session that survives the very thing meant to kill it.
     */
    store.user = { role: 'primary', sessionsValidFrom: RESET_AT };
    store.session = { id: 'u1', role: 'primary', ownerId: 'u1' };

    expect(await currentActor()).toBeNull();
  });

  it('leaves every session alone when nothing has been reset', async () => {
    store.user = { role: 'primary', sessionsValidFrom: null };
    store.session = { id: 'u1', role: 'primary', ownerId: 'u1' };

    expect(await currentActor()).not.toBeNull();
  });
});

describe('the role comes from the database', () => {
  it('prefers the stored role over the token', async () => {
    // The token is a ninety-day cache. A role changed since sign-in has to take
    // effect on the next request, not in three months.
    store.user = { role: 'overseer', sessionsValidFrom: null };
    store.session = { id: 'u1', role: 'primary', ownerId: 'p1', signedInAt: Date.now() };

    expect(await currentActor()).toMatchObject({ role: 'overseer' });
  });

  it('falls back safely when the stored role is outside the enum', async () => {
    // `role: 'owner'` really did reach this database once, and every guarded
    // route failed for the session that carried it.
    store.user = { role: 'owner', sessionsValidFrom: null };
    store.session = { id: 'u1', role: 'primary', ownerId: 'u1', signedInAt: Date.now() };

    expect(await currentActor()).toMatchObject({ role: 'primary' });
  });
});
