/**
 * Validation for the `returnTo` parameter.
 *
 * Not `server-only`: the sign-in form needs the same rule on the client, and
 * two implementations of an open-redirect guard is how one of them ends up
 * wrong.
 */

/** Where a signed-in user goes when there is no valid destination to return to. */
export const DEFAULT_SIGNED_IN_PATH = '/dashboard';

/** Longer than any real route; a giant value is a probe, not a destination. */
const MAX_LENGTH = 512;

/** Control characters, including CR and LF, which are header-injection tools. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Narrows an untrusted `returnTo` to a same-origin path, or the fallback.
 *
 * Rejection is silent and indistinguishable from "absent" on purpose: a caller
 * probing for an open redirect learns nothing from the response.
 *
 * The rule is allow-list shaped -- it must be a path, and the parsed result
 * must still be same-origin -- because the deny-list version of this check is
 * where open redirects come from. `//evil.com` is protocol-relative, and
 * `/\evil.com` is the same attack with a backslash, which browsers fold to `/`
 * while a naive `startsWith('//')` check does not.
 */
export function safeReturnTo(value: unknown, fallback: string = DEFAULT_SIGNED_IN_PATH): string {
  if (typeof value !== 'string') return fallback;
  if (value.length === 0 || value.length > MAX_LENGTH) return fallback;

  // Must be a path.
  if (!value.startsWith('/')) return fallback;

  // Protocol-relative, in either slash direction.
  const second = value[1];
  if (second === '/' || second === '\\') return fallback;

  // Browsers normalise backslashes to slashes in paths, so one anywhere can
  // become the protocol-relative case after parsing.
  if (value.includes('\\')) return fallback;

  if (CONTROL_CHARS.test(value)) return fallback;

  // Final check: parse it and confirm it did not escape the origin. This is
  // what catches anything the explicit rules above missed.
  try {
    const base = 'https://pact.invalid';
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;

    // Return the normalised path, so what we redirect to is what we validated.
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}
