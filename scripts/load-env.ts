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
import { createRequire } from 'node:module';

/**
 * `@next/env` is CommonJS, and package.json declares `"type": "module"`, so a
 * named import of it fails at load with "does not provide an export named
 * loadEnvConfig". `createRequire` is the interop that always works, rather
 * than relying on Node's named-export detection for a CJS module.
 */
const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('@next/env') as {
  loadEnvConfig: (
    dir: string,
    dev: boolean,
    logger: { info: (msg: string) => void; error: (msg: string) => void },
  ) => unknown;
};

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production', {
  info: () => {},
  error: console.error,
});
