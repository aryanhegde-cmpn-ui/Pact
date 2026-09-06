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

## Terminology

**The core entity is a Commitment, not a task.** This is deliberate, and it
holds in collection names, type names, route names and UI copy.

A task is an item on a list. A commitment is something you said you would do,
with a deadline you are accountable to and an `outcome` that says what is true
when it is done. "Work on the report" cannot be verified; "the report is sent to
Priya" can. The vocabulary is load-bearing: calling these tasks is how the app
turns back into a to-do list.

A **Series** holds a recurrence rule. Its **occurrences** are real Commitment
documents, so an occurrence can be completed, postponed and reasoned about like
any other commitment.

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

## The deadline lockdown

**`changeDeadline()` in [`src/lib/commitments/deadline.ts`](src/lib/commitments/deadline.ts)
is the only function permitted to write `dueAt`.** There is a test that scans
the whole of `src/` and fails if any other module writes it.

**`originalDueAt` is written once, at creation, and never again.** It is
`immutable` on the model and additionally guarded against raw `$set` updates.

The generic update path rejects any body containing `dueAt` — the schema is
`.strict()` and the route names the field explicitly in its error, so a caller
learns _why_, not just that a key was unrecognised.

This is enforced structurally rather than by convention because it is the
product, not a style preference. A deadline that can move silently is not a
deadline. The gap between what the user committed to and what they did is the
only thing this app has to show them, and an unlogged reschedule erases it.
Requiring a reason makes moving a deadline a decision someone has to
articulate, rather than a frictionless drag that happens ten times without ever
feeling like anything.

## Miss detection without a scheduler

A commitment is missed when `now > dueAt` and its status is neither `done` nor
`abandoned`. That is **derived on read** — there is no `isMissed` column and
there must never be one, because it changes with the clock rather than with a
write.

The first read that observes a miss lazily appends `DEADLINE_MISSED`. Vercel
Hobby allows one daily cron, so there is no per-minute job and adding one for
this would be disproportionate.

Concurrent serverless invocations all notice the same miss at once, so
idempotency comes from a **unique partial index** on `(entityId, type, ts)` for
that event type — not from checking first and writing second, which races
between the two steps. `appendEvent` treats the resulting duplicate-key error as
success.

**`ts` is in that key deliberately.** For this event type `ts` is the missed
deadline, so each distinct deadline can be missed exactly once. Keying on
`(entityId, type)` alone allowed one miss per commitment _for its entire life_:
a commitment missed on Monday, postponed, and missed again on Friday recorded
one miss and silently dropped the second, which reads a chronic postponer as a
one-off slip. Repeated misses against a moving deadline are the single most
important thing this product measures — never narrow this key again.

The event is timestamped at the **deadline**, not at the moment a read noticed
it. Otherwise the log would record misses as happening whenever the user next
opened the app.

When the notification tick arrives it will emit these proactively. Both paths go
through `appendEvent` and the same index, so whichever gets there first wins and
the derived read keeps working either way.

## Series and occurrences

- Occurrences are **materialised lazily**: reading a date range creates any
  missing occurrences in it, plus a 14-day lookahead. No background job.
- A unique compound index on `(seriesId, occurrenceDate)` makes concurrent
  materialisation safe; a duplicate-key error is success, not a failure.
- Rules are evaluated on the **local calendar in `APP_TIMEZONE`** and stored as
  UTC instants. `occurrenceDate` is a `YYYY-MM-DD` string, not a `Date`, because
  two different instants can be the same local day and a `Date`-keyed unique
  index would let both through.
- **Editing a series never rewrites past occurrences.** They are historical
  fact. The scopes are `this-occurrence` (edit the one document) and
  `this-and-future` (end the current series, start a new one from today). There
  is deliberately no "all occurrences".
- **Ending a series is not a delete.** Past occurrences stay. Only future,
  untouched, still-pending ones are removed.

## Notifications

The queue is a **Notification collection**, not a scheduler. Rows are enqueued
when a commitment is created, when its deadline moves, and as series
occurrences materialise; they are delivered by whichever request next arrives
after they come due. Vercel Hobby has one daily cron, so there is nothing else
to deliver them.

**`channel` is on the row.** In-app is the only channel delivered today; web
push is a second delivery adapter over the same queue, which is why every
enqueue site, the cancellation logic and the delivery rules are already
channel-agnostic. Never add a parallel queue for a new channel — two queues
drift.

Wiring that must not be broken:

| Event                          | Queue effect                                                 |
| ------------------------------ | ------------------------------------------------------------ |
| Commitment created             | enqueue                                                      |
| **`changeDeadline()`**         | **cancel pending, then re-enqueue against the new deadline** |
| Completed or abandoned         | cancel pending                                               |
| Series occurrence materialised | enqueue                                                      |

The `changeDeadline` case is the one that fails quietly: the deadline moves,
the old `DEADLINE_APPROACHING` stays queued, and the user is notified about a
deadline that no longer exists while hearing nothing about the one that does.

**Cancelling does not delete.** It sets `status: 'cancelled'` and leaves the row,
and the unique key does not include status — so re-enqueueing at a
previously-used instant collides with a cancelled row. That collision must
**revive** the row, not be counted as "already queued"; counting it leaves the
commitment with no pending notifications at all. Moving a deadline forward and
back again is the obvious way in. A row that has already been `sent` is never
revived: re-sending something the user has seen is worse than not sending it.

Two delivery rules:

