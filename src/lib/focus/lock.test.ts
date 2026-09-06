import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SESSION_LOCK_MESSAGE, SESSION_LOCKED_CAPABILITIES } from '@/lib/schemas/focus';

/**
 * The session lock, exercised through the guard every route passes through.
 *
 * The claim is specifically about a SECOND CLIENT. A lock the UI holds is not
 * a lock: another tab, or the same phone restoring a page from before the
 * session started, posts straight past it. So this test never touches the
 * focus UI -- it calls the guarded handler the way a second tab would.
 */
const store = vi.hoisted(() => ({
  sessions: [] as Record<string, unknown>[],
  actor: { userId: 'u1', role: 'primary', ownerId: 'owner-1' } as {
    userId: string;
    role: string;
    ownerId: string;
  } | null,
}));

vi.mock('@/lib/db/mongoose', () => ({ connectToDatabase: async () => ({}) }));
vi.mock('@/lib/db/models/focus-session', () => ({
  FocusSessionModel: {
    findOne: (filter: { ownerId: string; endedAt: null }) => ({
      lean: async () =>
        store.sessions.find(
          (row) => row.ownerId === filter.ownerId && (row.endedAt ?? null) === null,
        ) ?? null,
    }),
  },
}));
vi.mock('@/lib/auth', () => ({
  auth: async () => (store.actor ? { user: { ...store.actor, id: store.actor.userId } } : null),
}));

const { requireCapability } = await import('@/lib/api/guard');

/** A handler that records whether it ran at all. */
function handler(ran: { value: boolean }) {
  return async () => {
    ran.value = true;
    return Response.json({ ok: true });
  };
}

const request = () => new Request('https://pact.test/api/anything', { method: 'POST' });
const context = { params: Promise.resolve({}) };

beforeEach(() => {
  store.sessions.length = 0;
  store.actor = { userId: 'u1', role: 'primary', ownerId: 'owner-1' };
});

function startASession() {
  store.sessions.push({ ownerId: 'owner-1', endedAt: null, startedAt: new Date() });
}

describe('while a session is running', () => {
  it.each([...SESSION_LOCKED_CAPABILITIES])(
    'refuses %s from a second client',
    async (capability) => {
      startASession();
      const ran = { value: false };

      const response = await requireCapability(capability, handler(ran))(request(), context);
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(409);
      expect(body.error).toBe(SESSION_LOCK_MESSAGE);
      // Refused BEFORE the handler, so nothing partial was written.
      expect(ran.value).toBe(false);
    },
  );

  it('locks creating, editing, re-planning and settings — the whole write surface', () => {
    expect([...SESSION_LOCKED_CAPABILITIES]).toEqual([
      'commitment:write',
      'series:write',
      'curriculum:write',
      'settings:write',
    ]);
  });

  it('still allows reading', async () => {
    startASession();
    const ran = { value: false };

    const response = await requireCapability('commitment:read', handler(ran))(request(), context);

    expect(response.status).toBe(200);
    expect(ran.value).toBe(true);
  });

  it('still allows answering a miss', async () => {
    /**
     * Deliberately not locked. Answering a miss is not planning, it cannot
     * create work, and blocking it would mean a session started by accident
     * wedges the reckoning queue behind it.
     */
    startASession();
    const ran = { value: false };

    const response = await requireCapability('reckoning:submit', handler(ran))(request(), context);

    expect(response.status).toBe(200);
    expect(ran.value).toBe(true);
  });

  it('lets the focus routes through, because ending a session completes its commitment', async () => {
    startASession();
    const ran = { value: false };

    const response = await requireCapability('commitment:write', handler(ran), {
      duringSession: true,
    })(request(), context);

    expect(response.status).toBe(200);
    expect(ran.value).toBe(true);
  });
});

describe('with no session running', () => {
  it('allows every write', async () => {
    for (const capability of SESSION_LOCKED_CAPABILITIES) {
      const ran = { value: false };
      const response = await requireCapability(capability, handler(ran))(request(), context);

      expect(response.status).toBe(200);
      expect(ran.value).toBe(true);
    }
  });

  it('ignores a session that has already ended', async () => {
    store.sessions.push({ ownerId: 'owner-1', endedAt: new Date(), startedAt: new Date() });
    const ran = { value: false };

    const response = await requireCapability('commitment:write', handler(ran))(request(), context);

    expect(response.status).toBe(200);
    expect(ran.value).toBe(true);
  });

  it('ignores another owner’s running session', async () => {
    // The lock is per owner, like every other query in the app.
    store.sessions.push({ ownerId: 'someone-else', endedAt: null, startedAt: new Date() });
    const ran = { value: false };

    const response = await requireCapability('commitment:write', handler(ran))(request(), context);

    expect(response.status).toBe(200);
    expect(ran.value).toBe(true);
  });
});

describe('the lock does not replace the other guards', () => {
  it('still requires a session cookie', async () => {
    store.actor = null;
    startASession();
    const ran = { value: false };

    const response = await requireCapability('commitment:write', handler(ran))(request(), context);

    expect(response.status).toBe(401);
    expect(ran.value).toBe(false);
  });

  it('still refuses a capability the role does not hold', async () => {
    store.actor = { userId: 'u2', role: 'overseer', ownerId: 'owner-1' };
    const ran = { value: false };

    const response = await requireCapability('commitment:write', handler(ran))(request(), context);

    // 403, not 409: the capability check comes first, and a lock message would
    // tell an overseer that a route exists.
    expect(response.status).toBe(403);
    expect(ran.value).toBe(false);
  });
});
