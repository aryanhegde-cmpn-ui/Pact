import { z } from 'zod';

/**
 * Roles.
 *
 * `primary` is the person doing the work. `overseer` administers real-world
 * rewards and consequences and can read the record but not change the work.
 *
 * An enum plus a permission matrix, deliberately, rather than booleans or
 * subclassed collections: a third role later is a new value and a new column
 * in the matrix, not a new subsystem. See src/lib/auth/permissions.ts.
 */
export const userRoleSchema = z.enum(['primary', 'overseer']);
export type UserRole = z.infer<typeof userRoleSchema>;

/**
 * Emails are stored lowercased and trimmed. Every lookup goes through
 * `normaliseEmail` so a login cannot miss on capitalisation alone.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('must be a valid email address'));

/**
 * 12 characters, matching the seed script's floor. Length is the only rule:
 * composition requirements push people toward `Password1!` and are worse than
 * the length they displace.
 */
export const passwordSchema = z.string().min(12, 'must be at least 12 characters');

/**
 * Names that must never belong to a user.
 *
 * `admin`, `root` and `system` because they imply authority the app does not
 * grant; `pact` and `overseer` because they read as official; `api` because it
 * collides with the route namespace; and `null` because a username that
 * stringifies to a falsy-looking value invites a bug somewhere downstream.
 */
export const RESERVED_USERNAMES: readonly string[] = [
  'admin',
  'root',
  'system',
  'pact',
  'overseer',
  'api',
  'null',
];

/**
 * A username.
 *
 * Deliberately narrow: lowercase letters, digits, hyphen and underscore. No
 * dots (they read as file extensions in routes), no unicode (two visually
 * identical names would be different strings, which is an impersonation
 * vector), no leading or trailing separator.
 */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .min(3, 'must be at least 3 characters')
      .max(20, 'must be at most 20 characters')
      .regex(
        /^[a-z0-9][a-z0-9_-]*[a-z0-9]$/,
        'may use lowercase letters, digits, hyphen and underscore, and must start and end with a letter or digit',
      )
      .refine((value) => !RESERVED_USERNAMES.includes(value), {
        message: 'that username is reserved',
      }),
  );

/**
 * Case-insensitive uniqueness, done with a normalised field.
 *
 * NOT a collation on the index. A stored `usernameLower` behaves identically
 * across drivers and shells, survives a dump and restore, and is obvious in a
 * query — whereas a collation is invisible in the document, applies only when
 * the query happens to request it, and silently degrades to case-sensitive
 * when it does not.
 */
export function normaliseUsername(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Whether an identifier looks like an email.
 *
 * Used only to decide which field to look up. It must never change the
 * OUTCOME of a failed sign-in: an unknown email and an unknown username return
 * byte-identical responses.
 */
export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes('@');
}

export const userSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  usernameLower: z.string(),
  passwordHash: z.string().min(1),
  displayName: z.string().trim().min(1).max(80),
  role: userRoleSchema,
  createdAt: z.date(),
  lastLoginAt: z.date().nullable(),
});

export type User = z.infer<typeof userSchema>;

/**
 * The credentials a sign-in attempt carries.
 *
 * ONE field, accepting either a username or an email. Validated only as
 * "non-empty and not absurd" -- applying the username or email rules here
 * would reject malformed input before the lockout counter saw it, which is
 * free unlimited guessing for anything that fails the format check.
 */
export const credentialsSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your username or email').max(320),
  password: z.string().min(1, 'Enter your password'),
});

export type Credentials = z.infer<typeof credentialsSchema>;

/** Single definition of email normalisation, used by lookups and writes alike. */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}
