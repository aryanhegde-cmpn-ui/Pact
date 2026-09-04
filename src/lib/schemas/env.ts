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
 * Formats a Zod failure into an operator-readable list naming every offending
 * variable. Thrown at module load so a misconfigured deploy dies immediately
 * and visibly rather than at the first request that happens to need a value.
 *
 * `input` is the raw source object. A variable that is simply absent is
 * reported as "missing" rather than as whatever validation happened to trip
 * first, which otherwise produces misleading advice like telling you to fix the
 * format of a value you never set.
 */
export function formatEnvError(error: z.ZodError<unknown>, input?: unknown): string {
  const source = (input ?? {}) as Record<string, unknown>;

  const lines = error.issues.map((issue) => {
    const name = issue.path.join('.') || '(root)';
    const value = typeof name === 'string' ? source[name] : undefined;
    const absent = value === undefined || value === '';

    return `  - ${name}: ${absent ? 'missing' : issue.message}`;
  });

  return [
    'Invalid environment configuration. The following variables are missing or invalid:',
    ...lines,
    '',
    'Copy .env.example to .env.local and fill in the values above.',
  ].join('\n');
}
