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

## 019 — The workbook is the authority on the plan

**Date:** 2026-09-06
**Status:** Accepted

### Decision

`data/Aryan_SDE2_Frontend_Study_Plan_Jan2027.xlsx` is committed to the
repository and is the source the curriculum is imported from.
`npm run curriculum:import` reads it with a dependency-free reader in
`scripts/xlsx.ts` and maps it through pure functions in
`src/lib/curriculum/import-map.ts`.

### Why

Hand-transcribing 60 topic rows, 13 resources, 14 rehearsal items, five phases
and six daily blocks into a JSON file would make that file the authority, and
the two would diverge the first time the spreadsheet changed and nobody
remembered the copy.

The reader is written rather than installed. The npm `xlsx` package is no
longer published there by its maintainers and its last npm release carries a
prototype-pollution advisory; a full parser is a large dependency for one
operator script. An .xlsx is a zip of XML, Node ships inflate, and the file is
machine-generated — so a reader for exactly this shape is about a hundred lines
with no supply chain, and it is tested against the real file.

Sections are located by their header text, not by row number, because the Daily
Plan sheet stacks three tables in one column range and a hardcoded index breaks
silently when a row is inserted — silently being the problem.

### Consequences

- Re-running the import is the normal way to pick up a spreadsheet edit, so it
  must be idempotent, and it is: the second run reports everything unchanged.
- The reader handles cell values as text only. No formulas, no styles, no dates
  as serial numbers. It throws rather than guessing if the file stops being
  text.
- `scripts/**/*.test.ts` is in the vitest include so the reader is tested.

## 020 — The practice parser refuses to guess

**Date:** 2026-09-06
**Status:** Accepted

### Decision

The workbook's "Practice / Output" column is parsed into a `targetKind` of
`problems`, `build`, `verbal`, `audit`, `explain` or `other`, with an optional
numeric range and unit. Anything the narrow rules do not match — 21 of the 60
rows — is imported as `other`, flagged, and listed at `/study/review` to be
corrected by hand. `practiceRaw` is stored verbatim and never rewritten.

### Why

The column is prose written by a person for a person. "8–10 representative
problems" and "45–60 min build" contain a real target. "Whiteboard + edge
cases" and "Give pros/cons + alternative" do not, and no amount of pattern
matching changes that.

A target invented from "Choose storage for scenarios" becomes a number the plan
measures progress against, and every downstream reading of it is wrong while
looking exactly like a number somebody set. An obvious gap gets fixed. A
confident wrong answer does not.

Text that reads as two kinds at once is flagged rather than resolved by
precedence: the person who wrote the cell is the one who knows which was meant.

### Consequences

- A third of the sheet arrives needing a few minutes of manual review. That is
  the design working, and the alternative was 21 invented targets.
- A hand-corrected target sets `correctedByHand`, and the next import leaves it
  alone. Re-applying the same wrong parse would make correcting it pointless.
- A test asserts the flag count over all 60 real rows, so a future
  "improvement" to the parser cannot quietly start guessing.

## 021 — A playlist has no completion figure

**Date:** 2026-09-06
**Status:** Accepted

### Decision

`Resource` carries name, type, use, link and the workbook's "how to use", and
nothing else. No progress, no percentage, no remaining count, no watched
timestamp. Progress belongs to a `CurriculumTopic`. A source-scanning test in
`src/lib/curriculum/playlist-rule.test.ts` fails on any identifier naming a
pool and a score together, and on any division by the size of a pool.

### Why

The workbook says it twice, unprompted. The curriculum sheet's own second line
reads "Playlist links are resource pools, not courses to finish end-to-end",
and the resource sheet repeats it per row: "Daily; don't finish as a course",
"Pick relevant videos only", "Pick weak topics only".

A percentage over a pool turns "watch the two videos on the thing you are weak
at" into "get through 214 videos", and then rewards the second. That is the
substitution of engagement with the tool for execution of the work — the same
failure the anti-feature list exists to prevent, arriving by a different door
and looking like a useful feature on the way in.

### Consequences

- The resource list renders instructions, not progress bars.
- Adding a status field to the Resource model fails a test that names the exact
  field list, which is where the rule would be broken first.

## 022 — The plan holds and shows the gap

**Date:** 2026-09-06
**Status:** Accepted

### Decision

