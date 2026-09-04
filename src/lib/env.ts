import 'server-only';

import { envSchema, formatEnvError, type Env } from '@/lib/schemas/env';

/**
 * Validated process environment.
 *
 * Evaluated at module load: importing this module in a misconfigured
 * environment throws immediately, naming every missing or invalid variable.
 */
function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
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
