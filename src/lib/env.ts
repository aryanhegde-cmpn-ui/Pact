import 'server-only';

import { envSchema, formatEnvError, readEnv, type Env } from '@/lib/schemas/env';

/**
 * Validated process environment.
 *
 * Evaluated at module load: importing this module in a misconfigured
 * environment throws immediately, naming every missing or invalid variable,
 * rather than failing later at whichever request first needed a value.
 */
function loadEnv(): Env {
  if (process.env.SKIP_ENV_VALIDATION) {
    // `next build` evaluates this module while collecting page data, so a CI
    // job that only compiles and tests would otherwise need production secrets
    // just to type-check. Opt-in, and never set on a running deployment --
    // whatever serves traffic still validates on boot.
    console.warn(
      '[env] SKIP_ENV_VALIDATION is set: environment not validated. ' +
        'Expected during a build; a bug anywhere else.',
    );
    return process.env as unknown as Env;
  }

  const parsed = envSchema.safeParse(readEnv(process.env));

  if (!parsed.success) {
    // Report against the untouched environment so the message can distinguish
    // an unset variable from one that was set to an empty value.
    throw new Error(formatEnvError(parsed.error, process.env));
  }

  return parsed.data;
}

export const env: Env = loadEnv();

/**
 * Build/runtime metadata that is descriptive rather than configurable, so it is
 * deliberately outside the validated schema -- a missing commit SHA should not
 * stop the app from booting.
 */
export const buildInfo = {
  commitSha: process.env.APP_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown',
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
} as const;