- **Staleness cap.** Anything more than two hours past its scheduled time is
  marked `skipped`, never sent. Otherwise opening the app after a quiet week
  delivers forty notifications at once, which teaches exactly one lesson.
  `ACCOUNTABILITY_CHECK` is exempt while its commitment is unresolved — "did
  you do it?" has not expired, and suppressing it would mean the commitments
  avoided longest are asked about least.
- **Quiet hours**, default 00:00–07:00 in `APP_TIMEZONE`, applied at enqueue so
  the stored `scheduledFor` is when delivery will actually happen. Notifications
  inside the window **defer to its end**, never drop.

Copy is accountability framing, not reminders: name the commitment, what
finishing it looks like, and how long the user said it would take.
`ACCOUNTABILITY_CHECK` offers **both** answers as actions — offering only "mark
done" makes the honest answer the effortful one.

## PWA

The service worker in [`public/sw.js`](public/sw.js) is **hand-written and stays
that way.** No `next-pwa`, no build plugin: this needs a `push` handler we
control, and the generated ones have been unreliable against the App Router. A
service worker is the one thing that can persist a bug across deploys.

- **Registered in production only.** A cached worker in development makes every
  change look like it did not apply.
- **Never `skipWaiting()` silently.** A waiting worker raises a "New version
  available — reload" prompt and takes over only when the user agrees.
  Otherwise a home-screen app, which is never fully closed, stays on a stale
  build indefinitely.
- **A cached API response is always marked.** The worker sets `x-pact-stale`
  and `x-pact-cached-at`, and the UI renders a staleness banner. A cached
  commitment list is a list of deadlines that may already have passed; showing
  it as current tells the user they have time they do not have.
- **`viewport-fit=cover` plus `env(safe-area-inset-*)` padding.** Standalone
  mode paints under the notch and home indicator.
- **In-app back navigation must exist everywhere.** Standalone has no browser
  chrome and, depending on platform, no back gesture.

Notification permission is requested **only from a user gesture, and only once
at least one commitment exists.** Never on load — that trips the browser's
abusive-permission heuristics and the block is not recoverable. `denied` is
permanent and cannot be re-prompted, so that state renders instructions rather
than a dead button. On iOS the Notification API exists only inside the
installed PWA; that case is detected rather than shown a button that fails
silently.

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
- **`AUTH_URL` stays unset.** Auth.js works the origin out from the request's
  forwarded headers (`trustHost`). Setting `AUTH_URL` overrides that and pins
  every redirect to one host, which sends preview deployments to production.
  One mechanism only — see docs/decisions.md, 008.
- **Redirect targets go through `safeReturnTo()`** in
  [`src/lib/auth/return-to.ts`](src/lib/auth/return-to.ts), on the server and
  the client alike. It is allow-list shaped: a path, which still parses as
  same-origin. Never hand-roll this check — every hand-rolled copy missed
  `/\evil.com`, a protocol-relative redirect written with a backslash that
  browsers fold to `/`.
- **Destructive scripts check the connection string, not `NODE_ENV`.** See
  [`src/lib/db/guard-uri.ts`](src/lib/db/guard-uri.ts). A local run against a
  production `MONGODB_URI` has `NODE_ENV=development` and passed the old guard.
  The guard fails closed: anything not recognisably local or suffixed
  `-dev`/`-test`/`-local` is treated as production.
- **Seeded rows carry `synthetic: true`** and are purged by that field.
  Dropping collections would take real history with them.
- **Index changes need `npm run db:indexes`.** Mongoose creates missing indexes
  but never drops a redefined one, so the old key stays in place still
  enforcing its old constraint.
- TypeScript is `strict`, plus `noUncheckedIndexedAccess`. Do not weaken it.

## Layout

```
src/app/               routes
src/app/page.tsx       landing + sign-in, deliberately OUTSIDE (shell)
src/app/(shell)/       routes rendered inside the nav shell (signed-in only)
src/app/api/           route handlers
src/proxy.ts           route protection (Next 16's renamed middleware)
src/lib/auth/          Auth.js config, password hashing, throttling, returnTo
src/lib/commitments/   commitment + series services, materialisation, deadline
src/lib/db/            mongoose connection + models
src/lib/db/events.ts   appendEvent — the ONLY write path into the event log
src/lib/schemas/       zod schemas — source of truth for types
src/lib/env.ts         environment schema + parsed values, server-only
src/lib/behavior/      pure analysis functions, no I/O, clock passed in
src/lib/notifications/ queue, delivery, settings, in-app inbox
src/components/pwa/    service worker registration, install, permission
public/sw.js           hand-written service worker -- no build plugin
src/lib/api/           route guard + error translation
src/components/
src/styles/            design tokens + global stylesheet
scripts/               dev and operator scripts
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

Scaffold, tooling, email/password auth, the core data model, **an installable
PWA and the notification queue with in-app delivery.**

Working: Commitments with a locked-down deadline, an append-only event log,
derived miss detection, Series with lazily materialised occurrences, a
notification queue wired to the whole commitment lifecycle, an in-app inbox
with unread state, and a home-screen-installable app with a real offline state.

Not built yet, deliberately: web push delivery (the next change — a second
adapter over this queue), the study planner, and the behaviour engine that
reads the event log. `npm run seed:history` generates 60 days of synthetic
history, including the repeated-miss-after-postponement pattern that engine has
to be able to see.

Decisions already made and their reasoning are in
[`docs/decisions.md`](docs/decisions.md).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
