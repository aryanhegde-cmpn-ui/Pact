import { z } from 'zod';

/**
 * Recovery codes: the shape, the alphabet, and how typed input is normalised.
 *
 * ---------------------------------------------------------------------------
 * WHY CODES AND NOT A RESET EMAIL
 * ---------------------------------------------------------------------------
 * docs/decisions.md 007 said there would be no password reset flow, because
 * there is no email provider and a token-by-email chain was not worth its cost
 * for one user. That reasoning still holds, and it is still not being built.
 *
 * A recovery code needs none of it: no provider, no deliverability, no inbox
 * to compromise, no third-party dependency. It is a bearer credential the user
 * already holds, which is exactly the thing an email chain spends four moving
 * parts trying to create. See decision 053.
 * ---------------------------------------------------------------------------
 */

/**
 * The alphabet: digits 2-9 and A-Z without I, L or O.
 *
 * These are transcribed by hand from a password manager or a piece of paper,
 * so every pair that looks alike at a glance is removed rather than
 * "helpfully" corrected on input. 0 and O, 1 and I and l -- one of each pair
 * would have to win, and a code that silently becomes a different code is
 * worse than one that is rejected.
 *
 * 31 characters over 10 positions is about 2^49.5, which is not a password but
 * does not need to be: there are ten of them, they are single-use, and guessing
 * runs into the same lockout counter as the sign-in form after ten tries.
 */
export const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Characters per code. */
export const RECOVERY_CODE_LENGTH = 10;

/** Codes issued per set. */
export const RECOVERY_CODE_COUNT = 10;

/** Below this, settings says so. Two left is a warning; ten is not. */
export const RECOVERY_LOW_WATERMARK = 3;

/** Where the hyphen goes, for reading and for reading aloud. */
export const RECOVERY_GROUP_SIZE = 5;

/** `A2B3C-D4E5F`. The only form ever displayed. */
export function formatRecoveryCode(code: string): string {
  const groups: string[] = [];
  for (let index = 0; index < code.length; index += RECOVERY_GROUP_SIZE) {
    groups.push(code.slice(index, index + RECOVERY_GROUP_SIZE));
  }

  return groups.join('-');
}

/**
 * Accepts what a person actually types.
 *
 * Case, spaces and hyphens are all noise introduced by the display format or
 * by the transcription, so they are stripped rather than rejected -- somebody
 * copying `a2b3c-d4e5f` out of a password manager has typed the right code.
 *
 * Nothing else is corrected. A character outside the alphabet is left in
 * place, so the result fails validation rather than quietly becoming a
 * different code.
 */
export function normaliseRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

const alphabetPattern = new RegExp(`^[${RECOVERY_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`);

export function isWellFormedRecoveryCode(value: string): boolean {
  return alphabetPattern.test(value);
}

/**
 * Step one of the flow: identifier and code, together.
 *
 * ---------------------------------------------------------------------------
 * BOTH FIELDS OR NEITHER. THIS IS THE WHOLE REASON THE FORM HAS ONE STEP.
 * ---------------------------------------------------------------------------
 * Asking for the identifier first and the code second would mean answering
 * "does this account exist" before any secret had been presented -- an
 * enumeration oracle on a public page, reachable without a single valid
 * credential. The two arrive together and fail together, with one message.
 *
 * Validated loosely on purpose, exactly as `credentialsSchema` is: a strict
 * format check here would reject input before the lockout counter saw it,
 * which is free unlimited guessing for anything malformed.
 * ---------------------------------------------------------------------------
 */
export const recoveryVerifySchema = z.object({
  identifier: z.string().trim().min(1).max(320),
  code: z.string().trim().min(1).max(64),
});

export const recoveryResetSchema = z.object({
  token: z.string().trim().min(1).max(256),
  password: z.string().min(1).max(512),
});

/**
 * The one thing a recovery token is allowed to do.
 *
 * An enum with a single member rather than a boolean or an absent field: the
 * next purpose someone adds has to be named here, and the reset route checks
 * for this exact value. A token that could be widened by forgetting a check is
 * the failure this shape prevents.
 */
export const RECOVERY_TOKEN_PURPOSE = 'set-password' as const;

/** Ten minutes. Long enough to choose a password, short enough to be useless later. */
export const RECOVERY_TOKEN_TTL_MS = 10 * 60 * 1000;
