// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The service worker's push and click handlers, executed.
 *
 * ---------------------------------------------------------------------------
 * THE ONE PIECE OF CODE THAT OUTLIVES A DEPLOY.
 * ---------------------------------------------------------------------------
 * A service worker installs on a device and stays there until it decides to
 * update. A bug in this file is not fixed by shipping a fix -- it is fixed when
 * every installed copy notices, which for an app that is never fully closed can
 * be a long time. It is the code most worth testing and, until now, the only
 * substantial code here with no test at all.
 *
 * `public/sw.js` is plain script rather than a module, so it is evaluated with
 * a fake `self` and its registered listeners are called directly. That is the
 * real handler running -- not a copy of its logic.
 * ---------------------------------------------------------------------------
 */
interface FakeNotification {
  title: string;
  options: Record<string, unknown>;
}

interface Harness {
  listeners: Map<string, (event: unknown) => void>;
  shown: FakeNotification[];
  opened: string[];
  focused: string[];
  fetches: { url: string; init: Record<string, unknown> }[];
  fetchResponse: { ok: boolean; status: number };
  existingClients: { url: string; focus: () => void }[];
}

function load(): Harness {
  const harness: Harness = {
    listeners: new Map(),
    shown: [],
    opened: [],
    focused: [],
    fetches: [],
    fetchResponse: { ok: true, status: 200 },
    existingClients: [],
  };

  const self = {
    addEventListener: (name: string, handler: (event: unknown) => void) => {
      harness.listeners.set(name, handler);
    },
    skipWaiting: () => {},
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        harness.shown.push({ title, options });

        return Promise.resolve();
      },
      waiting: null,
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(harness.existingClients),
      openWindow: (url: string) => {
        harness.opened.push(url);

        return Promise.resolve({ focus: () => {} });
      },
    },
    location: { origin: 'https://pact.test' },
  };

  const caches = {
    open: () =>
      Promise.resolve({
        addAll: () => Promise.resolve(),
        put: () => Promise.resolve(),
        match: () => Promise.resolve(undefined),
      }),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true),
    match: () => Promise.resolve(undefined),
  };

  const fetchStub = (url: string, init: Record<string, unknown> = {}) => {
    harness.fetches.push({ url, init });

    return Promise.resolve(harness.fetchResponse);
  };

  const source = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');

  // Evaluated with the worker globals it expects. `self` is the only one it
  // reaches for by name, and shadowing the rest keeps this off the real DOM.
  new Function('self', 'caches', 'fetch', 'clients', 'Request', 'Response', source)(
    self,
    caches,
    fetchStub,
    self.clients,
    class {},
    class {},
  );

  return harness;
}

/** A push event carrying a JSON payload, shaped like the real one. */
function pushEvent(payload: unknown): {
  data: { json: () => unknown; text: () => string };
  waitUntil: (p: unknown) => void;
} {
  return {
    data: { json: () => payload, text: () => JSON.stringify(payload) },
    waitUntil: () => {},
  };
}

let harness: Harness;
const waited: Promise<unknown>[] = [];

function clickEvent(action: string, data: Record<string, unknown>) {
  return {
    action,
    notification: { data, close: vi.fn() },
    waitUntil: (promise: Promise<unknown>) => {
      waited.push(promise);
    },
  };
}

beforeEach(() => {
  harness = load();
  waited.length = 0;
});

