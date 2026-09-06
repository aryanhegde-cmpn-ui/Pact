# Decisions

Architectural decisions and why they were made. Append; do not rewrite history.
If a decision is reversed, add a new entry that supersedes the old one and say
what changed.

---

## 001 — Next.js (App Router) over React + Vite

**Date:** 2026-09-04
**Status:** Accepted

### Context

The original plan (see the pre-scaffold README) was React + TypeScript + Vite as
a client-side SPA talking to the Google Tasks API directly.

### Decision

Use Next.js with the App Router instead.

### Why

- **Secrets cannot live in the browser.** Google OAuth needs a client secret,
  and the app needs a MongoDB connection string. A Vite SPA has nowhere to put
  either. Adding a separate API service to hold them means deploying and paying
  for two things.
- **The token exchange and refresh need a server.** Google refresh tokens must
  not be exposed to the client. With Vite that means a backend anyway, so the
  SPA-only story never actually held.
- **The mirror surface wants server rendering.** `/mirror` is a display that
  should paint correct content on load without a client-side fetch waterfall.
- **One deployment.** Route handlers, pages and cron all ship as a single
  Vercel project on the free tier.
- **Sync must be request-triggered** (see 002). Next gives a natural place to
  hang that: the request path that renders the surface.

### Consequences

- Server/client boundary discipline is now required — `'use client'` where
  interactivity is needed, and secrets never imported into client components
  (`server-only` guards the sensitive modules).
- Cold starts exist. Mitigated by the cached database connection.
- Vercel-specific config (`vercel.json`, cron) is part of the app.

---

## 002 — No background worker; sync is on-demand

**Date:** 2026-09-04
**Status:** Accepted

### Context

The obvious design for "keep Google Tasks and our event log in step" is a
worker polling Google on an interval.

### Decision

There is no background worker. Sync happens on-demand, triggered by incoming
requests, plus one daily Vercel cron invocation for maintenance work that
genuinely cannot be request-driven.

### Why

- **Vercel Hobby has no worker primitive.** No long-running processes, no
  queues, no daemons. Functions run per request and are killed after.
- **Hobby cron is once daily at hourly precision, in UTC.** It cannot stand in
  for a poller; at best it is a nightly reconciliation pass.
- **Adding a worker means leaving the free tier** or running a second service
  somewhere else, which is a real cost and an extra thing to keep alive for a
  single-user app.
- **On-demand is sufficient here.** One user, looking at the app a handful of
  times a day. Data only needs to be fresh when someone is actually looking at
  it; syncing while nobody is watching buys nothing.

### Consequences

- Every surface is responsible for syncing what it needs before it renders.
- Freshness is bounded by "when you last opened it", not by a poll interval.
  This is acceptable and should be surfaced honestly in the UI rather than
  hidden.
- `/mirror` refreshes itself on a timer client-side, since nobody triggers a
  request by looking at a wall.
- Any future feature that assumes "the background job will have run" is
  invalid. Design around request-triggered work.

---

## 003 — Google Tasks stays the execution store

**Date:** 2026-09-04
**Status:** Accepted

### Context

It would be simpler to own the tasks outright in MongoDB and skip the
synchronisation problem entirely.

### Decision

Google Tasks remains the system of record for task existence and content. This
app owns the behavioural layer and the event history on top.

### Why

The user already lives in Google Tasks — it is on their phone, in their
calendar, and reachable by voice assistant. A task store that only exists
inside this dashboard would be a task store they stop updating, and the whole
premise depends on the underlying data being real.

By the feature test: owning the tasks does not increase the probability the
user does the thing. Being present where they already capture work does.

### Consequences

- A synchronisation boundary exists and must be handled carefully — in
  particular the due-date trap documented in `CLAUDE.md`.
- The app must degrade sanely when Google is unreachable.

---

## 004 — Five-value palette, Tailwind defaults removed

**Date:** 2026-09-04
**Status:** Accepted

