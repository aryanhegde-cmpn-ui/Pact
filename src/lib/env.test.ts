import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetEnvCacheForTests, EnvironmentError, formatEnvError, getEnv, readEnv } from './env';

const REQUIRED = ['MONGODB_URI', 'AUTH_SECRET', 'AUTH_URL', 'CRON_SECRET'] as const;

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
    expect(getEnv()).toBe(getEnv());
  });

  it('treats the seed credentials as optional', () => {
    delete process.env.SEED_USER_EMAIL;
    delete process.env.SEED_USER_PASSWORD;

    expect(() => getEnv()).not.toThrow();
  });

  it('no longer accepts the removed Google variables', () => {
    // Their presence must not be required, and their absence must not fail.
    for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ALLOWED_EMAIL']) {
      delete process.env[name];
    }

    expect(() => getEnv()).not.toThrow();
    expect(getEnv()).not.toHaveProperty('GOOGLE_CLIENT_ID');
  });

  it('skips validation when SKIP_ENV_VALIDATION is set', () => {
    for (const name of REQUIRED) delete process.env[name];
    process.env.SKIP_ENV_VALIDATION = '1';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => getEnv()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SKIP_ENV_VALIDATION'));
  });
});

describe('readEnv', () => {
  it('drops blank values so a default can still apply', () => {
    expect(readEnv({ SET: 'v', EMPTY: '', BLANK: '   ' })).toEqual({ SET: 'v' });
  });
});

describe('formatEnvError', () => {
  it('distinguishes unset from set-but-empty, one line per variable', () => {
    process.env.MONGODB_URI = '';
    delete process.env.AUTH_SECRET;

    let message = '';
    try {
      getEnv();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentError);
      message = (error as Error).message;
    }

    expect(message).toContain('MONGODB_URI: set, but the value is empty');
    expect(message).toContain('AUTH_SECRET: missing');
    // APP_TIMEZONE has a default, so a blank value must never be reported.
    expect(message).not.toContain('APP_TIMEZONE');
    expect(message.split('\n').filter((l) => l.includes('MONGODB_URI'))).toHaveLength(1);
  });

  it('is exported for reuse rather than duplicated', () => {
    expect(typeof formatEnvError).toBe('function');
  });
});

describe('server-only guard', () => {
  // Next enforces this at bundle time: a Client Component graph resolves
  // `server-only` under the "default" export condition, which throws, while a
  // Server Component graph resolves the "react-server" condition, which is a
  // no-op. These cases check both halves of that mechanism -- that env.ts is
  // wired to the guard, and that the guard actually bites.
  const require = createRequire(import.meta.url);
  const envSource = readFileSync(fileURLToPath(new URL('./env.ts', import.meta.url)), 'utf8');

  it('imports the server-only package', () => {
    // Vitest aliases `server-only` to a no-op so the rest of the suite can run,
    // so the wiring has to be asserted against the source directly. Delete the
    // import and this fails.
    expect(envSource).toMatch(/^import 'server-only';/m);
  });

  it('throws when resolved the way a client component resolves it', () => {
    // `createRequire` bypasses Vitest's alias and loads the real package under
    // the default (client) condition.
    expect(() => require('server-only')).toThrow(
      /cannot be imported from a Client Component module/,
    );
  });

  it('is a no-op when resolved the way a server component resolves it', () => {
    // The react-server condition must stay harmless, or every server module
    // that imports the guard would break. The package only exports '.', so the
    // condition target has to be read from the manifest and loaded by path.
    // The package restricts its own `exports`, so neither the manifest nor
    // empty.js is resolvable by specifier -- read them off disk instead.
    const packageDir = fileURLToPath(new URL('../../node_modules/server-only/', import.meta.url));
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
      exports: Record<string, Record<string, string>>;
    };
    const serverTarget = manifest.exports['.']?.['react-server'];

    expect(serverTarget).toBe('./empty.js');
    expect(() => require(join(packageDir, serverTarget!))).not.toThrow();
  });

  it('is the only env module, so there is no unguarded half to import', () => {
    // src/lib/schemas/env.ts used to export the schema with no guard on it,
    // which meant a client component could import the schema half freely.
    // Checked on disk rather than by import, so the assertion survives the file
    // genuinely not existing.
    const orphan = fileURLToPath(new URL('./schemas/env.ts', import.meta.url));

    expect(existsSync(orphan)).toBe(false);
  });
});
