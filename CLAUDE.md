# CLAUDE.md

Read this before doing anything else in this repository.

## What this is

A personal execution dashboard for exactly one user.

**MongoDB is the execution store.** This app owns the data outright and is the
behavioural intelligence layer over it, plus a study planner.

Two surfaces:

| Route        | Surface                                |
| ------------ | -------------------------------------- |
| `/dashboard` | The interactive surface. Read and act. |
| `/study`     | Study planner.                         |

`/` is the landing page and sign-in entry point. It renders outside the nav
shell so a signed-out visitor never sees navigation.

`/mirror`, the read-only smart-mirror display, is **deferred**. The route stub
has been removed rather than left as a public page. It comes back only with a
device-token auth story of its own; until then neither `/mirror` nor
`/api/mirror/*` exists.

## The feature test

> **Does this increase the probability that the user actually does the thing?**

Every proposed feature faces that question. Not "is this interesting", not "is
this technically neat", not "would this look good". Only that.

Anything that fails it **does not get built**. It gets an entry in
[`docs/rejected.md`](docs/rejected.md) with the reason it failed. Writing the
rejection down is not optional — it is what stops the same idea being
relitigated in three months.

If you are unsure whether something passes, it probably does not. Ask.

## Hard anti-features

Never build these. They are not "later", not "behind a flag", not "opt-in".

- Points
- XP
- Levels
- Badges
- Streaks
- Confetti
- Celebratory animation
- Leaderboards
- Any reward for **creating** or **reorganising** tasks
- Any score driven by **task volume**

The reasoning: every one of these rewards _engagement with the tool_ rather
than _execution of the work_. They make tidying the backlog feel like progress.
This app exists to make the gap between commitment and execution visible, and a
reward layer papers directly over that gap.

A streak in particular is a lie with a number attached: it converts one missed
day into a reason to stop looking at the app entirely, which is the opposite of
what this is for.

If a request seems to want one of these, propose the underlying need instead —
usually it is "I want to see whether I am improving", which is answered by
honest trend data over the event log, not by a score.

## Data ownership

**MongoDB is the single source of truth for all data. There is no external
store.** Every field is owned here, written here, and read here. Nothing this
app needs lives anywhere else.

### Google is postponed

Google Tasks and Calendar integration is **postponed**, not in progress. There
is no sync code, and none should be written.

When Google is eventually added it is strictly:

- an **optional one-way mirror OUT of Pact**, and
- an **optional read-only data source**.

It **never owns a field**, and it is **never required for the app to
function**. Pact must work completely with Google absent, disconnected, or
broken. Any design that makes a Google response authoritative over a local
value is wrong, and any design that blocks a user action on a Google call
being reachable is wrong.

There is no due-date reconciliation problem any more, because there is no
reconciliation. `dueAt` is a local field with a real time on it, and nothing
external gets to overwrite it.

### Authentication

Auth is **email and password, single user, no third-party identity provider.**

Google OAuth may be added later **purely to authorise API access** for a user
who is already signed in. It is not a login method, and it never becomes one.
Signing in must never depend on Google being reachable.

## Event log rule

**Every state change appends an immutable event.**

**No behavioural metric is ever stored as a mutable field.**

There is no `missedCount: 7` column. There is no `completionRate: 0.62`. Those
are computed from the event log, on read, every time.

Why: a mutable counter cannot be audited, cannot be recomputed after a bug, and
quietly drifts from reality. The event log is the only thing that can answer
"why does it say that?" — and this app's entire value is being trustworthy when
it tells the user something uncomfortable.

Events are append-only. Never update an event. Never delete one. A correction
is a new event.

Derived values belong in [`src/lib/behavior/`](src/lib/behavior/) as pure
functions over events: no I/O, no database access, no `fetch`, and no reading
the clock — pass the current time in as an argument so the analysis stays
deterministic and testable.

## Deployment constraints

Deployed on **Vercel Hobby**. This is a hard constraint on architecture:

- **No long-running processes.** Every request finishes inside the function
  timeout.
- **No background workers.** There is no queue, no daemon, no persistent
  process to hand work to.
- **Cron runs once daily, at hourly precision, in UTC.** Not every 5 minutes.
  Not at 06:30. Hobby gives one daily invocation and the schedule is expressed
  in UTC, so `APP_TIMEZONE` offsets have to be reasoned about by hand.

Consequence: **sync is on-demand, triggered by requests.** When a surface
loads, it syncs what it needs. Do not design anything that assumes a background
process will have already run.

Database is **MongoDB Atlas M0** (free tier), which caps the cluster's
connections. Serverless functions must reuse a cached connection — see
[`src/lib/db/mongoose.ts`](src/lib/db/mongoose.ts). Connecting per invocation
will exhaust the pool and take the app down.

