# End-to-end tests

Playwright, against a production build (`npm run start`) and a scratch
database.

## Running them

```bash
npm run build && npm run start          # a production build, in another shell
MONGODB_URI='...-dev' \
PACT_E2E_IDENTIFIER='<username>' \
PACT_E2E_PASSWORD='<password>' \
  npx playwright test
```

Every spec skips without `PACT_E2E_IDENTIFIER` and `PACT_E2E_PASSWORD` — a run
with no credentials is not a silent pass, it is a visible skip.

`MONGODB_URI` must point at a scratch database. The seeds below refuse to run
anywhere else: they check the connection string, not `NODE_ENV`, because a
local run against production has `NODE_ENV=development`.

A production build specifically, not `next dev`: the service worker registers
in production only, and the staleness and offline paths need it.

## Three accounts, three storage states

The suite's structural weakness was that every spec signed in as the primary,
because the primary was the only account any seed produced. Surfaces belonging
to anybody else were then recorded as untestable, which is how the landing
page, the overseer's pages and recovery mode all shipped unexercised.

| Project          | Account     | Seeded by               |
| ---------------- | ----------- | ----------------------- |
| `setup` → `app`  | the primary | `npm run seed:user`     |
| `setup:overseer` | `overseer1` | `npm run seed:overseer` |
| `setup:recovery` | `behind1`   | `npm run seed:recovery` |

Both extra accounts are provisioned by their setup project on every run, with
`--reset`, so a run never depends on what the last one left behind. The
overseer goes through the real invite and redemption path rather than an
inserted role field; the recovery account is seeded with ordinary overdue
commitments rather than a forced flag.

Recovery mode needs its own account because it **replaces** the dashboard —
pushing the primary over the thresholds would replace the dashboard for the
Today suite, the motion suite and the responsive sweep at the same time.

## The specs

| File                  | What it is for                                          |
| --------------------- | ------------------------------------------------------- |
| `environment.spec.ts` | Fails when a conditional skip is about to fire silently |
| `landing.spec.ts`     | The signed-out entry point, outside the shell           |
| `today.spec.ts`       | The primary's dashboard                                 |
| `responsive.spec.ts`  | Every surface at 390 / 768 / 1024 / 1440 / landscape    |
| `motion.spec.ts`      | Reduced motion cuts; a completion animates the row only |
| `overseer.spec.ts`    | The overseer's pages, and the primary's 403s            |
| `recovery.spec.ts`    | Recovery mode replacing the dashboard                   |
| `uncovered.spec.ts`   | The surfaces the rest structurally cannot see           |

`uncovered.spec.ts` also records what is still not covered and why. One entry
is left: push delivery, which needs a real device.

## Conventions

- Playwright specs are `e2e/**/*.spec.ts`.
- Vitest unit tests are `src/**/*.test.ts`, and stay there.

The split is by directory _and_ by filename so neither runner can pick up the
other's files by accident. Without a config Playwright takes the repository
root as its `testDir` and collects the Vitest suite, which fails on
`server-only` during discovery and, past that, on `vi.mock`.

- **A spec that mutates state creates what it acts on.** The no-refresh check
  once completed whichever commitment it found, so it passed once and skipped
  forever after — indistinguishable from a deleted test, with the suite green.
- **Assert what is banned, not an exhaustive allow-list**, where the rule is
  about a class of thing. The motion suite checks that nothing expressive
  animates rather than listing every property that legitimately might.

## CI

`.github/workflows/e2e.yml` runs on manual dispatch only. Turning it on needs a
MongoDB service container, a seeded user, and either `SKIP_ENV_VALIDATION=1` or
a full set of environment variables.