describe('the push handler', () => {
  it('renders the notification it was sent', () => {
    const push = harness.listeners.get('push');
    expect(push, 'the worker registered no push handler').toBeTruthy();

    push!(pushEvent({ title: 'Ship the report', body: 'Due in 30 minutes', tag: 'c1:APPROACH' }));

    expect(harness.shown).toHaveLength(1);
    expect(harness.shown[0]!.title).toBe('Ship the report');
    expect(harness.shown[0]!.options.body).toBe('Due in 30 minutes');
  });

  it('replaces rather than stacks, via the tag', () => {
    // Five copies of one reminder on a lock screen is how a channel gets muted.
    harness.listeners.get('push')!(pushEvent({ title: 'A', tag: 'c1:DEADLINE_NOW' }));

    expect(harness.shown[0]!.options.tag).toBe('c1:DEADLINE_NOW');
    expect(harness.shown[0]!.options.renotify).toBe(true);
  });

  it('offers BOTH answers on an accountability check', () => {
    /**
     * Offering only "done" makes the honest answer the effortful one, which is
     * how a tool starts collecting flattering data.
     */
    harness.listeners.get('push')!(
      pushEvent({ title: 'Did you do it?', type: 'ACCOUNTABILITY_CHECK', commitmentId: 'c1' }),
    );

    const actions = harness.shown[0]!.options.actions as { action: string; title: string }[];
    expect(actions.map((entry) => entry.action)).toEqual(['complete', 'reckon']);
    // And it stays on the lock screen until it is answered.
    expect(harness.shown[0]!.options.requireInteraction).toBe(true);
  });

  it('gives an ordinary reminder no actions', () => {
    harness.listeners.get('push')!(pushEvent({ title: 'Due soon', type: 'DEADLINE_APPROACHING' }));

    expect(harness.shown[0]!.options.actions).toEqual([]);
  });

  it('survives a payload that is not JSON', () => {
    const push = harness.listeners.get('push')!;

    push({
      data: {
        json: () => {
          throw new Error('not json');
        },
        text: () => 'plain text',
      },
      waitUntil: () => {},
    });

    // Falling over here would mean a push that silently never appears.
    expect(harness.shown[0]!.options.body).toBe('plain text');
  });
});

describe('"Yes, done" answers without opening the app', () => {
  it('posts the completion with credentials', async () => {
    harness.listeners.get('notificationclick')!(clickEvent('complete', { commitmentId: 'c1' }));
    await Promise.all(waited);

    expect(harness.fetches).toHaveLength(1);
    expect(harness.fetches[0]!.url).toBe('/api/commitments/c1/complete');

    /**
     * `credentials: 'include'` is load-bearing. A worker has no session context
     * of its own, so without it the request arrives unauthenticated and the
     * completion silently does not happen.
     */
    expect(harness.fetches[0]!.init.credentials).toBe('include');
    expect(harness.opened, 'it opened the app anyway').toEqual([]);
  });

  it('confirms, because nothing else on screen changed', async () => {
    harness.listeners.get('notificationclick')!(clickEvent('complete', { commitmentId: 'c1' }));
    await Promise.all(waited);

    expect(harness.shown.at(-1)!.title).toBe('Marked complete');
  });

  it('opens sign-in when the session has expired', async () => {
    harness.fetchResponse = { ok: false, status: 401 };

    harness.listeners.get('notificationclick')!(
      clickEvent('complete', { commitmentId: 'c1', url: '/dashboard' }),
    );
    await Promise.all(waited);

    // Failing silently would look exactly like the action having worked.
    expect(harness.opened[0]).toContain('/?returnTo=');
  });

  it('says so when the write failed', async () => {
    harness.fetchResponse = { ok: false, status: 500 };

    harness.listeners.get('notificationclick')!(clickEvent('complete', { commitmentId: 'c1' }));
    await Promise.all(waited);

    expect(harness.shown.at(-1)!.options.tag).toBe('pact:action-failed');
  });
});

describe('"No, reckon it" opens the flow rather than recording anything', () => {
  it('opens the app at the reckoning', async () => {
    harness.listeners.get('notificationclick')!(clickEvent('reckon', { commitmentId: 'c9' }));
    await Promise.all(waited);

    /**
     * It records NOTHING. That path needs input -- why it was missed and what
     * changes -- and abandoning from a lock-screen tap would store a decision
     * the user never made.
     */
    expect(harness.fetches).toEqual([]);
    expect(harness.opened[0]).toBe('/dashboard?reckon=c9');
  });
});

describe('an ordinary tap', () => {
  it('focuses a window that is already open', async () => {
    const focus = vi.fn();
    harness.existingClients.push({ url: 'https://pact.test/dashboard', focus });

    harness.listeners.get('notificationclick')!(clickEvent('', { url: '/dashboard' }));
    await Promise.all(waited);

    // A second window for an installed PWA is a worse answer than the one the
    // user already has.
    expect(focus).toHaveBeenCalled();
    expect(harness.opened).toEqual([]);
  });

  it('opens one when there is none', async () => {
    harness.listeners.get('notificationclick')!(clickEvent('', { url: '/postponements' }));
    await Promise.all(waited);

    expect(harness.opened).toEqual(['/postponements']);
  });
});
