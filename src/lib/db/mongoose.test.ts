import type { Mongoose } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A stand-in for the object `mongoose.connect` resolves with. Identity is what
 * the reuse assertions turn on, so it only has to be referentially stable.
 */
const fakeConnection = { connection: { readyState: 1 } } as unknown as Mongoose;

const connect = vi.fn<(uri: string, options?: unknown) => Promise<Mongoose>>();

vi.mock('mongoose', () => ({
  default: { connect: (...args: [string, unknown?]) => connect(...args) },
}));

/**
 * The cache lives on `globalThis`, so it survives `vi.resetModules()`. Import
 * fresh and clear it explicitly to keep tests independent.
 */
async function loadModule() {
  vi.resetModules();
  const mod = await import('./mongoose');
  mod.__resetConnectionCacheForTests();
  return mod;
}

beforeEach(() => {
  connect.mockReset();
  connect.mockResolvedValue(fakeConnection);
});

afterEach(async () => {
  const { __resetConnectionCacheForTests } = await import('./mongoose');
  __resetConnectionCacheForTests();
});

describe('connectToDatabase', () => {
  it('opens a connection on the first call', async () => {
    const { connectToDatabase } = await loadModule();

    await expect(connectToDatabase()).resolves.toBe(fakeConnection);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('reuses the cached connection instead of dialling again', async () => {
    const { connectToDatabase } = await loadModule();

    const first = await connectToDatabase();
    const second = await connectToDatabase();

    expect(second).toBe(first);
    // The whole point: Atlas M0 caps connections, so a second call must not
    // open a second one.
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight connection between concurrent callers', async () => {
    const { connectToDatabase } = await loadModule();

    const [first, second, third] = await Promise.all([
      connectToDatabase(),
      connectToDatabase(),
      connectToDatabase(),
    ]);

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('passes a bounded pool size so concurrent lambdas cannot exhaust Atlas', async () => {
    const { connectToDatabase } = await loadModule();
    await connectToDatabase();

    const [uri, options] = connect.mock.calls[0] ?? [];

    expect(uri).toBe('mongodb://127.0.0.1:27017/pact-test');
    expect(options).toMatchObject({ maxPoolSize: 5, bufferCommands: false });
  });

  it('clears the cached promise after a failure so the next request can retry', async () => {
    const { connectToDatabase } = await loadModule();

    connect.mockRejectedValueOnce(new Error('server selection timed out'));
    await expect(connectToDatabase()).rejects.toThrow('server selection timed out');

    connect.mockResolvedValueOnce(fakeConnection);
    await expect(connectToDatabase()).resolves.toBe(fakeConnection);
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