Drift is the proportion of the current phase's P0 topics done against the
elapsed proportion of its dates, computed on read by a pure function in
`src/lib/behavior/drift.ts` with a ±10% tolerance band. Nothing re-flows the
plan. Phase dates move only through `replanPhase()`, which requires a reason,
shifts every later phase by the same amount, and appends `PLAN_REPLANNED`.
`originalStartDate` and `originalEndDate` are immutable.

### Why

Silent re-flowing is the study-plan version of silently moving a deadline,
which is the single behaviour this product exists to prevent. It lets a
five-month plan quietly become an eight-month one with no moment where anybody
noticed, and it destroys the only thing that makes "behind" mean anything — the
schedule to compare against.

Measured over P0 alone because that is the workbook's own "must master" band.
Counting P2 Supporting rows would let a Docker video paper over an unfinished
event loop; counting everything would make the plan look worse than it is for
someone who correctly skipped the optional material. `needs-revision` does not
count as done: it is the status meaning "finished badly", and counting it would
make the number agree with the most optimistic reading of the user's own work.

A phase whose focus text matches nothing itemised — "Applications +
interviews" — reports that there is nothing to measure rather than measuring
itself against the whole curriculum.

### Consequences

- Being behind is a number on a screen and nothing else happens. That is the
  point.
- Re-planning shifts the tail rather than compressing it, so the plan cannot
  absorb a delay while appearing not to.
- A re-planned phase is excluded from the import's date overwrite, so
  re-importing cannot silently undo a decision that has a reason recorded
  against it.

## 023 — The evening is not a fourth study block

**Date:** 2026-09-06
**Status:** Accepted

### Decision

The generator never schedules new material into the evening, and when every
morning block has closed it offers nothing at all — the workbook's "Workout +
Rest, Priority" row is shown in its place. When a block did not close, the
evening points at that existing commitment rather than creating a second one.

### Why

Both evening rows are in the sheet and both are prohibitions: "Only finish an
incomplete morning task or revise a weak topic", and "Protect sleep and
consistency; don't turn every free hour into study".

The second is the one a well-meaning generator breaks. A day where all three
blocks closed is exactly the day it is tempting to offer a bonus, and that is
precisely the day the sheet says to stop. A plan that costs its user their
sleep is one they abandon in three weeks, which fails the feature test harder
than any missed evening.

Pointing at the existing commitment rather than creating an evening one keeps
the record honest: the unfinished morning work already has a deadline and a
miss, and a second row for the same work would double-count it everywhere.

### Consequences

- `eveningPlan()` is pure and returns options; it creates nothing.
- "Every morning block closed" and "no morning blocks exist" are different
  answers. A "well done, go and rest" on a day nothing was planned would be a
  lie.

## 024 — Study blocks are ordinary Series

**Date:** 2026-09-06
**Status:** Accepted

### Decision

The three daily study windows are `Series` documents carrying a `blockId`.
They materialise through the existing `materialiseRange`, produce ordinary
Commitment occurrences, and get the same events and notifications as anything
else. `materialiseRange` resolves the day's topic per occurrence and names it
in the title. There is no second scheduler.

### Why

Everything about idempotency under concurrency, lazy materialisation, the
lookahead, occurrence history, postponement and reckoning already exists and is
tested. A parallel mechanism would have to re-earn all of it, and the two would
diverge.

The topic is resolved per occurrence rather than once per pass because the
answer depends on the date: the weekly rhythm makes Monday machine coding and
Thursday testing, and a fortnight materialised with today's answer would name
the same topic fourteen times.

The estimate is the block's length, not the topic's parsed duration. "5-min
verbal framework" is the size of the output, not the time committed, and a
five-minute estimate on a half-hour block would make the morning look
twenty-five minutes cheaper than it is.

### Consequences

- Creating a fortnight of three daily blocks is roughly 45 occurrences, each
  with two events and a queue row. Against Atlas that measured 34 seconds, and
  a Vercel Hobby function has ten — so the import warms the lookahead itself.
  The daily incremental cost afterwards is three occurrences.
- A suggestion materialised early can go stale. `getStudyToday` re-resolves one
  whose topic has since been marked done, but never one the user chose: a
  default the app quietly reverts is a lock that pretends otherwise.
- With no curriculum imported, a block series behaves as an ordinary daily
  series. Every installation starts there.

## 025 — Materialisation costs one round trip per range, not per occurrence

**Date:** 2026-09-06
**Status:** Accepted

### Decision

