import { z } from 'zod';

/**
 * Roles exist from the first user onward so that growing past one account is a
 * data change rather than a migration. There is exactly one user today.
 */
export const userRoleSchema = z.enum(['owner', 'member']);
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

export const userSchema = z.object({
  email: emailSchema,
  passwordHash: z.string().min(1),
  displayName: z.string().trim().min(1).max(80),
  role: userRoleSchema,
  createdAt: z.date(),
  lastLoginAt: z.date().nullable(),
});

export type User = z.infer<typeof userSchema>;

/** The credentials a sign-in attempt carries. */
export const credentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});

export type Credentials = z.infer<typeof credentialsSchema>;

/** Single definition of email normalisation, used by lookups and writes alike. */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}
