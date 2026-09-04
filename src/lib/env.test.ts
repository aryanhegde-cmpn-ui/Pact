import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetEnvCacheForTests, EnvironmentError, getEnv } from './env';

const REQUIRED = [
  'MONGODB_URI',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'ALLOWED_EMAIL',
  'MIRROR_DEVICE_TOKEN',
  'CRON_SECRET',
] as const;

const original = { ...process.env };

beforeEach(() => {
  __resetEnvCacheForTests();
});

afterEach(() => {
  process.env = { ...original };
  __resetEnvCacheForTests();
  vi.restoreAllMocks();
});

describe('getEnv', () => {
  it('returns the validated environment', () => {
    expect(getEnv().APP_TIMEZONE).toBe('Asia/Kolkata');
  });

  it('memoises, so repeated access validates once', () => {
    const first = getEnv();

    expect(getEnv()).toBe(first);
  });

  it('reports blank values distinctly from missing ones', () => {
    // The exact shape Vercel produces for a variable created without a value.
    for (const name of REQUIRED) process.env[name] = '';
    delete process.env.NEXTAUTH_SECRET;

    expect(() => getEnv()).toThrow(EnvironmentError);
    try {
      getEnv();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('MONGODB_URI: set, but the value is empty');
      expect(message).toContain('NEXTAUTH_SECRET: missing');
      // APP_TIMEZONE has a default, so a blank value must not be reported.
      expect(message).not.toContain('APP_TIMEZONE');
    }
  });

  it('skips validation when SKIP_ENV_VALIDATION is set', () => {
    for (const name of REQUIRED) delete process.env[name];
    process.env.SKIP_ENV_VALIDATION = '1';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => getEnv()).not.toThrow();
    // Skipping silently would be worse than failing.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SKIP_ENV_VALIDATION'));
  });
});

describe('build safety', () => {
  it('does not validate on import, so next build can collect page data', async () => {
    // This is the regression that broke the Vercel deploy: importing a route
    // module must not demand production secrets. `next build` imports every
    // route to read its segment config without ever calling a handler.
    for (const name of REQUIRED) process.env[name] = '';
    vi.resetModules();

    await expect(import('./env')).resolves.toBeDefined();
    await expect(import('./db/mongoose')).resolves.toBeDefined();
    await expect(import('../app/api/health/route')).resolves.toBeDefined();
  });
});