### Decision

Design tokens are CSS custom properties in `src/styles/tokens.css`. The
palette is five values. Tailwind's stock colour, type and breakpoint scales are
cleared (`--color-*: initial`) so they cannot be used.

### Why

An accountability tool loses credibility when it looks decorated. Removing the
default palette makes the constraint structural rather than a matter of
willpower: `bg-emerald-500` simply does not resolve, so a "nice green success
state" cannot be added by accident.

### Consequences

- Adding a colour is a deliberate edit to `tokens.css`, which is a visible
  decision in review rather than an inline hex in a component.
- Copy-pasted Tailwind snippets from the internet will not work unmodified.
  This is intended.

## 005 — Google postponed; MongoDB is the sole source of truth

**Date:** 2026-09-04
**Status:** Accepted — reverses the Google-Tasks-as-execution-store premise

### Decision

Google Tasks and Calendar integration is postponed indefinitely. MongoDB owns
all data outright. When Google returns it is an optional one-way mirror **out**
of Pact plus an optional read-only source; it never owns a field and is never
required for the app to function.

### Why

Sync reconciliation was the single most expensive part of the design, and
postponing Google removes it entirely rather than deferring it.

The cost was not the API calls. It was that two writable stores meant every
field needed a conflict rule, and the Google Tasks API is actively hostile to
holding one: it accepts an RFC 3339 timestamp for `due` and silently discards
the time, so a naive round-trip destroys the user's deadline. Guarding that
required a reconciliation layer, an ordering story for concurrent edits, and
a test matrix for divergence — none of which moves the user closer to doing
the thing they committed to.

With one writable store, the correct behaviour is the only behaviour. `dueAt`
is a local field with a real time on it and nothing can overwrite it.

### Consequences

- The due-date trap is gone, along with the section of CLAUDE.md describing it.
  If Google returns, that hazard returns with it and must be re-documented.
- Notifications and PWA now come before any Google work.
- Nothing in the app may be designed to assume a Google response is available,
  authoritative, or reachable.

## 006 — Email and password auth, single user, no identity provider

**Date:** 2026-09-04
**Status:** Accepted

### Decision

Auth.js v5 with the Credentials provider and a JWT session strategy. One user.
No third-party identity provider. Google OAuth may be added later purely to
authorise API access for an already-signed-in user, never as a login method.

### Why

Signing in must not depend on a third party being reachable. With Google
demoted to an optional integration (005), using it as the login method would
have made an optional dependency load-bearing for access to the app itself.

Session lifetime is 90 days, sliding. The intended client is an installed PWA
on a phone; a session that expires weekly turns the app into something you get
logged out of rather than something you open.

### Consequences

- Passwords are hashed with `@node-rs/argon2`, chosen over `argon2` because it
  ships prebuilt binaries — `argon2` compiles natively and fails on Vercel's
  build image.
- Login throttling has to be stored in MongoDB, not in memory: serverless
  invocations share no process, so an in-process counter protects nothing.
- The `role` field exists on the User model from the start, so growing past one
  user needs no migration.

## 007 — No password reset flow; operator scripts instead

**Date:** 2026-09-04
**Status:** Accepted

### Decision

There is no public signup route and no password reset flow. Users are created
with `npm run seed:user` and passwords changed with `npm run change:password`.

### Why

A reset flow is not worth its cost yet. It needs an email provider, a token
model with expiry and single-use semantics, rate limiting on the request
endpoint, and a set of tests for the ways those go wrong — all to serve one
user who has shell access to the machine that can run a script.

A public signup route on a single-user app is strictly a liability: it is an
unauthenticated write endpoint that exists to be abused and can never be used
legitimately.

### Consequences

- Losing the password means running a script, not clicking a link.
- If the app ever gains a second user who is not the operator, this decision
  has to be revisited — that is the trigger, not user count on its own.

## 008 — One mechanism for the app's own origin: trustHost, not AUTH_URL

