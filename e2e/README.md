# End-to-end tests

Empty on purpose. There are no E2E specs yet.

`playwright.config.ts` exists ahead of them because Playwright without a config
takes the repository root as its `testDir` and collects `src/**/*.test.ts` --
the Vitest suite -- which fails on `server-only` during discovery and, past
that, on `vi.mock`. The config is the boundary that stops it; the specs are a
separate piece of work.

## Conventions

- Playwright specs are `e2e/**/*.spec.ts`.
- Vitest unit tests are `src/**/*.test.ts`, and stay there.

The split is by directory _and_ by filename so neither runner can pick up the
other's files by accident.

## Before the first spec

The E2E workflow is parked (`.github/workflows/e2e.yml` runs on manual dispatch
only). Turning it back on needs, at minimum:

- `webServer` in `playwright.config.ts`, so the suite has an app to talk to.
- A decision about MongoDB in CI. A signed-out spec on `/` needs no database --
  the landing page only calls `auth()`, which is JWT-backed -- but anything
  behind sign-in needs a service container and a seeded user.
- `SKIP_ENV_VALIDATION=1`, or a full set of environment variables for the run.
