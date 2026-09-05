/**
 * Pact service worker. Hand-written, deliberately.
 *
 * next-pwa and friends are not used here for two reasons: this needs a `push`
 * handler we control end to end (web push lands in the next change), and the
 * generated-workbox plugins have been unreliable against the App Router. A
 * service worker is the one piece of code that can persist a bug across
 * deploys, so it is worth being able to read all of it.
 *
 * Caching, in one sentence: the shell is cached so the app opens offline, and
 * data is never served from cache without being marked stale.
 */

// Bumped on every deploy by the build. Changing it retires old caches.
const VERSION = 'pact-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;

/**
 * The minimum needed to render something useful offline.
 *
 * Deliberately short. Next's hashed build assets are cached as they are
 * requested rather than enumerated here, because their names change every
 * deploy and a stale precache list fails the install step.
 */
const SHELL_ASSETS = ['/dashboard', '/offline', '/manifest.webmanifest', '/icons/icon-192.png'];

/** Header marking a response that came from cache rather than the network. */
const STALE_HEADER = 'x-pact-stale';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one 404 cannot fail the whole install and leave the
      // app with no worker at all.
      await Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      );
    })(),
  );

  // NOT skipWaiting(). A new worker taking over mid-session swaps the code
  // under a page that is already running. The page is told instead, and the
  // user decides when to reload -- see SW_MESSAGES.SKIP_WAITING below.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * The page asks the waiting worker to take over, once the user has agreed.
 *
 * This is the other half of the update prompt: without it, a waiting worker
 * sits there until every tab is closed, and on a phone home-screen app that is
 * approximately never -- which is how you end up stuck on a stale build with
 * no idea why.
 */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Auth must never be served from cache: a cached redirect or session
  // response is how someone ends up looking at a signed-out shell forever.
  if (url.pathname.startsWith('/api/auth')) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(shellStrategy(request));
});

/**
 * API data: network first, cache only as a fallback, always marked.
 *
 * A cached commitment list is a list of deadlines that may already have
 * passed. Showing it as though it were current is worse than showing nothing,
 * because it tells the user they have time they do not have. Every cached
 * response therefore carries `x-pact-stale` with the time it was stored, and
 * the UI renders that.
 */
async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);

  try {
    const response = await fetch(request);

    if (response.ok) {
      const copy = new Response(response.clone().body, response);
      copy.headers.set('x-pact-cached-at', new Date().toISOString());
      await cache.put(request, copy);
    }

    return response;
  } catch {
    const cached = await cache.match(request);
    if (!cached) throw new Error('offline and nothing cached');

    // Rebuilt rather than returned as-is, so the staleness marker is present
    // on the response the page actually reads.
    const marked = new Response(cached.body, cached);
    marked.headers.set(STALE_HEADER, 'true');

    return marked;
  }
}

/** Navigations and static assets: cache first for assets, network first for pages. */
async function shellStrategy(request) {
  const cache = await caches.open(SHELL_CACHE);

  if (request.mode === 'navigate') {
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch {
      return (
        (await cache.match(request)) ??
        (await cache.match('/dashboard')) ??
        (await cache.match('/offline')) ??
        new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })
      );
    }
  }

  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  // Hashed build output is immutable, so caching on first sight is safe and is
  // what makes the second launch instant.
  if (response.ok && (request.destination !== '' || request.url.includes('/_next/'))) {
    await cache.put(request, response.clone());
  }

  return response;
}

/**
 * Push handler.
 *
 * Present and wired now so the next change adds a subscription store and a
 * server key rather than reshaping the worker. It reads the same payload shape
 * the in-app channel renders from.
 */
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Pact', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Pact', {
      body: payload.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.tag ?? undefined,
      data: { url: payload.url ?? '/dashboard' },
      // Accountability prompts should not vanish unseen from a lock screen.
      requireInteraction: payload.type === 'ACCOUNTABILITY_CHECK',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? '/dashboard';

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Focus an open window rather than opening a second copy of the app.
      for (const client of clients) {
        if (client.url.includes(target) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