**Date:** 2026-09-05
**Status:** Accepted — supersedes the hand-built origin added in feat/auth

### Decision

Auth.js derives the origin from the incoming request's forwarded headers
(`trustHost: true`). **`AUTH_URL` stays unset**, including on Vercel.

The alternative — building the redirect origin by hand from `x-forwarded-host`,
validated against an allowlist, falling back to `AUTH_URL` — is removed, not
kept alongside. `requestOrigin()` is gone.

### Why

feat/auth ended up with both mechanisms at once, and they disagreed.
`AUTH_URL` was set, so Auth.js rewrote `request.nextUrl` to name that host,
while the proxy built its redirects from the forwarded headers. Two different
answers to "what origin is this app served from" in the same request.

That disagreement is worse than either mechanism alone. It is invisible in
production, where the two agree because there is only one host, and it appears
only on preview deployments — exactly where it is hardest to notice and least
expected.

Picking Auth.js's mechanism rather than the hand-rolled one:

- It is the one the library actually uses for its own callback URLs. Keeping
  the custom code would have left Auth.js still consulting `AUTH_URL`
  internally, so the app would only have been half-fixed.
- An allowlist of valid hosts has to be maintained, and Vercel generates a new
  preview hostname per deployment. The allowlist would either need a wildcard
  (no longer much of an allowlist) or would break previews again.
- It is less code. The custom origin builder was thirty lines and one more
  thing to get wrong.

The header trust this requires is safe **only** because the app runs behind
Vercel, which sets `x-forwarded-host` itself and does not pass through a
client-supplied `Host`. On infrastructure without that guarantee, trusting the
header is header injection, and `AUTH_URL` becomes the right answer instead.

### Consequences

- **`AUTH_URL` must be removed from the Vercel project.** Leaving it set keeps
  the old behaviour, silently.
- It stays in the env schema as optional, documented as an escape hatch for
  running behind a proxy that does not send forwarded headers.
- Preview deployments now redirect within themselves.

### Related

`returnTo` validation moved to `safeReturnTo()` in
[`src/lib/auth/return-to.ts`](src/lib/auth/return-to.ts) at the same time. It
had been duplicated across the proxy, the landing page and the sign-in form,
and every copy missed `/\evil.com` — a protocol-relative redirect written with
a backslash, which browsers fold to `/` but a `startsWith('//')` check does
not. One implementation, allow-list shaped, used by all three.

## 009 — DEADLINE_MISSED is unique per deadline, not per commitment

**Date:** 2026-09-05
**Status:** Accepted — corrects the key introduced in feat/commitment-model

### Decision

The unique partial index enforcing one `DEADLINE_MISSED` per commitment is
keyed on `(entityId, type, ts)` rather than `(entityId, type)`. For this event
type `ts` is the missed deadline, so each distinct deadline can be missed
exactly once.

### Why

The original key permitted one miss per commitment **for its entire life**. A
commitment missed on Monday, postponed, and missed again on Friday recorded the
first and silently dropped the second — `appendEvent` treats the duplicate-key
error as success, so nothing failed and nothing was logged.

That is not a small loss. Repeated misses against a moving deadline are the
single clearest signal this product exists to surface, and the bug flattened a
chronic postponer into someone who slipped once.

Keying on `ts` needs no schema change, because miss events are already
timestamped at the deadline rather than at the moment a read noticed them.
Concurrency safety is unchanged: invocations observing the _same_ deadline
produce the same `ts` and still collapse to one row.

### Consequences

- `npm run db:indexes` must be run to drop the old index. Mongoose creates new
  indexes but never removes a redefined one.
- The seeded history generator was also wrong in a matching way: it only ever
  moved a deadline _before_ it was due, so it could not produce the pattern at
  all. It now moves a deadline after missing it, at a rate that varies by
  persona.
- No real data was lost. The old index blocked a second miss only where a
  postponement followed one, which the generator never produced and which no
  real commitment had yet hit.