`materialiseRange` generates ids up front, then writes commitments, events and
notification rows with one bulk insert each. `appendEvents` and
`enqueueForCommitments` are the batched forms of the existing single-row
functions, in the same modules, with the same keys and the same rules.

### Why

It was nine round trips per occurrence: a commitment, two events, and six
notification rows. A fortnight of three daily study blocks is 45 occurrences,
and against Atlas M0 that measured **34 seconds** — past a Vercel Hobby
function's entire budget, and getting worse as the plan runs to January.

It is now **856ms cold for a 14-day range** and 1234ms for a 75-day one: the
cost tracks the number of queries, not the number of rows.

The regression this invites is invisible in behaviour. Writing one at a time
still produces exactly the right rows; it just gets slower until something
times out. So there is a test asserting the write count is the same for 15
occurrences as for 75.

### Consequences

- Ids are generated before the insert, so the commitment holds an ObjectId
  while the queue row holds its string form.
- A row another invocation won comes back as a duplicate-key write error, and
  its events and notifications are dropped with it. Writing them anyway would
  attribute another request's row to this one.
- `insertMany` runs Mongoose validators; `bulkWrite` does not, which is why
  the batching uses the former and a scanner forbids the latter.

## 026 — Recovery mode replaces the dashboard

**Date:** 2026-09-06
**Status:** Accepted

### Decision

Above 10 unanswered misses **or** 20 overdue commitments, `/dashboard` is
replaced — not annotated — by three slots: one commitment to finish, one to
reschedule with a reason, one to abandon. No metrics, no lists, no curriculum,
no drift. Leaving happens when both counts drop back under, which takes as
many passes as it takes.

Whether it is on is derived from the counts on every read. The **episode** is a
`RecoverySession` document, so a spell in recovery is visible afterwards, and a
unique partial index makes entering safe under concurrent reads.

### Why

A backlog past a certain size stops being information and becomes wallpaper.
Thirty-four unanswered misses under a banner are still thirty-four unanswered
misses: the banner is read once and the list below it is scrolled past because
no part of it is actionable.

Worse, the normal dashboard invites the response that caused the backlog.
Faced with a long overdue list, the reflex is to reschedule all of it, and the
result is a bigger plan than the one already not being kept. Three slots with
three different dispositions make that impossible — only one of them
reschedules.

Two triggers because they are two different failures: unanswered misses are a
reckoning debt that makes the record unable to say anything true about
behaviour, and sheer volume is a capacity problem that can happen with every
miss dutifully answered.

### Consequences

- Recovery's reschedule answers the miss first, through `submitReckoning`, and
  only then moves the deadline — an unanswered miss cannot be rescheduled, and
  a backlog is exactly when it would be tempting to let that slide.
- The deadline category is derived from the miss reason so the same question is
  not asked twice in two vocabularies. The mapping is shown before submitting.
- `listOverdue` is now a bounded page of 15 with the true totals alongside, so
  a client cannot render a page as if it were the whole set.
- `/study` is still reachable during recovery. The brief scoped the
  replacement to the dashboard; widening it is a separate decision.

## 027 — Mongoose does not validate updates, so the app makes it

**Date:** 2026-09-06
**Status:** Accepted

### Decision

`connectToDatabase` sets `runValidators` and `setDefaultsOnInsert` globally.
A scanner in `src/lib/db-validation.test.ts` fails on raw driver access outside
a short annotated list, on any `bulkWrite`, and on any call that turns
validation off.

### Why

`seedUser` wrote `role: 'owner'` through `updateOne`. The field is
`enum: ['primary', 'overseer']`, the value is in neither, and Mongo accepted it
silently — producing an account that failed every capability check and could
not sign in by username. Nothing raised an error, because `save()` validates
and update operations do not.

Set globally rather than per call because the failure mode **is** a call site
that forgets. A global rather than a schema plugin because `mongoose.plugin()`
only reaches schemas compiled after it runs, and a model's middleware is fixed
when `mongoose.model()` compiles it — the model modules are evaluated at import
time, long before a Next route connects, so a plugin registered on connect
would have covered nothing at all.

### Consequences

- The scanner's allow-list is four operator scripts, each annotated. Nothing
  serving a request is on it.
- `bulkWrite` is forbidden outright: it runs no update validators and there is
  no option to make it.
- Verified against a scratch database: both the original `$setOnInsert` and a
  plain `$set` of an invalid role are now rejected.

