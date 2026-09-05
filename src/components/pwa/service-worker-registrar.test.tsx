// @vitest-environment happy-dom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceWorkerRegistrar } from './service-worker-registrar';

/**
 * The update prompt.
 *
 * Without it a waiting worker sits there until every tab closes, which on a
 * home-screen app is approximately never -- so you stay on a stale build with
 * no indication why. That makes this worth testing rather than eyeballing.
 */

interface FakeWorker {
  state: string;
  postMessage: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, listener: () => void) => void;
  fire: (type: string) => void;
}

function makeWorker(state = 'installing'): FakeWorker {
  const listeners = new Map<string, (() => void)[]>();

  return {
    state,
    postMessage: vi.fn(),
    addEventListener: (type, listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    fire: (type) => listeners.get(type)?.forEach((listener) => listener()),
  };
}

function installMockServiceWorker(registration: Record<string, unknown>): {
  fireUpdateFound: () => void;
} {
  const regListeners = new Map<string, (() => void)[]>();
  const full = {
    ...registration,
    addEventListener: (type: string, listener: () => void) => {
      regListeners.set(type, [...(regListeners.get(type) ?? []), listener]);
    },
  };

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: vi.fn().mockResolvedValue(full),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      controller: {},
    },
  });

  return { fireUpdateFound: () => regListeners.get('updatefound')?.forEach((l) => l()) };
}

const originalEnv = process.env.NODE_ENV;

beforeEach(() => {
  // Registration is production-only; the whole component is inert otherwise.
  (process.env as Record<string, string>).NODE_ENV = 'production';
});

afterEach(() => {
  (process.env as Record<string, string>).NODE_ENV = originalEnv ?? 'test';
  vi.restoreAllMocks();
});

describe('ServiceWorkerRegistrar', () => {
  it('shows the prompt when a worker is already waiting', async () => {
    const waiting = makeWorker('installed');
    installMockServiceWorker({ waiting });

    render(<ServiceWorkerRegistrar />);

    expect(await screen.findByText('New version available')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('shows the prompt when a new worker finishes installing', async () => {
    const installing = makeWorker('installing');
    const { fireUpdateFound } = installMockServiceWorker({ waiting: null, installing });

    render(<ServiceWorkerRegistrar />);
    await waitFor(() => expect(navigator.serviceWorker.register).toHaveBeenCalled());

    fireUpdateFound();
    installing.state = 'installed';
    installing.fire('statechange');

    expect(await screen.findByText('New version available')).toBeTruthy();
  });

  it('does NOT prompt on a first install, where there is no old version', async () => {
    const installing = makeWorker('installing');
    const { fireUpdateFound } = installMockServiceWorker({ waiting: null, installing });
    // No controller means nothing was controlling the page before: this is a
    // first install, not an update, and prompting would be nonsense.
    Object.defineProperty(navigator.serviceWorker, 'controller', {
      configurable: true,
      value: null,
    });

    render(<ServiceWorkerRegistrar />);
    await waitFor(() => expect(navigator.serviceWorker.register).toHaveBeenCalled());

    fireUpdateFound();
    installing.state = 'installed';
    installing.fire('statechange');

    expect(screen.queryByText('New version available')).toBeNull();
  });

  it('renders nothing when no update is waiting', async () => {
    installMockServiceWorker({ waiting: null });

    const { container } = render(<ServiceWorkerRegistrar />);
    await waitFor(() => expect(navigator.serviceWorker.register).toHaveBeenCalled());

    expect(container.textContent).toBe('');
  });

  it('tells the waiting worker to take over only when the user asks', async () => {
    const waiting = makeWorker('installed');
    installMockServiceWorker({ waiting });

    render(<ServiceWorkerRegistrar />);
    const button = await screen.findByRole('button', { name: 'Reload' });

    // Nothing is skipped until the click: swapping the worker under a running
    // page is exactly what this flow exists to avoid.
    expect(waiting.postMessage).not.toHaveBeenCalled();

    button.click();
    await waitFor(() => expect(waiting.postMessage).toHaveBeenCalledWith('SKIP_WAITING'));
  });

  it('does not register at all outside production', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'development';
    installMockServiceWorker({ waiting: makeWorker('installed') });

    render(<ServiceWorkerRegistrar />);

    // A cached worker in dev makes every change look like it did not apply.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled();
    expect(screen.queryByText('New version available')).toBeNull();
  });

  it('survives a registration failure without breaking the page', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: vi.fn().mockRejectedValue(new Error('no https')),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        controller: null,
      },
    });

    const { container } = render(<ServiceWorkerRegistrar />);
    await waitFor(() => expect(navigator.serviceWorker.register).toHaveBeenCalled());

    expect(container.textContent).toBe('');
  });
});
