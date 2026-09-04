import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `src/lib/env.ts` validates at module load, so every case here has to import
 * it fresh under a different environment.
 */
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
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...original };
  vi.restoreAllMocks();
});

describe('env module load', () => {
  it('loads a valid environment', async () => {
    const { env } = await import('./env');

    expect(env.APP_TIMEZONE).toBe('Asia/Kolkata');
    expect(env.MONGODB_URI).toContain('mongodb://');
  });

  it('throws naming every variable when the environment is blank', async () => {
    // The exact shape a hosting dashboard produces when the variables were
    // created but no value was pasted.
    for (const name of REQUIRED) process.env[name] = '';
    process.env.APP_TIMEZONE = '';

    await expect(import('./env')).rejects.toThrow(/set, but the value is empty/);
  });

  it('does not report APP_TIMEZONE when it is blank, because it has a default', async () => {
    for (const name of REQUIRED) process.env[name] = '';
    process.env.APP_TIMEZONE = '';

    await expect(import('./env')).rejects.not.toThrow(/APP_TIMEZONE/);
  });

  it('skips validation when SKIP_ENV_VALIDATION is set, so CI can build', async () => {
    for (const name of REQUIRED) delete process.env[name];
    process.env.SKIP_ENV_VALIDATION = '1';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(import('./env')).resolves.toBeDefined();
    // Silently skipping would be worse than failing; the log has to say so.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SKIP_ENV_VALIDATION'));
  });

  it('still validates when SKIP_ENV_VALIDATION is absent', async () => {
    for (const name of REQUIRED) delete process.env[name];
    delete process.env.SKIP_ENV_VALIDATION;

    await expect(import('./env')).rejects.toThrow(/Invalid environment configuration/);
  });
});
