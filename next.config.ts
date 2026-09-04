import { execSync } from 'node:child_process';

import type { NextConfig } from 'next';

/**
 * Resolved once, at build time. On Vercel the platform supplies the SHA; locally
 * we fall back to git so /api/health is still useful during development.
 */
function resolveCommitSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    APP_COMMIT_SHA: resolveCommitSha(),
  },
};

export default nextConfig;
