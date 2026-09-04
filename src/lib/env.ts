import 'server-only';

import { envSchema, formatEnvError, readEnv, type Env } from '@/lib/schemas/env';

/** Distinguishes a configuration failure from any other runtime error. */
export class EnvironmentError extends Error {
  override readonly name = 'EnvironmentError';
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