## 010 — Destructive scripts are guarded by the connection string

**Date:** 2026-09-05
**Status:** Accepted

### Decision

`seed:history --reset` and anything like it check `MONGODB_URI` via
`assertSafeToMutate()`. `NODE_ENV` is not consulted. The check fails closed:
anything not recognisably a local host, or a database named `-dev`/`-test`/
`-local`, is treated as production.

### Why

The previous guard tested `NODE_ENV === 'production'`, which does not describe
the risk. A developer running the script on their laptop has
`NODE_ENV=development` while `.env.local` points at the production cluster —
the guard passed, and the production database was one command from being
dropped. The connection string is what actually determines whose data is at
stake.

Failing closed matters as much as the check itself. A guard that must recognise
production in order to refuse would wave through every cluster nobody had
thought to add.

### Consequences

- Purging seeded data on the production cluster now requires pointing
  `MONGODB_URI` at a scratch database. That is deliberate friction, and it does
  mean the one-user setup — where the only cluster is production — has to opt
  in explicitly.
- The purge itself is scoped to `synthetic: true` rather than dropping
  collections, so it cannot take real history even when it does run.

## 011 — Delivery is a queue scan driven by an external tick

**Date:** 2026-09-06
**Status:** Accepted

### Decision

`POST /api/notifications/dispatch` scans the queue for anything due and
pending, and sends it. A Cloudflare Worker calls it every minute; Vercel Cron
calls the same endpoint once a day as a backstop. The Worker contains no logic.

Each row is claimed with a conditional update on `status: 'pending'` before any
send.

### Why

Vercel Hobby allows one cron invocation per day, which is not a notification
scheduler. Something external has to drive the minute hand.

Making that thing dumb is the point. A scheduler is a commodity, and the moment
it holds logic it stops being swappable — so the Worker only makes one
authenticated request, and cron-job.org or a line in crontab can replace it
without touching the app.

Scanning rather than firing is what makes the arrangement safe. A trigger that
fires _at_ a moment is lost if the moment is missed, and Cloudflare cron does
not retry a failed tick. A scan asks what is outstanding, so a missed tick
self-heals on the next one and the daily Vercel backstop degrades the system to
daily delivery rather than stopping it.

Claiming before sending, rather than sending then marking, is the other half.
Two ticks overlap whenever one runs slow. The conditional update means exactly
one wins. The trade is that a crash between claim and send loses that
notification instead of repeating it — correct here, because a missed reminder
is a gap and a duplicated one is noise, and noise is what teaches someone to
ignore the app entirely.

### Consequences

- Delivery is at-most-once, deliberately, not at-least-once.
- Calling the endpoint more often than necessary is harmless.
- Silent failure is possible: Cloudflare raises no alert. `lastDispatchAt` is
  recorded on every dispatch, exposed at `/api/health/detail`, and surfaced as
  a dashboard warning past 15 minutes. Without that, push can stop for a week
  before anyone notices.

## 012 — Dead push subscriptions are deleted, not retried

**Date:** 2026-09-06
**Status:** Accepted

### Decision

A 404 or 410 from a push service deletes the subscription immediately. Any
other error increments `failureCount`; five consecutive failures delete it, and
any success resets the count to zero.

On every app load, the browser's current subscription is compared against what
the server holds, and a mismatch re-registers.

### Why

404 and 410 are the push service stating that the endpoint is permanently gone.
Retrying is guaranteed to fail. Without deletion the row lives forever and
generates an error on every tick, until a dead device is the only thing in the
logs and real failures are invisible among them.

Other errors are ambiguous — a timeout, a 500, a network blip — where one
failure proves nothing and deleting would punish a device that was briefly
offline. Requiring five _consecutive_ failures distinguishes "unreachable right
now" from "nobody is listening", and resetting on success is what makes
"consecutive" mean anything.

