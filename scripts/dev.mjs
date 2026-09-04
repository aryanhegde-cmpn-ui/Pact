#!/usr/bin/env node
/**
 * Starts `next dev` and opens the app in the default browser once the server is
 * actually listening.
 *
 * Next has no `--open` flag, and the usual shell one-liner
 * (`next dev & open-cli ...`) both pulls in dependencies and breaks Ctrl+C, so
 * this supervises the child directly instead.
 *
 * Arguments are forwarded: `npm run dev -- -p 4000` works.
 * Skip the browser with `--no-open` or `BROWSER=none`.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

const argv = process.argv.slice(2);
const shouldOpen = !argv.includes('--no-open') && process.env.BROWSER !== 'none';
const forwarded = argv.filter((arg) => arg !== '--no-open');

const port = resolvePort(forwarded);
const url = `http://localhost:${port}`;

// Run the CLI through this Node binary rather than relying on PATH or a shell,
// which keeps behaviour identical across platforms and npm versions.
const child = spawn(process.execPath, [nextBin, 'dev', ...forwarded], { stdio: 'inherit' });

const SIGNALS = ['SIGINT', 'SIGTERM'];

let exited = false;
child.on('exit', (code, signal) => {
  exited = true;

  if (!signal) {
    process.exit(code ?? 0);
    return;
  }

  // Reproduce a signal death as a signal death so the shell reports Ctrl+C
  // honestly. The handlers below have to go first: re-raising a signal you are
  // still listening for just re-enters your own handler and hangs forever.
  for (const name of SIGNALS) process.removeAllListeners(name);
  process.kill(process.pid, signal);
});

// Ctrl+C reaches the child directly via the process group; this covers a
// programmatic kill of the supervisor alone.
for (const signal of SIGNALS) {
  process.on(signal, () => {
    if (!exited) child.kill(signal);
  });
}

if (shouldOpen) {
  waitForServer(url)
    .then((ready) => {
      if (ready && !exited) openBrowser(url);
    })
    // Never let a browser problem take down the dev server.
    .catch(() => {});
}

/** `-p 4000`, `--port=4000`, `PORT=4000`, else Next's default. */
function resolvePort(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-p' || arg === '--port') return args[i + 1] ?? '3000';
    const match = /^--port=(.+)$/.exec(arg ?? '');
    if (match) return match[1];
  }
  return process.env.PORT ?? '3000';
}

/** Polls until the dev server answers. Resolves false if it never does. */
async function waitForServer(target, timeoutMs = 90_000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline && !exited) {
    try {
      // Any response means it is listening -- a 500 from a compile error still
      // counts, since that is exactly when you want the browser open.
      await fetch(target, { signal: AbortSignal.timeout(2_000) });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return false;
}

function openBrowser(target) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [target]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', target]]
        : ['xdg-open', [target]];

  const opener = spawn(command, args, { stdio: 'ignore', detached: true });
  opener.on('error', () => {
    console.log(`\n  Could not open a browser automatically. Open ${target} manually.\n`);
  });
  opener.unref();
}
