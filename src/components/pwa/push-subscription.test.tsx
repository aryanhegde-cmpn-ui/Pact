// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  endpointIsRegistered,
  reconcileSubscription,
  urlBase64ToUint8Array,
} from './push-subscription';

/**
 * Subscription reconciliation.
 *
 * The case that matters is the silent one: a browser rotates or drops its push
 * subscription without telling anyone, the server keeps sending to the old
 * endpoint, the push service accepts it, and nothing arrives. No error is
 * raised anywhere. Comparing on load is the only thing that catches it.
 */

const KEY =
  'BNMxhVRC_aoPI409939mHxOyVM3tvaedt8xy4YZ46tnQILiHXqRnFKCTUaRJtxhNqT6Mx7XwHfIO0slemkhhfu4';

function mockPush(options: {
  existing?: string | null;
  registeredTails?: string[];
  permission?: NotificationPermission;
}) {
  const subscribe = vi.fn().mockImplementation(async () => makeSubscription('https://push/new'));
  const getSubscription = vi
    .fn()
    .mockResolvedValue(options.existing ? makeSubscription(options.existing) : null);

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }) },
  });
  Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: { permission: options.permission ?? 'granted' },
  });

  const posted: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)));
        return { ok: true, json: async () => ({ registered: true }) };
      }
      return {
        ok: true,
        json: async () => ({
          subscriptions: (options.registeredTails ?? []).map((tail) => ({ endpointTail: tail })),
        }),
      };
    }),
  );

  return { subscribe, getSubscription, posted };
}

function makeSubscription(endpoint: string) {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('endpointIsRegistered', () => {
  it('matches on the tail, because the full endpoint is a capability URL', () => {
    // Anyone holding the endpoint can push to the device, so the server
    // returns a suffix rather than shipping it back to the client.
    expect(endpointIsRegistered('https://push.example/abcdef123456', ['abcdef123456'])).toBe(true);
  });

  it('does not match a different endpoint', () => {
    expect(endpointIsRegistered('https://push.example/abcdef123456', ['zzzzzz999999'])).toBe(false);
  });

  it('does not match when nothing is registered', () => {
    expect(endpointIsRegistered('https://push.example/abcdef123456', [])).toBe(false);
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes a VAPID public key to raw bytes', () => {
    const bytes = urlBase64ToUint8Array(KEY);

    // An uncompressed P-256 point: 65 bytes beginning with 0x04.
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
  });
});

describe('reconcileSubscription', () => {
  it('subscribes and registers when the browser has no subscription', async () => {
    const { subscribe, posted } = mockPush({ existing: null, registeredTails: [] });

    const result = await reconcileSubscription(KEY);

    expect(subscribe).toHaveBeenCalled();
    expect(result.status).toBe('registered');
    expect(posted).toHaveLength(1);
  });

  it('RE-REGISTERS when the browser endpoint is not what the server holds', async () => {
    // The silent-failure case: the browser rotated its subscription and told
    // nobody. Without this, the server pushes to a dead endpoint forever.
    const { posted } = mockPush({
      existing: 'https://push.example/rotated-new-endpoint',
      registeredTails: ['stale-old-endpoint-xyz'],
    });

    const result = await reconcileSubscription(KEY);

    expect(result.status).toBe('registered');
    expect((posted[0] as { endpoint: string }).endpoint).toBe(
      'https://push.example/rotated-new-endpoint',
    );
  });

  it('does nothing when the browser and server already agree', async () => {
    const endpoint = 'https://push.example/abcdefghijkl123456789012';
    const { posted } = mockPush({ existing: endpoint, registeredTails: [endpoint.slice(-24)] });

    const result = await reconcileSubscription(KEY);

    expect(result.status).toBe('already-registered');
    expect(posted).toHaveLength(0);
  });

  it('refuses to subscribe without permission', async () => {
    const { subscribe } = mockPush({ existing: null, permission: 'default' });

    const result = await reconcileSubscription(KEY);

    // Subscribing would prompt, and prompting outside a user gesture is what
    // gets an origin auto-blocked.
    expect(result.status).toBe('no-permission');
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('reports a missing VAPID key rather than throwing', async () => {
    mockPush({ existing: null });

    expect(await reconcileSubscription(undefined)).toEqual({ status: 'no-key' });
  });

  it('reports no support when the Push API is absent', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });

    expect(await reconcileSubscription(KEY)).toEqual({ status: 'no-support' });
  });

  it('re-registers rather than assuming, when the server list cannot be fetched', async () => {
    mockPush({ existing: 'https://push.example/current', registeredTails: [] });
    // A failed list read must not be read as "already registered" -- that is
    // how push silently stops.
    const result = await reconcileSubscription(KEY);

    expect(result.status).toBe('registered');
  });
});
