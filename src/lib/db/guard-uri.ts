import 'server-only';

/**
 * Guards against running destructive development commands against production
 * data.
 *
 * Inspecting NODE_ENV is not enough and was the actual hole: running
 * `npm run seed:history -- --reset` on a laptop sets NODE_ENV to development
 * while `.env.local` points MONGODB_URI at the production cluster, so the
 * guard passed and the production database was one command away from being
 * wiped. The connection string is what actually decides which data is at risk,
 * so that is what gets inspected.
 */

/** Substrings in a connection string that mean "this is not production". */
const LOCAL_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'mongodb://mongo',
  'host.docker.internal',
];

/** Database-name suffixes that explicitly opt a remote cluster in. */
const NON_PRODUCTION_DB_NAMES = ['-dev', '-test', '-local', '_dev', '_test', '_local'];

export interface UriVerdict {
  safe: boolean;
  reason: string;
  /** Host and database only. Never credentials. */
  describe: string;
}

/** Host and database name, with any credentials stripped. */
export function describeUri(uri: string): string {
  try {
    const withoutCredentials = uri.replace(/\/\/[^@/]*@/, '//');
    const url = new URL(
      withoutCredentials.replace(/^mongodb\+srv:/, 'https:').replace(/^mongodb:/, 'http:'),
    );
    const database = url.pathname.replace(/^\//, '') || '(default)';

    return `${url.hostname}/${database}`;
  } catch {
    return '(unparseable connection string)';
  }
}

/**
 * Whether a destructive command may run against this connection string.
 *
 * Deliberately fail-closed: anything not recognised as local or explicitly
 * named as non-production is treated as production. A guard that has to
 * recognise production to refuse would let an unfamiliar cluster through.
 */
export function assessUri(uri: string): UriVerdict {
  const describe = describeUri(uri);
  const lower = uri.toLowerCase();

  if (LOCAL_HOSTS.some((host) => lower.includes(host))) {
    return { safe: true, reason: 'connects to a local host', describe };
  }

  const database = describe.split('/')[1] ?? '';
  if (NON_PRODUCTION_DB_NAMES.some((suffix) => database.toLowerCase().endsWith(suffix))) {
    return { safe: true, reason: `database name ends with a non-production suffix`, describe };
  }

  return {
    safe: false,
    reason: 'remote host with no non-production marker, so it is treated as production',
    describe,
  };
}

/** Throws unless a destructive command may run against `uri`. */
export function assertSafeToMutate(uri: string, command: string): void {
  const verdict = assessUri(uri);
  if (verdict.safe) return;

  throw new Error(
    `Refusing to run ${command}.\n` +
      `  Target: ${verdict.describe}\n` +
      `  Reason: ${verdict.reason}\n\n` +
      'NODE_ENV is not consulted: a local run against a production URI has a\n' +
      'development NODE_ENV and would have passed.\n\n' +
      'To target a scratch database, point MONGODB_URI at localhost or at a\n' +
      'database whose name ends in -dev, -test or -local.',
  );
}