The reconciliation exists because browsers rotate or drop subscriptions with no
notification to anyone. The server carries on sending to the old endpoint, the
push service accepts the request, and nothing arrives. There is no error on
either side. Comparing on load is the only thing that detects it, and it is the
single most common reason web push appears to stop working for no reason.

### Consequences

- The subscription list is self-cleaning; no manual pruning.
- A user with several devices receives on all of them, because guessing which
  one they are at means the notification does not arrive.
- Endpoints are returned to the client as a suffix only. The full endpoint is a
  capability URL — anyone holding it can push to that device.

## 013 — The seeded password is never written to a file

**Date:** 2026-09-06
**Status:** Accepted

### Decision

`npm run seed:user` prints the password once to stdout and stores only its
hash. It honours `SEED_USER_PASSWORD` **only when supplied by the shell**, and
deliberately ignores a value found in `.env.local`, saying so when it does.

### Why

`@next/env` runs dotenv values through dotenv-expand, which rewrites them:

```
pa$$w0rd-with-dollars  ->  pa$-with-dollars
secret-${HOME}-here    ->  secret-/home/you-here
pass#word              ->  pass
```

A password containing any of those is a different string when it is read back.
The script then hashes the mangled version, and the account cannot be signed
into with the password the operator believes they set — with no error anywhere,
because nothing failed. The symptom is "sign-in stopped working", which sends
you looking at auth rather than at a dotenv parser.

Distinguishing shell-provided from file-provided needs a snapshot of
`process.env` taken _before_ the dotenv load, which is what
`scripts/shell-env.ts` exists for.

Not writing it at all is the stronger fix. A secret in a file is a secret that
can be read back wrongly, committed accidentally, or drift out of step with the
hash — and none of those failure modes announce themselves.

### Consequences

- The password is shown exactly once. Losing it means `--force` and a new one.
- `SEED_USER_PASSWORD` is gone from `.env.example`.
- Generated passwords are base64url, so they contain no character that any
  dotenv parser can misread even if someone pastes one somewhere.

## 014 — A recovery action must change something

**Date:** 2026-09-06
**Status:** Accepted

### Decision

Every option in step three of the reckoning produces an effect the system can
observe or enforce: a rewritten outcome and estimate, commitments created now,
a required next action, a status change with a named person and a follow-up
date, an abandonment with a reason, or a link to the commitment that displaced
it. Free text is available alongside every option, never instead of one.

### Why

A reason that produces no consequence is journaling.

The tempting design is a reason picker and a notes field: it is easy to build,
it feels reflective, and it changes nothing. The next attempt is identical to
the last one, so the same miss happens again, and the record fills with
articulate accounts of the same failure. Writing down "I underestimated it" for
the fourth time is not insight; it is a diary.

Requiring an effect also makes the reason worth asking. "I was waiting on
someone" becomes a blocked status with a name and a date to chase — which the
system can surface later. Without that, it is a sentence nobody reads again.

The enforcement is structural: the branch in `applyRecovery` is exhaustive, so
a new action added to the schema without an effect is a compile error rather
than a silent no-op.

### Consequences

- Adding a recovery option means designing its effect first.
- Some effects are destructive — `split` closes the original, `abandon` closes
  the commitment. Both are recorded as events, so nothing is lost from the
  history.
- `define-next-action` additionally _gates_ rescheduling: the concrete action
  must exist before a new deadline can be set. A recovery that is merely
  advisory would be advice.

## 015 — The lockout counter keys on the account, not the identifier

**Date:** 2026-09-06
**Status:** Accepted

### Decision

Failed sign-in attempts are counted against `user:<id>` once the identifier
resolves, and against `unknown:<sha256(identifier)>` when it does not. The
submitted string is never the key.

### Why

The moment one account is reachable by two identifiers, a per-string counter
gives an attacker two budgets. Five guesses at `aryan` and five at
`aryan@example.com` is ten attempts against one account with no lockout, and
adding a third identifier later would make it fifteen. The counter has to key
on the thing under attack, which is the account.

