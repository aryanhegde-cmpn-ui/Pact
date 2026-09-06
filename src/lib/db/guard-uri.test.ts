import { describe, expect, it } from 'vitest';

import { assertSafeToMutate, assessUri, describeUri } from './guard-uri';

const PRODUCTION =
  'mongodb+srv://user:secret@cluster-example.abc1234.mongodb.net/pact?retryWrites=true';

describe('describeUri', () => {
  it('strips credentials', () => {
    const described = describeUri(PRODUCTION);

    expect(described).not.toContain('secret');
    expect(described).not.toContain('user');
    expect(described).toBe('cluster-example.abc1234.mongodb.net/pact');
  });

  it('says so when there is no database in the path', () => {
    expect(describeUri('mongodb+srv://u:p@host.mongodb.net/')).toBe('host.mongodb.net/(default)');
  });
});

describe('assessUri', () => {
  it.each([
    'mongodb://localhost:27017/pact',
    'mongodb://127.0.0.1:27017/pact',
    'mongodb://user:pass@host.docker.internal:27017/pact',
  ])('allows the local host %s', (uri) => {
    expect(assessUri(uri).safe).toBe(true);
  });

  it.each(['pact-dev', 'pact-test', 'pact_local'])(
    'allows a remote cluster whose database is named %s',
    (name) => {
      expect(assessUri(`mongodb+srv://u:p@cluster.mongodb.net/${name}`).safe).toBe(true);
    },
  );

  it('REFUSES the production cluster', () => {
    expect(assessUri(PRODUCTION).safe).toBe(false);
  });

  it('refuses an unfamiliar remote cluster, failing closed', () => {
    // A guard that must recognise production in order to refuse would wave
    // through every cluster it had not been told about.
    expect(assessUri('mongodb+srv://u:p@some-other.mongodb.net/anything').safe).toBe(false);
  });

  it('is not fooled by a non-production name appearing elsewhere in the URI', () => {
    // "-dev" in the username or host must not count; only the database name.
    expect(assessUri('mongodb+srv://dev-user:p@cluster-dev.mongodb.net/pact').safe).toBe(false);
  });
});

describe('assertSafeToMutate', () => {
  it('throws on production, naming the target without leaking credentials', () => {
    let message = '';
    try {
      assertSafeToMutate(PRODUCTION, 'seed:history --reset');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('Refusing to run seed:history --reset');
    expect(message).toContain('cluster-example.abc1234.mongodb.net/pact');
    expect(message).not.toContain('secret');
  });

  it('does not throw for a scratch database', () => {
    expect(() => assertSafeToMutate('mongodb://localhost:27017/pact', 'x')).not.toThrow();
  });

  it('does not consult NODE_ENV, which was the hole it replaces', () => {
    // A local run against a production URI has NODE_ENV=development and used
    // to pass the old guard. The verdict must depend only on the connection
    // string, so the same URI is refused under every NODE_ENV.
    for (const value of ['development', 'test', 'production']) {
      // NODE_ENV is typed read-only; the cast is the point of the test.
      (process.env as Record<string, string>).NODE_ENV = value;
      expect(() => assertSafeToMutate(PRODUCTION, 'x')).toThrow();
      expect(() => assertSafeToMutate('mongodb://localhost:27017/pact', 'x')).not.toThrow();
    }
  });
});