## Conventions

- **Zod schemas are the source of truth for types.** Define the schema in
  [`src/lib/schemas/`](src/lib/schemas/), then derive the TypeScript type with
  `z.infer`. Never hand-write an interface that duplicates a schema.

  The one exception is the environment schema, which lives in
  [`src/lib/env.ts`](src/lib/env.ts) alongside the parsed values rather than in
  `src/lib/schemas/`. That module is `server-only`, and putting it in the
  shared schemas directory invites a client component to import it and blow up
  the build. Env is **one module**, deliberately.

- **Store UTC, render in `APP_TIMEZONE`.** Every timestamp in the database is
  UTC. Timezone is a presentation concern; helpers live in
  [`src/lib/time.ts`](src/lib/time.ts).
- **No network calls in tests.** Mock at the module boundary. A test that needs
  Atlas or the Google API is not a test we run.
- **Environment variables are validated on first use**, via `getEnv()` in
  [`src/lib/env.ts`](src/lib/env.ts), which throws loudly and names every
  missing or invalid variable rather than failing later at a random request.
  Validation is deliberately **not** done at module load: `next build` imports
  every route module to collect its segment config, so validating on import
  makes the compile step demand production secrets it never uses, and the build
  dies. Never move this back to module scope, and never read a value from
  `process.env` directly to work around it.

  A blank value counts as unset, because that is what a hosting dashboard or CI
  produces for a variable declared without a value. `SKIP_ENV_VALIDATION=1`
  bypasses the check for jobs that only compile and test.

- **The parsed environment is `server-only`.** `src/lib/env.ts` imports the
  `server-only` package, so importing it from a client component is a build
  error rather than a leaked secret. There is a test that fails if that import
  is ever removed. Never re-export env values through a client module.
- **Passwords are hashed with `@node-rs/argon2`.** Never the `argon2` package:
  it compiles natively and fails on Vercel's build image. `@node-rs/argon2`
  ships prebuilt binaries. `bcryptjs` is the pure-JS fallback if those ever
  break.
- **Auth failures are indistinguishable.** Wrong password, unknown email and
  locked-out account all return the same generic error. Never add a message,
  status code, or timing shortcut that lets a caller tell which email addresses
  exist.
- **Route protection lives in [`src/proxy.ts`](src/proxy.ts).** Next.js 16
  renamed `middleware.ts` to `proxy.ts`; the old filename silently does
  nothing. Proxy runs on the Node.js runtime and must stay free of database
  access — it verifies the session JWT and nothing else.
- TypeScript is `strict`, plus `noUncheckedIndexedAccess`. Do not weaken it.

## Layout

```
src/app/            routes
src/app/page.tsx    landing + sign-in, deliberately OUTSIDE (shell)
src/app/(shell)/    routes rendered inside the nav shell (signed-in only)
src/app/api/        route handlers
src/proxy.ts        route protection (Next 16's renamed middleware)
src/lib/auth/       Auth.js config, password hashing, login throttling
src/lib/db/         mongoose connection + models
src/lib/schemas/    zod schemas — source of truth for types
src/lib/env.ts      environment schema + parsed values, server-only
src/lib/behavior/   pure analysis functions, no I/O
src/components/
src/styles/         design tokens + global stylesheet
scripts/            dev and operator scripts
docs/
```

The landing page sits outside `(shell)` on purpose: a signed-out visitor must
not render navigation to routes they cannot reach.

## Design

Dark only. Tokens are CSS custom properties in
[`src/styles/tokens.css`](src/styles/tokens.css): a five-value palette, a type
scale, and a spacing scale, mapped into a custom Tailwind theme in
[`src/styles/globals.css`](src/styles/globals.css).

**Tailwind's default colour palette is removed.** `bg-slate-800` resolves to
nothing on purpose. Every colour comes from the five tokens. If a component
seems to need a sixth colour, it probably wants opacity (`text-text/60`) or it
wants a different design.

Breakpoints are 640 / 1024 / 1440 (`sm` / `lg` / `xl`).

## Current state

Scaffold, tooling, and **email/password authentication**. No features yet, and
no Google APIs by design.

Working: sign in and sign out, a seeded single user, session-gated `/dashboard`
and `/study`, database-backed login throttling, and `/api/health` plus an
authenticated `/api/health/detail`.

There is **no public signup route and no password reset flow.** Users are
created with `npm run seed:user` and passwords changed with
`npm run change:password`. Both reasons are recorded in
[`docs/decisions.md`](docs/decisions.md).

Decisions already made and their reasoning are in
[`docs/decisions.md`](docs/decisions.md).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
