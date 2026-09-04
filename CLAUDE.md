# CLAUDE.md

Read this before doing anything else in this repository.

## What this is

A personal execution dashboard for exactly one user.

**Google Tasks is the execution store.** This app is the behavioural
intelligence layer over it, plus a study planner. It does not try to replace
Google Tasks and it does not try to be a better task manager.

Three surfaces:

| Route        | Surface                                            |
| ------------ | -------------------------------------------------- |
| `/dashboard` | The interactive surface. Read and act.             |
| `/mirror`    | Read-only display for a wall-mounted smart mirror. |
| `/study`     | Study planner.                                     |

`/` is the landing page and sign-in entry point.

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

The boundary is not negotiable, and getting it wrong loses user data.

**Google Tasks owns:**

- Task existence
- Title
- Notes
- Completion status
- List membership
- Due **DATE**

**This app owns:**

- Everything else
- The full event history

### The due-date trap

The Google Tasks API stores due dates **only** — it accepts an RFC 3339
timestamp and silently discards the time portion, returning midnight UTC.

Therefore:

- **Local `dueAt` is the real deadline.** It carries the time.
- **A Google round-trip must never overwrite `dueAt`.** Reading a task back
  from Google and writing its `due` field into `dueAt` destroys the time the
  user set, every sync, permanently.

When reconciling, treat Google's `due` as a date-level signal only. If the date
differs from local `dueAt`'s date in `APP_TIMEZONE`, the user changed it in
Google — carry the date across and keep the local time-of-day. If the date
matches, ignore Google's value entirely.

Any sync code that assigns Google's `due` straight into `dueAt` is a bug, even
if the tests pass.

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

- TypeScript is `strict`, plus `noUncheckedIndexedAccess`. Do not weaken it.

## Layout

```
src/app/            routes
src/app/(shell)/    routes rendered inside the nav shell
src/app/api/        route handlers
src/lib/db/         mongoose connection + models
src/lib/schemas/    zod schemas — source of truth for types
src/lib/behavior/   pure analysis functions, no I/O
src/components/
src/styles/         design tokens + global stylesheet
docs/
```

`/mirror` deliberately sits outside `(shell)` so it renders with its own bare
layout and no navigation.

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

Scaffold and tooling only. No authentication, no Google APIs, no features. The
route stubs are laid out correctly and render nothing meaningful yet.

Decisions already made and their reasoning are in
[`docs/decisions.md`](docs/decisions.md).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
