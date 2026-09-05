import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws when imported outside a React Server Component
      // graph. Tests run in plain Node, so point it at a no-op.
      'server-only': fileURLToPath(new URL('./src/test/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    // Node by default -- almost everything here is server code. The handful of
    // component tests opt into a DOM per file with `@vitest-environment`.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    /**
     * Env validation runs at module load, so the suite needs a complete, obviously
     * fake environment in place before any test file is imported. Nothing here
     * reaches the network -- see CLAUDE.md, "no network calls in tests".
     */
    env: {
      MONGODB_URI: 'mongodb://127.0.0.1:27017/pact-test',
      AUTH_SECRET: 'test-auth-secret-value-not-real',
      CRON_SECRET: 'test-cron-secret-value-not-real',
      APP_TIMEZONE: 'Asia/Kolkata',
    },
  },
});