## 028 — The session clock is the server's

**Date:** 2026-09-06
**Status:** Accepted

### Decision

A focus session stores `startedAt` server-side. Elapsed time is recomputed from
it on every read, and `actualMinutes` is written once at the end from
`endedAt - startedAt`. The request body has no duration field. The browser
recomputes `now - startedAt` each tick using a clock offset measured once
against the server's `serverNow`; it never accumulates.

### Why

A study block is 60 to 90 minutes with the phone locked. A backgrounded tab's
timers are throttled to once a minute or stopped outright, the phone sleeps,
and the OS suspends the PWA. An accumulating counter would report ninety
minutes as a few, and nothing on screen would look wrong.

Verified end to end: a session started ten minutes earlier and read back
reported 600 seconds exactly, and a session ended after ten minutes recorded
ten against a sixty-minute estimate.

### Consequences

- `actualMinutes` is never below one. A session that lasted forty seconds is
  not zero minutes of work, and a zero would bias the estimate history toward
  flattery.
- The end is a conditional update on `endedAt: null`, so two tabs ending the
  same session complete the commitment once. Verified under a real race.

## 029 — The session lock is in the guard

**Date:** 2026-09-06
**Status:** Accepted

### Decision

While a session runs, `commitment:write`, `series:write`, `curriculum:write`
and `settings:write` return 409 "You're in a session." from
`requireCapability`, before the handler. The focus routes opt out with
`duringSession: true`, and a scanner fails on any route outside `api/focus`
that sets it.

### Why

A lock the UI holds is not a lock. A second tab posts straight around it, and
so does a phone restoring a page from before the session started.

In the guard specifically, for the same reason the capability check is there:
the realistic failure is a route added next month that nobody remembers to
lock, and only something every route already passes through can catch that.

Reckoning is deliberately not locked. Answering a miss is not planning, it
cannot create work, and locking it would let a session started by accident
wedge the reckoning queue behind it.

### Consequences

- One running session per owner is enforced by a unique partial index, not by
  checking first — a second tab is exactly what produces that race.
- The capability check still runs first, so an overseer gets 403 rather than a
  409 that would tell them the route exists.

## 030 — "Need more time" is not a failure

**Date:** 2026-09-06
**Status:** Accepted

### Decision

Ending a session with `more-time` completes nothing, abandons nothing, records
no miss, and appears in no adherence figure. It corrects the estimate with the
evidence just gathered, appends `PROGRESS_LOGGED`, leaves a block's topic
`in-progress`, and makes that topic the preferred suggestion for the same block
tomorrow — ranked above the day's slant and the phase focus.

### Why

It is the honest report that an estimate was wrong. An app that penalises it
teaches the user to stop reporting it, and then every estimate in the history
is fiction — which costs far more than the honest report ever could.

Carrying the topic over matters for the same reason. A block that picks up new
material the morning after running out of time produces a trail of half-done
topics, and it makes saying "I need more time" cost something.

### Consequences

- `carriedOverTopics` lives in its own module. `focus/service` needs
  `curriculum/service` to advance topic progress and `curriculum/plan` needs
  the carry-over, so importing it from the service would close a three-module
  cycle.
- Bounded to a fortnight: a topic left in progress in July is not what today's
  block is continuing.

## 031 — Session kind defaults to execution, and changing it takes a click

**Date:** 2026-09-06
**Status:** Accepted

### Decision

`kind` is `execution` unless the user deliberately picks `planning` or
`research`. It is not a required field on the start screen. Mid-session the
only switch offered is _to_ execution.

### Why

The planning-versus-execution ratio is one of the few numbers that can tell
someone they are busy rather than productive, and it is defeated entirely by
calling planning "execution". The person doing that would not experience it as
cheating — reading around a problem genuinely feels like working on it.

A required field would be worse than a default. A field you must fill in before
starting gets filled in with the first option every time, and the value becomes
noise. The friction belongs on the honest-but-unflattering answer being
_available_, never on it being _required_.

Offering only the switch toward execution is the same argument: that is the
direction that makes the ratio less flattering, not more.

### Consequences

- A research budget is only meaningful for a research session and is ignored
  for the others.
- The budget interrupts exactly once, ever. A budget that nags gets dismissed
  reflexively, and then it is noise rather than a decision point. Extending
  requires a written justification, because a budget that is always extended is
  the same as not having one.
