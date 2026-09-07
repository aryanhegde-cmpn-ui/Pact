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

  /**
   * Shared secret for scheduled invocations.
   *
   * Presented by both the Cloudflare per-minute tick and the Vercel daily
   * backstop, as a bearer token on POST /api/notifications/dispatch.
   */
  CRON_SECRET: z.string().min(16, 'must be at least 16 characters'),

  /**
   * VAPID keypair for web push.
   *
   * Optional: the app runs without push, it simply cannot deliver it. Making
   * them required would mean a deploy that has not set them up yet fails to
   * boot over a feature it is not using.
   *
   * The PRIVATE key must never reach the client. It has no NEXT_PUBLIC_ prefix
   * precisely so Next cannot inline it into a bundle, and this module is
   * server-only.
   */
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  /**
   * The PUBLIC key. NEXT_PUBLIC_ because the browser needs it to subscribe --
   * it is a public key and is meant to be shipped.
   */
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  /** Contact address in the VAPID JWT, per the spec. */
  VAPID_SUBJECT: z.string().optional(),

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
  /** Falls back to the email's local part when unset. */
  SEED_USER_USERNAME: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * What each variable is for, where it comes from, and whether it is a secret.
 *
 * ---------------------------------------------------------------------------
 * THE SCHEMA STAYS THE SOURCE OF TRUTH FOR WHAT IS REQUIRED.
 * ---------------------------------------------------------------------------
 * Nothing here says whether a variable is required -- that is read off the Zod
 * schema itself, so the example file, `npm run env:check` and
 * `/api/health/detail` cannot drift from what the app actually enforces. This
 * table adds only the things a schema cannot carry: a sentence of prose, a
 * grouping, and whether the value must be treated as a secret.
 *
 * A test fails if these keys and the schema's keys ever disagree.
 * ---------------------------------------------------------------------------
 */
export const ENV_DOCS: Record<keyof Env, { group: string; secret: boolean; description: string }> =
  {
    MONGODB_URI: {
      group: 'Database',
      secret: true,
      description:
        'Atlas connection string, including the database name. Atlas > Connect > Drivers.',
    },
    AUTH_SECRET: {
      group: 'Authentication',
      secret: true,
      description:
        'Signs the session JWT. Generate with `openssl rand -base64 32`. Rotating it signs everyone out.',
    },
    AUTH_URL: {
      group: 'Authentication',
      secret: false,
      description:
        'LEAVE UNSET on Vercel. Setting it pins every redirect to one host and sends previews to production.',
    },
    CRON_SECRET: {
      group: 'Scheduling',
      secret: true,
      description:
        'Bearer token the Cloudflare tick and the Vercel daily backstop present to /api/notifications/dispatch. Must match the Worker.',
    },
    VAPID_PRIVATE_KEY: {
      group: 'Web push',
      secret: true,
      description: 'From `npm run vapid:generate`. Never prefixed NEXT_PUBLIC_ -- it signs pushes.',
    },
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: {
      group: 'Web push',
      secret: false,
      description:
        'The public half of the same keypair. Shipped to the browser on purpose -- it is what a subscription is made with.',
    },
    VAPID_SUBJECT: {
      group: 'Web push',
      secret: false,
      description: 'Contact URI in the VAPID JWT, e.g. mailto:you@example.com.',
    },
    APP_TIMEZONE: {
      group: 'Application',
      secret: false,
      description:
        'IANA zone for rendering and for quiet hours. Storage is UTC everywhere. Defaults to Asia/Kolkata.',
    },
    SEED_USER_EMAIL: {
      group: 'Seeding (local only)',
      secret: false,
      description: 'Read by `npm run seed:user` only. A deployment has no business carrying it.',
    },
    SEED_USER_PASSWORD: {
      group: 'Seeding (local only)',
      secret: true,
      description:
        'Deliberately ignored when it comes from a file -- dotenv expansion can alter it. Pass it in the shell or let the script generate one.',
    },
    SEED_USER_USERNAME: {
      group: 'Seeding (local only)',
      secret: false,
      description: 'Falls back to the local part of SEED_USER_EMAIL.',
    },
  };

export interface EnvRequirement {
  name: keyof Env;
  /** Read off the schema: does it accept `undefined`? */
  required: boolean;
  secret: boolean;
  group: string;
  description: string;
}

/**
 * Every variable the schema knows about, with required-ness derived from it.
 *
 * A variable with a `.default()` counts as not required, which is the honest
 * answer: the app boots without it.
 */
export function envRequirements(): EnvRequirement[] {
  return (Object.keys(ENV_DOCS) as (keyof Env)[]).map((name) => {
    const field = envSchema.shape[name];

    return {
      name,
      required: !field.safeParse(undefined).success,
      ...ENV_DOCS[name],
    };
  });
}

export interface EnvPresence {
  name: string;
  required: boolean;
  secret: boolean;
  group: string;
  /** Blank counts as absent, exactly as `readEnv` treats it. */
  present: boolean;
}

/**
 * Which variables are set, by name.
 *
 * NEVER RETURNS A VALUE. This is read by an HTTP endpoint and by a command
 * whose output gets pasted into issues, and a tool that reports configuration
 * by printing it is a tool that leaks the database password the first time
 * somebody uses it.
 */
export function checkEnv(source: Record<string, string | undefined> = process.env): EnvPresence[] {
  const cleaned = readEnv(source);

  return envRequirements().map(({ name, required, secret, group }) => ({
    name,
    required,
    secret,
    group,
    present: Object.hasOwn(cleaned, name),
  }));
}

/** The required variables that are not set. Names only. */
export function missingRequired(
  source: Record<string, string | undefined> = process.env,
): string[] {
  return checkEnv(source)
    .filter((entry) => entry.required && !entry.present)
    .map((entry) => entry.name);
}

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
