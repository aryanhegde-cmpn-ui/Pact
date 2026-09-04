import { describe, expect, it } from 'vitest';

import { envSchema, formatEnvError } from './env';

const validEnv = {
  MONGODB_URI: 'mongodb+srv://user:pass@cluster.mongodb.net/pact',
  NEXTAUTH_SECRET: 'a-secret-long-enough',
  NEXTAUTH_URL: 'http://localhost:3000',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  ALLOWED_EMAIL: 'someone@example.com',
  MIRROR_DEVICE_TOKEN: 'mirror-token-long-enough',
  CRON_SECRET: 'cron-secret-long-enough',
  APP_TIMEZONE: 'Asia/Kolkata',
};

describe('envSchema', () => {
  it('accepts a complete environment', () => {
    expect(envSchema.parse(validEnv)).toMatchObject(validEnv);
  });

  it('defaults APP_TIMEZONE to Asia/Kolkata', () => {
    const { APP_TIMEZONE: _omitted, ...withoutTimezone } = validEnv;

    expect(envSchema.parse(withoutTimezone).APP_TIMEZONE).toBe('Asia/Kolkata');
  });

  it('rejects a connection string that is not a mongodb URI', () => {
    const result = envSchema.safeParse({ ...validEnv, MONGODB_URI: 'postgres://localhost/pact' });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown timezone', () => {
    const result = envSchema.safeParse({ ...validEnv, APP_TIMEZONE: 'Mars/Olympus_Mons' });

    expect(result.success).toBe(false);
  });

  it('names every missing variable in the error message', () => {
    const input = { APP_TIMEZONE: 'Asia/Kolkata' };
    const result = envSchema.safeParse(input);
    expect(result.success).toBe(false);

    const message = formatEnvError(result.error!, input);

    // An absent variable is reported as missing, not as a format complaint
    // about a value that was never set.
    expect(message).toContain('NEXTAUTH_URL: missing');

    for (const name of [
      'MONGODB_URI',
      'NEXTAUTH_SECRET',
      'NEXTAUTH_URL',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'ALLOWED_EMAIL',
      'MIRROR_DEVICE_TOKEN',
      'CRON_SECRET',
    ]) {
      expect(message).toContain(name);
    }
  });

  it('reports a present-but-invalid value with its validation message', () => {
    const input = { ...validEnv, NEXTAUTH_URL: 'not-a-url' };
    const result = envSchema.safeParse(input);
    expect(result.success).toBe(false);

    const message = formatEnvError(result.error!, input);

    expect(message).toContain('NEXTAUTH_URL: must be an absolute URL');
    expect(message).not.toContain('NEXTAUTH_URL: missing');
  });
});