Unresolved identifiers still need a counter or enumeration is unlimited and
free. They are hashed so the collection does not become the list of guessed
usernames and addresses an attacker was trying to assemble.

The two namespaces cannot collide: ids and hex digests are disjoint by
construction.

### Consequences

- The identifier must be resolved _before_ the lockout is checked, which is a
  database read on every attempt including hopeless ones. That is the cost of
  the property and it is small.
- Unknown username, unknown email, wrong password and locked-out still return
  one byte-identical response. Nothing above changes that.

## 016 — Ownership is a column on every collection, enforced by a scanner

**Date:** 2026-09-06
**Status:** Accepted

### Decision

Every scoped collection carries `ownerId`, and every query filters on it. A
test scans the source and fails on any query against a scoped model whose call
text lacks an ownership filter.

### Why

Doing this before the curriculum PR rather than after. That change triples the
number of collections, and retrofitting ownership across all of them means
auditing every query written in the meantime — whereas doing it now means the
new collections are born with the column and the scanner catches the first one
that is not.

The scanner rather than review, for the same reason the `dueAt` writer scanner
exists: "no query anywhere does X" is a property of the whole codebase, and a
behavioural test only proves it for the handlers someone remembered to call.
The dangerous route is always the new one. That scanner has already caught two
real regressions.

It is deliberately crude — it reads the text of the call, so a scope applied
three lines later in a variable still reads as unscoped. That produces
occasional false positives, which cost a comment, and no false negatives, which
would cost a data leak.

### Consequences

- Service functions take `ownerId` explicitly rather than reading it from
  ambient context. Verbose, and it means a caller cannot forget.
- An unowned row matches no scoped query, so it becomes invisible rather than
  leaking — the right way round, but it does mean the backfill migration is
  mandatory before a deploy.

## 017 — One permission matrix, and no route may bypass it

**Date:** 2026-09-06
**Status:** Accepted

### Decision

`src/lib/auth/permissions.ts` holds a capability matrix. Every route guard
derives from it through `requireCapability`. A test fails on any route without
a guard and on any inline `role === '...'` comparison.

The primary has no `consequence:write` capability. The overseer has no write
capability except that one, no `session:read`, and no `events:read` — which
nobody has.

### Why

Scattered role checks are how the fifteenth handler ends up subtly different
from the other fourteen, and nothing notices because each one looks reasonable
in isolation.

The primary's exclusion from consequence configuration is the load-bearing
rule: an arrangement whose subject can edit their own consequences is not an
arrangement. Establishing the permission surface before consequences exist
means that PR slots into it rather than inventing its own rules — which is
precisely when a "temporary" self-service path gets added.

Nobody gets the raw event log over HTTP. The overseer reads a purpose-built
projection instead. A filtered log exposes every future event type by default
and has to be remembered about; a projection exposes only what someone
deliberately put in it.

### Consequences

- Adding a capability means editing one file and one table.
- A new route without a guard fails a test rather than shipping open.
- The overseer's view is a separate read model to maintain. That is the cost,
  and it is the safer half of the trade.

## 018 — Free-text notes are private by default

**Date:** 2026-09-06
**Status:** Accepted

### Decision

The overseer sees structured categories always, and free-text notes only if the
primary opts in. Default off.

### Why

The categories carry the accountability value. "Missed, avoidance, three times"
is the fact worth acting on, and it is countable.

The free text is where the primary is honest with themselves — and they will be
less honest if they know it is read. Making notes visible by default would
quietly degrade the quality of the one input the whole behavioural layer
depends on, in exchange for detail the overseer does not need.

Opt-in keeps both: the useful signal, and the conditions that produce it.

### Consequences

- The overseer projection omits the field entirely rather than sending an empty
  string, so a client cannot mistake "not shared" for "they wrote nothing".
- The setting is `settings:write`, which the overseer does not hold. They
  cannot grant themselves access to it.
