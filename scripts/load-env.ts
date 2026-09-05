/**
 * Loads `.env.local` (and friends) for scripts that run outside Next.
 *
 * Uses Next's own loader rather than dotenv so the file precedence is
 * identical to what `next dev` and `next build` see -- a script that reads a
 * different value than the app would is worse than one that reads none.
 *
 * Imported for its side effect, so it must come before anything that calls
 * `getEnv()`.
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production', {
  info: () => {},
  error: console.error,
});
