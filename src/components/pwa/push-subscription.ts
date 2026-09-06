'use client';

/**
 * Push subscription management.
 *
 * The subtle part is reconciliation. A browser can drop or rotate a push
 * subscription at any time -- on storage pressure, a permission change, or for
 * no stated reason -- and it tells nobody. The server keeps happily sending to
 * an endpoint the browser no longer holds, the push service accepts the send,
 * and nothing arrives. There is no error anywhere. This is the single most
 * common way web push silently stops working.
 *
 * So on every app load the browser's CURRENT subscription is compared against
 * what the server holds, and any mismatch re-registers.
 */

/** VAPID keys are base64url; the Push API wants raw bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalised);

  // Built on a plain ArrayBuffer: the Push API's applicationServerKey rejects
  // a view over a SharedArrayBuffer, which is what the bare Uint8Array type
  // allows.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);

  return bytes;
}

export interface ReconcileResult {
  status: 'no-support' | 'no-permission' | 'no-key' | 'registered' | 'already-registered' | 'error';
  endpoint?: string;
}

/**
 * Whether the server's registered endpoints include this browser's.
 *
 * Only the tail is compared: the endpoint is a capability URL -- anyone
 * holding it can push to the device -- so the list endpoint returns a suffix
 * rather than shipping the whole thing back to the client.
 */
export function endpointIsRegistered(endpoint: string, registeredTails: string[]): boolean {
  return registeredTails.some((tail) => endpoint.endsWith(tail));
}

/**
 * Subscribes if needed, and reconciles against the server.
 *
 * Called both from the permission gesture and on app load. Safe to call
 * repeatedly: the server upserts on endpoint.
 */
export async function reconcileSubscription(
  publicKey: string | undefined,
): Promise<ReconcileResult> {
  if (typeof window === 'undefined') return { status: 'no-support' };
  // Truthiness, not `in`: a non-secure context exposes the property with an
  // undefined value, so an `in` check passes and the next line throws.
  if (!navigator.serviceWorker || !('PushManager' in window)) {
    return { status: 'no-support' };
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    // Never subscribe without permission: it would prompt, and prompting
    // outside a user gesture is what gets an origin auto-blocked.
    return { status: 'no-permission' };
  }
  if (!publicKey) return { status: 'no-key' };

  try {
    const registration = await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        // Required by every browser: a push that does not show a notification
        // is not permitted, and Chrome rejects the subscription outright
        // without this.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const registered = await fetch('/api/push/subscribe', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { subscriptions: [] }))
      .catch(() => ({ subscriptions: [] }));

    const tails = (registered.subscriptions ?? []).map(
      (row: { endpointTail: string }) => row.endpointTail,
    );

    if (endpointIsRegistered(subscription.endpoint, tails)) {
      return { status: 'already-registered', endpoint: subscription.endpoint };
    }

    // Mismatch: the browser holds a subscription the server does not know
    // about. Re-register rather than assume, because the alternative is push
    // that appears configured and delivers nothing.
    const json = subscription.toJSON() as { keys?: { p256dh?: string; auth?: string } };
    if (!json.keys?.p256dh || !json.keys?.auth) return { status: 'error' };

    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        userAgent: navigator.userAgent,
      }),
    });

    return response.ok
      ? { status: 'registered', endpoint: subscription.endpoint }
      : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

/** Unsubscribes this browser and tells the server to forget the endpoint. */
export async function unsubscribeHere(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;

  const { endpoint } = subscription;
  await subscription.unsubscribe();
  await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => undefined);

  return true;
}
