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
 * Renders straight from the payload. The payload is small on purpose -- push
 * services cap it near 4KB and encryption eats into that -- so it carries an
 * identifier and short text, never a commitment document.
 */
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Pact', body: event.data.text() };
  }

  const isCheck = payload.type === 'ACCOUNTABILITY_CHECK';

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Pact', {
      body: payload.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      /**
       * The tag makes a re-send REPLACE the previous notification for the same
       * commitment and type rather than stacking beside it. Five copies of one
       * reminder on a lock screen is how a notification channel gets muted.
       */
      tag: payload.tag ?? 'pact',
      renotify: Boolean(payload.tag),
      data: {
        url: payload.url ?? '/dashboard',
        commitmentId: payload.commitmentId ?? null,
        notificationId: payload.notificationId ?? null,
      },
      /**
       * Both answers, as buttons. Offering only "done" would make the honest
       * answer the effortful one, which is how a tool starts collecting
       * flattering data.
       */
      /**
       * Both answers, and "No" opens the reckoning rather than abandoning.
       * Making abandon the only alternative to success would make lying the
       * cheaper option for anyone who simply ran out of time.
       */
      actions: isCheck
        ? [
            { action: 'complete', title: 'Yes, done' },
            { action: 'reckon', title: 'No — reckon it' },
          ]
        : [],
      // An accountability prompt should not vanish unseen from a lock screen.
      requireInteraction: isCheck,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  const { action, notification } = event;
  const data = notification.data ?? {};
  notification.close();

  if (action === 'complete') {
    // Answered from the notification itself, without opening the app.
    event.waitUntil(completeFromNotification(data));
    return;
  }

  /**
   * "No — reckon it" opens the app at the reckoning flow rather than recording
   * anything. That path needs input -- why it was missed, and what changes --
   * and silently abandoning from a lock-screen tap would record a decision the
   * user never made.
   */
  if (action === 'reckon' && data.commitmentId) {
    event.waitUntil(openApp(`/dashboard?reckon=${data.commitmentId}`));
    return;
  }

  event.waitUntil(openApp(data.url ?? '/dashboard'));
});

/**
 * Completes a commitment straight from the notification.
 *
 * The worker has NO session context of its own, so the request must carry
 * credentials explicitly -- `credentials: 'include'` -- or it arrives
 * unauthenticated and the completion silently does not happen.
 */
async function completeFromNotification(data) {
  if (!data.commitmentId) return openApp('/dashboard');

  try {
    const response = await fetch(`/api/commitments/${data.commitmentId}/complete`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    if (response.status === 401) {
      // The session expired. Opening sign-in is the only useful thing left --
      // failing silently would look exactly like the action having worked.
      return openApp(`/?returnTo=${encodeURIComponent(data.url ?? '/dashboard')}`);
    }

    if (!response.ok) {
      return self.registration.showNotification('Pact', {
        body: 'Could not mark that complete. Open the app to try again.',
        icon: '/icons/icon-192.png',
        tag: 'pact:action-failed',
        data: { url: data.url ?? '/dashboard' },
      });
    }

    // Confirmation, because the action produced no visible change otherwise.
    return self.registration.showNotification('Marked complete', {
      body: 'Recorded without opening the app.',
      icon: '/icons/icon-192.png',
      tag: `${data.commitmentId}:completed`,
      data: { url: data.url ?? '/dashboard' },
    });
  } catch {
    // Offline. Opening the app queues nothing, but it is honest about the
    // action not having been recorded.
    return openApp(data.url ?? '/dashboard');
  }
}

/** Focuses an open Pact window if there is one, rather than opening a second. */
async function openApp(url) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  for (const client of clients) {
    if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
      // Navigate the existing window to the target, then focus it. Opening a
      // second copy of an installed app is disorienting and leaves two states.
      if ('navigate' in client && client.url !== url) {
        try {
          await client.navigate(url);
        } catch {
          // Navigation can be refused; focusing is still better than a new window.
        }
      }
      return client.focus();
    }
  }

  return self.clients.openWindow(url);
}
