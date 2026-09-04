import { beforeEach, describe, expect, it, vi } from 'vitest';

const ping = vi.fn().mockResolvedValue({ ok: 1 });
const connectToDatabase = vi.fn();

vi.mock('@/lib/db/mongoose', () => ({
  connectToDatabase: () => connectToDatabase(),
}));

vi.mock('mongoose', () => ({
  default: { connection: { readyState: 0 } },
}));

function connectedDouble() {
  return { connection: { readyState: 1, db: { admin: () => ({ command: ping }) } } };
}

beforeEach(() => {
  vi.resetModules();
  ping.mockClear();
  connectToDatabase.mockReset().mockResolvedValue(connectedDouble());
});

describe('GET /api/health', () => {
  it('reports a green database and returns 200', async () => {
    const { GET } = await import('./route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.database.status).toBe('connected');
    expect(body.database.readyState).toBe(1);
    // `connect` resolving is not proof the database works; the route must ping.
    expect(ping).toHaveBeenCalledWith({ ping: 1 });
  });

  it('includes the environment name, commit SHA and both clocks', async () => {
    const { GET } = await import('./route');
    const body = await (await GET()).json();

    expect(body.environment).toBe('test');
    expect(typeof body.commit).toBe('string');
    expect(body.time.timezone).toBe('Asia/Kolkata');
    expect(body.time.utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(body.time.local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(body.time.utcOffset).toBe('+05:30');
  });

  it('returns 503 with the failure reason when the database is unreachable', async () => {
    connectToDatabase.mockRejectedValue(new Error('server selection timed out'));

    const { GET } = await import('./route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.database.status).toBe('error');
    expect(body.database.message).toContain('server selection timed out');
  });

  it('never caches', async () => {
    const { GET } = await import('./route');

    expect((await GET()).headers.get('cache-control')).toContain('no-store');
  });
});
