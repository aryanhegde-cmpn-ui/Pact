import { z } from 'zod';

/**
 * The single source of truth for the application environment.
 *
 * Per CLAUDE.md, Zod schemas define types -- never the other way round. Import
 * the validated values from `@/lib/env`, not from here.
 */
export const envSchema = z.object({
  MONGODB_URI: z
    .string()
    .min(1)
    .refine((value) => value.startsWith('mongodb://') || value.startsWith('mongodb+srv://'), {
      message: 'must be a mongodb:// or mongodb+srv:// connection string',
    }),

  NEXTAUTH_SECRET: z.string().min(16, 'must be at least 16 characters'),
  NEXTAUTH_URL: z.url('must be an absolute URL'),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  /** The one Google account allowed to sign in. This app has exactly one user. */
  ALLOWED_EMAIL: z.email(),

  /** Bearer token the smart-mirror device presents instead of a session. */
  MIRROR_DEVICE_TOKEN: z.string().min(16, 'must be at least 16 characters'),

  /** Shared secret Vercel Cron presents on scheduled invocations. */
  CRON_SECRET: z.string().min(16, 'must be at least 16 characters'),

  /** IANA zone. Storage is UTC everywhere; this is a rendering concern only. */
  APP_TIMEZONE: z
    .string()
    .default('Asia/Kolkata')
    .refine(isValidTimeZone, { message: 'must be a valid IANA timezone identifier' }),
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
 * variable. Thrown at module load so a misconfigured deploy dies immediately
 * and visibly rather than at the first request that happens to need a value.
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
