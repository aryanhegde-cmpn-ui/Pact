import 'server-only';

import { z } from 'zod';

/**
 * Environment schema, parsing, and the parsed values -- deliberately one
 * module.
 *
 * The schema lives here rather than in `src/lib/schemas/` (where CLAUDE.md
 * otherwise requires schemas to live) because this module is `server-only`.
 * Splitting it in two produced an importable, non-guarded half that a client
 * component could pull in, which is exactly the mistake the guard exists to
 * prevent.
 */
const envSchema = z.object({
  MONGODB_URI: z
    .string()
    .min(1)
    .refine((value) => value.startsWith('mongodb://') || value.startsWith('mongodb+srv://'), {
      message: 'must be a mongodb:// or mongodb+srv:// connection string',
    }),

  /** Signs the session JWT. Rotating it invalidates every session. */
  AUTH_SECRET: z.string().min(16, 'must be at least 16 characters'),

  /**
   * Deliberately OPTIONAL, and on Vercel it must be left unset.
   *
   * Auth.js works the origin out from the request's forwarded headers
   * (`trustHost`). Setting AUTH_URL overrides that and pins every redirect and
   * callback to one host, which sends preview deployments to production. It
   * remains here only as an escape hatch for running behind a proxy that does
   * not set forwarded headers. See docs/decisions.md, 008.
   */
  AUTH_URL: z.url('must be an absolute URL').optional(),

  /** Shared secret Vercel Cron presents on scheduled invocations. */
  CRON_SECRET: z.string().min(16, 'must be at least 16 characters'),

  /** IANA zone. Storage is UTC everywhere; this is a rendering concern only. */
  APP_TIMEZONE: z
    .string()
    .default('Asia/Kolkata')
    .refine(isValidTimeZone, { message: 'must be a valid IANA timezone identifier' }),

  /**
   * Read only by `npm run seed:user`, never by the running app, so they are
   * optional: a deploy has no business carrying a plaintext password.
   */
  SEED_USER_EMAIL: z.email().optional(),
  SEED_USER_PASSWORD: z.string().min(12, 'must be at least 12 characters').optional(),
});

export type Env = z.infer<typeof envSchema>;

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Distinguishes a configuration failure from any other runtime error. */
export class EnvironmentError extends Error {
  override readonly name = 'EnvironmentError';
}

/**
 * Hosting dashboards and CI systems commonly hand a *declared but unfilled*
 * variable through as an empty string rather than omitting it. Left alone that
 * is actively harmful: an empty `APP_TIMEZONE` suppresses its own `.default()`,
 * and an empty `MONGODB_URI` trips both its length check and its format check,
 * so one blank field reports as two separate errors.
 *
 * Treat blank as absent, which is what the operator meant.
 */
export function readEnv(source: Record<string, string | undefined>): Record<string, string> {
  const cleaned: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.trim() !== '') {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

/**
 * Formats a Zod failure into an operator-readable list naming every offending
 * variable.
 *
 * `rawSource` is the untouched environment, which is what lets the message
 * separate "you never set this" from "you created the variable and left the
 * value blank" -- the two have completely different fixes, and the second is
 * invisible in a hosting dashboard.
 */
export function formatEnvError(error: z.ZodError<unknown>, rawSource?: unknown): string {
  const raw = (rawSource ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const issue of error.issues) {
    const name = issue.path.join('.') || '(root)';
    // One line per variable: several checks can fail on a single bad value.
    if (seen.has(name)) continue;
    seen.add(name);

    const value = raw[name];
    const reason =
      value === undefined
        ? 'missing'
        : typeof value === 'string' && value.trim() === ''
          ? 'set, but the value is empty'
          : issue.message;

    lines.push(`  - ${name}: ${reason}`);
  }

  return [
    'Invalid environment configuration. The following variables are missing or invalid:',
    ...lines,
    '',
    'Local development: set these in .env.local -- the README lists where each',
    'value comes from.',
    'Vercel: Settings > Environment Variables, for the environment being built',
    '(Production, Preview and Development are configured separately).',
    'CI that only compiles and tests can set SKIP_ENV_VALIDATION=1 instead.',
  ].join('\n');
}

let cached: Env | null = null;

/**
 * The validated environment, checked on first use rather than on import.
 *
 * Validating at module load looks stricter but breaks the build: `next build`
 * imports every route module to collect its segment config, so the compile step
 * ends up demanding production secrets it never uses. Deferring to first access
 * keeps the guarantee that matters -- nothing reads a value that was not
 * validated -- while letting a build succeed without them.
 *
 * Still loud: the first request that needs configuration throws, naming every
 * missing or invalid variable.
 */
export function getEnv(): Env {
  if (cached) {
    return cached;
  }

  if (process.env.SKIP_ENV_VALIDATION) {
    console.warn(
      '[env] SKIP_ENV_VALIDATION is set: environment not validated. ' +
        'Expected during a build; a bug anywhere else.',
    );
    cached = process.env as unknown as Env;
    return cached;
  }

  const parsed = envSchema.safeParse(readEnv(process.env));

  if (!parsed.success) {
    // Report against the untouched environment so the message can distinguish
    // an unset variable from one that was set to an empty value.
    throw new EnvironmentError(formatEnvError(parsed.error, process.env));
  }

  cached = parsed.data;
  return cached;
}

/** Test-only: drops the memoised environment so a case can supply its own. */
export function __resetEnvCacheForTests(): void {
  cached = null;
}

/**
 * Build/runtime metadata that is descriptive rather than configurable, so it is
 * deliberately outside the validated schema -- a missing commit SHA should not
 * stop the app from booting, and reading it must never trigger validation.
 */
export const buildInfo = {
  commitSha: process.env.APP_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown',
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
} as const;
