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

## 032 — Five colours, and "done" is not one of them

**Date:** 2026-09-07
**Status:** Accepted

### Decision

The palette stays at five. `signal` is reserved for "this needs you" and
appears at most twice on a screen. Every other state is a **value** distinction
on the one foreground: `text` for done or present, `text/60` for a secondary
fact, `text/40` for metadata, `text/25` for not-yet, `edge` for structure.

A second typeface joins, from the stack already there: the system mono is
promoted to the **figure face** and carries every measured number — times,
durations, counts, percentages — with `tabular-nums` and `slashed-zero`. One
new type step, `display` at 44px, used by the ring's numerator and nothing
else.

### Why

The obvious move when "done" needs a colour is to add a green. That green is a
reward for completing, and a reward for completing is the one reward this app
is allowed to withhold — the anti-feature list exists to stop exactly that
arriving as a nice touch. A filled segment in the foreground colour says
"done" without saying "well done".

The figure face is where the printed-ledger reference actually lands. A column
of times that aligns, and a duration that reads as a quantity rather than as
words, is most of what separates an instrument from a list. It costs no network
request, so it cannot shift layout or fail offline — which matters for a PWA
opened on a phone before seven in the morning.

### Consequences

- A component that seems to need a sixth colour wants opacity or a different
  design. There is no hex outside `tokens.css`.
- `src/lib/ui-invariants.test.ts` fails on a reward hue in the ring, on the
  word "streak" anywhere in a component, and on any emoji.

## 033 — The ring is three segments, not a progress arc

**Date:** 2026-09-07
**Status:** Accepted

### Decision

One arc per block, each filled or hollow, with a visible gap between them. The
denominator is exactly three, always. Other commitments due today are listed
plainly and never enter it.

### Why

A continuous arc invites a denominator of "everything due today", which would
make a day with nine errands read as a day with nine-elevenths of a study plan.
The ring measures adherence to the **plan**, and the plan is three blocks.

It is also the generic choice — every fitness app has one. Three discrete
segments read as an instrument with three positions, where partial fill is not
a state that exists, because a block is done or it is not.

### Consequences

- `buildDay` returns the blocks as their own array, so the denominator cannot
  be computed from a mixed list by accident. A test asserts it stays three with
  nine other commitments present.
- An abandoned block is not a kept block. The ring counts `done` only.

## 034 — The greeting is a rotation, not a shuffle

**Date:** 2026-09-07
**Status:** Accepted

### Decision

Selected from the date, the time bucket and the block state. Consecutive days
step through a pool in order, offset per pool by a hash of its own key, so no
line repeats within `pool.length` days. All copy lives in one module.

### Why

A line that changes on every render is a variable reward schedule: it teaches
the user to reload the page, which is engagement with the tool rather than
execution of the work — the same failure the anti-feature list names, arriving
through the copy instead of through a badge.

Random selection also repeats far sooner than it feels like it should: a pool
of four picked at random shows the same line twice within three days about half
the time, and a greeting already read this week is not read at all.

The buckets are the workbook's boundaries — 07:00, 10:00, 11:00, 19:00, 22:00,
23:30 — not round hours, so nobody is greeted mid-block as though they had the
evening. The late bucket ignores block state on purpose: "well done" at 11:45pm
would be the warm surface endorsing the thing the plan says not to do.

### Consequences

- Some pools are shorter than seven lines and cannot avoid a weekly repeat.
  `poolsShorterThanAWeek()` names them and a test asserts the list, so it is a
  decision rather than an oversight. "All three before ten" is the only true
  thing to say about that state.
- Adding a line means editing one array. No component holds a string.

## 035 — Recovery mode takes the planning surfaces too

**Date:** 2026-09-07
**Status:** Accepted

### Decision

While recovery is active, `/study`, `/postponements`, `/tomorrow` and `/week`
redirect to the dashboard, and the nav stops offering them. `/settings` stays
reachable.

### Why

The point of recovery mode is to remove the places where a backlog turns into a
bigger plan. The dashboard was one of them; the study planner is the other, and
arguably the worse one — it is a whole surface for deciding what to do next,
offered to someone who already has thirty-four things they said they would do.

Settings is the exception because a restrictive state with no escape hatch is a
trap. Locked out of settings, there is no way to change quiet hours, no way to
end an overseer arrangement, and no way out except finishing work already not
being finished.

A redirect rather than an explanation page: an explanation on `/study` is still
a page you can sit on, and the point is that there is one thing to do.

### Consequences

- `recoveryForRequest` is wrapped in React `cache`, so the layout deciding
  which tabs to show and the page deciding whether to render share one
  aggregation instead of running two.
- The gated list is exported and asserted, so widening it is a visible change.

## 036 — "Answered, moved, missed again" is its own group

**Date:** 2026-09-07
**Status:** Accepted

### Decision

The postponement view leads with commitments that have missed more than one
distinct deadline **and** answered for at least one of them. They appear there
only, not also in the moved-once/twice/chronic groups.

### Why

A different state from "missed once and never answered", and a worse one. An
unanswered miss is a question outstanding. This is a question that was
answered, acted on with a new date chosen deliberately, and then missed anyway
— which says the answer did not hold and the new date was optimism.

In a flat overdue list it is indistinguishable from any other late row, which
is precisely how the pattern stays invisible: every individual reschedule
looked reasonable at the time. On the real seeded data it is 43 rows that were
previously scattered across three groups by change count.

Counted on `(entityId, ts)` because `ts` is the missed deadline for both
`DEADLINE_MISSED` and `RECKONING_SUBMITTED`. Keying on the entity alone would
collapse a commitment missed in September and again in October into one miss
and hide exactly the pattern being looked for.

### Consequences

- Two extra fields on the row, `deadlinesMissed` and `deadlinesReckoned`, both
  derived on read.
- One extra query over the event log, bounded to entities that already have a
  deadline change.

## 037 — Colour and type tokens must not share a name

**Date:** 2026-09-07
**Status:** Accepted

### Decision

The `base` colour is renamed `ground`. `src/lib/design-tokens.test.ts` fails if
any name appears in both the `--color-*` and `--text-*` namespaces.

### Why

Tailwind's `text-*` utility is overloaded — font size and colour — and resolves
against the font-size scale first. A colour named `base` next to a type step
named `base` makes `text-base` silently mean 16px and drops the colour intent
with no warning, no build error, and nothing obviously wrong on screen.

That shipped: `hover:text-base` on the Start button left signal text on a signal
ground, invisible, and only in the hover state. Eight other call sites had
already worked around it with `text-[color:var(--pact-base)]`, which is the
shape that invited the mistake.

Renaming fixed the instance. The test fixes the class — a future colour called
`lg` fails in CI rather than in a hover state nobody screenshots.

### Consequences

- `bg-ground` and `text-ground` are ordinary utilities; the bespoke
  `.text-on-signal` class is gone.
- The palette assertion doubles as the "still five colours" guard.

## 038 — Every e2e spec provisions its own fixture

**Date:** 2026-09-07
**Status:** Accepted

### Decision

A spec that mutates state creates what it acts on. `e2e/environment.spec.ts`
asserts the preconditions the rest assume, and goes red when a conditional skip
is about to fire.

### Why

The no-refresh check completed the commitment it found, so it passed once and
skipped on every run afterwards — indistinguishable from a deleted test, with
the suite still green.

Conditional skips are the same failure in slower motion. Several checks need an
imported curriculum, an open block, or recovery mode to be off, and written as
`test.skip(...)` they degrade into silence. They stay, and the environment spec
is the one thing that fails when the reason for them is present, saying why in
one line.

### Consequences

- Specs that need a commitment POST one first.
- A green suite with half of it skipped is no longer possible without the
  environment spec being red.

## 039 — What the e2e suite structurally could not see

**Date:** 2026-09-07
**Status:** Accepted

### Decision

`e2e/uncovered.spec.ts` covers unauthenticated routes, the full-screen session
route, and service-worker registration. The remaining gaps are recorded in that
file rather than fixed.

### Why

Every spec ran signed in as the primary, inside the nav shell. That excluded
four whole categories, and the landing-page bug — a 600px form on a 390px
screen — shipped from the first of them.

**Now covered:** `/`, `/join`, `/offline`, `/focus/:id`, and that the service
worker registers.

**Deliberately not, and why:**

- **`/overseer` and the stakes configuration pages.** They need a second seeded
  account and a redeemed single-use invite. The authorization half is covered
  by enumeration in `src/lib/stakes-authorization.test.ts`, which is the half
  that matters — but nothing checks that those pages render.
- **The staleness banner.** Needs a cache hit served while offline; the
  assertion would be about Playwright's offline emulation as much as the app.
- **Recovery mode's screen.** Reachable only by pushing the account over the
  thresholds, which would wreck the fixture for every other spec.
- **Push delivery.** Needs a real push service.

### Consequences

The overseer gap is the one worth closing next, and closing it means seeding a
relationship in `auth.setup.ts`.

## 040 — Revoking the overseer does not clear active consequences

**Date:** 2026-09-07
**Status:** Accepted

### Decision

`revokeRelationship` touches the relationship and nothing else. Active
consequences run until discharged or expired; earned rewards stay earned. A test
asserts the function writes to no model but `RelationshipModel`.

### Why

Revoking is about who configures the arrangement in **future**. If it cleared
what was already running, the fastest route out of any consequence would be
revoke, wait, re-invite — the dismiss button the discharge rules exist to
refuse, wearing a different hat.

It is not a permanent state either. Consequences still end on their own terms:
discharged by the work being put right, or expired at their window, which is at
most seven days. So revocation does not trap anyone in a consequence; it simply
cannot shorten one.

Rewards survive for the mirror-image reason: something earned was earned by the
record, and the overseer leaving does not unmake it.

### Consequences

- The primary can always end the arrangement, and still owes the week they are
  in.
- A comment in `revokeRelationship` says so, because the tidy-up instinct
  ("clean up their stakes too") is exactly what would break it.

## 041 — Consequences do not stack, and the index is what says so

**Date:** 2026-09-07
**Status:** Accepted

### Decision

One active consequence per owner, enforced by a unique partial index on
`(ownerId)` where `status: 'active'`. A second trigger while one is active
appends `CONSEQUENCE_SUPPRESSED` and is dropped — it extends nothing and queues
nothing.

### Why

Two stacked consequences are not twice the motivation. They are the point at
which the arrangement stops feeling survivable, and an arrangement that stops
feeling survivable gets abandoned rather than satisfied. This is the rule that
stops a bad week compounding into an unrecoverable state.

An index rather than a check-then-write for the usual reason: two concurrent
page loads can both observe no active consequence at the same instant. The
in-memory check in `evaluateStakes` handles the ordinary case and keeps the
decision list honest; the index is what makes it true.

Suppression is recorded rather than discarded because it says something worth
knowing — the week was bad enough to fire twice.

### Consequences

- Evaluation orders discharge and expiry BEFORE activation, so a good day can
  end today's consequence and a bad one start tomorrow's without ever stacking.
- The maximum window is one constant, `MAX_CONSEQUENCE_WINDOW_DAYS = 7`,
  enforced in the zod schema rather than in the form.

## 042 — Vacation excludes days rather than forgiving them

**Date:** 2026-09-07
**Status:** Accepted

### Decision

While vacation is on: nothing is evaluated, no consequence activates, no
threshold is tested. Days inside a vacation period leave the adherence
**denominator** — not counted as kept, not counted as missed. Periods are stored
as documents, and `VACATION_STARTED` / `VACATION_ENDED` are appended. It cannot
discharge an active consequence, and it does not stop one expiring. The primary
controls it; `vacation:write` is absent from the overseer's capabilities.

### Why

Counting paused days as kept would flatter the record. Counting them as missed
would make the pressure valve cost something, and a valve that costs something
is one nobody pulls — at which point "I am behind, so I will abandon the whole
thing" is back, which is the failure vacation mode exists to prevent.

Stored as periods rather than a flag because the exclusion has to be auditable
after the fact: last month's adherence has to know which days in it were
paused, and a boolean can only say whether vacation is on now.

It cannot discharge anything, or it would be the dismiss button by another
name. It does not stop expiry, because pausing expectations must not extend a
penalty already running.

The overseer cannot veto it. A vacation someone else can refuse is one you route
around by not opening the app, and an accountability tool nobody opens reports
nothing at all.

### Consequences

- Adherence carries `vacationDays` and `sparse`, and both are shown.
- Below five counting days no trigger fires at all: one kept day out of one is
  a rate of 1.0, and real-world stakes should not turn on a single Tuesday.

## 043 — The stakes authorization rule is positional

**Date:** 2026-09-07
**Status:** Accepted

### Decision

Every route under `src/app/api/stakes/` is the overseer's. A scanner walks that
directory and fails if any route there requires a capability the primary holds,
or has no guard at all. There is deliberately no `GET /api/stakes`.

The primary's two stake actions live elsewhere: `api/rewards/claim` and
`api/vacation`.

### Why

The matrix stays the source of truth — the test asks `can()` and fails when a
route disagrees with it, rather than restating who may do what. If the two could
disagree, the matrix would be documentation of the rule rather than the rule.

Positional, so a route added there next month without a guard fails without
anybody remembering to extend a list. A hand-maintained list has that failure
mode by construction.

The shared read is absent for the same reason. A `GET` both roles need would be
guarded by `consequence:read`, which the primary holds — and that one exception
would turn "every route here" into "every route here except one", which is the
shape that grows. The overseer's page calls `readState` directly; the primary's
status reaches them through `/api/today`.

### Consequences

- The primary has no route that dismisses, expires or reschedules a
  consequence, and a scan fails on one appearing.
- `editStakeSchema` takes name and description only — status is derived, and a
  field accepted and ignored is the other way this gets defeated.
- Reading never evaluates: an overseer opening their page cannot activate a
  consequence. Evaluation belongs to the primary's own Today read.

## 044 — A route handler may not return a bare 500

**Date:** 2026-09-07
**Status:** Accepted

### Decision

Every guarded route runs inside `translateError`, which maps a Zod failure to
422, any `PactError` to the status it names, a Mongoose `ValidationError` to
400, a duplicate key to 409, and everything else to a 500 carrying a logged
correlation id. Every domain error class extends `PactError`, and
`src/lib/api-errors.test.ts` fails on one that does not.

### Why

Creating an invite returned 500 with no explanation. Two separate defects made
it, and only one was the obvious one: `can()` threw a `TypeError` for a role
outside the enum, from outside the try/catch — and `RelationshipError`, along
with four sibling classes, never reached the translator at all, so a perfectly
articulate "an active relationship already exists" arrived as a stack trace in
a server log.

`can()` now fails closed. The translator is the structural half: an escaped
exception is a bug, but a 500 that says nothing is a bug you cannot diagnose
from the outside, and this app has exactly one operator.

The first attempt matched `error.constructor.name` against a list of class
names. It passed every unit test and still returned 500 in production, because
the minifier mangles class names. `instanceof PactError` is the version that
survives a build.

### Consequences

- A new domain error extends `PactError` and gets its status for free.
- `EnvironmentError` is exempt: it is a misconfiguration, not a request
  failure, and maps to 503.
- The correlation id is the only thing the response body carries about the
  cause; the detail stays in the log.

## 045 — A surface no spec can reach is a fixture problem

**Date:** 2026-09-07
**Status:** Accepted

### Decision

Surfaces belonging to an account other than the primary get an account of their
own, seeded by a script and signed in by a Playwright setup project with its
own storage state. There are three: the primary, the overseer
(`scripts/seed-overseer.ts`), and an account already past the recovery
thresholds (`scripts/seed-recovery.ts`).

### Why

Decision 039 recorded four surfaces the suite could not see, as though they
were properties of the app. Three of them were properties of the seed. Every
spec signed in as the primary because the primary was the only account any seed
produced, and each gap was then written down as inherent — which is what stops
anybody looking at it again.

The landing page shipped a 600px form on a 390px screen through the same hole.
By the time the overseer's pages were built, it had cost three bugs.

Recovery mode is the clearest case. It replaces the dashboard, so it genuinely
cannot be tested on the primary's account — and that is an argument for a
second account, not for leaving the screen uncovered.

Both seeds go through the real path: the overseer through invite and
redemption rather than an inserted role field, the recovery account through
ordinary overdue commitments rather than a forced flag.

### Consequences

- `uncovered.spec.ts` lists one remaining gap, push delivery, which needs a
  real device.
- The staleness banner is tested at the two response headers that are the
  worker's entire contract with the UI, rather than through cache emulation.
- Each seed refuses to run against anything but a scratch database, and
  `--reset` deletes only what it created.

## 046 — Motion explains what changed, and never rewards

**Date:** 2026-09-07
**Status:** Accepted

### Decision

Motion (`motion@13`, the package Framer Motion is published as) is loaded
through `LazyMotion` with the `domAnimation` subset and the `m` components.
Two durations exist, both eased, both defined in one module: 200ms for a state
change and 320ms for a mode change. Under `prefers-reduced-motion` every
transition becomes `duration: 0`.

Animated: a row leaving a list, the miss block arriving above everything, a
ring segment changing state, recovery and focus mode replacing a screen.

Not animated: entrance on load, hover flourishes, scroll reveals, anything
spring.

### Why

The test is the one in CLAUDE.md: **if an animation would feel good to trigger
repeatedly, it is a reward.** A flourish on completing a commitment is the
celebratory animation the anti-feature list bans, arriving as a nice touch
rather than as a feature anyone would have argued for. A row leaving is the
feedback, and it is feedback because the row is gone, not because it was fun.

Springs are banned for the same reason at a smaller scale: overshoot is
expressive, and a commitment leaving because it was completed and one leaving
because it was abandoned are the same movement.

Reduced motion means cuts, not shorter animations. Halving a duration misreads
the setting — someone who asked for it is often asking because motion makes them
ill.

The cost is real and was measured rather than assumed: **+138.5 KB raw,
+46.3 KB gzipped** on the client bundle, from 305.6 KB to 351.9 KB gzipped.
`domAnimation` rather than `domMax` is most of what keeps it that small; it also
means there is no layout projection, so a list collapses its own height instead
of animating its siblings' positions.

### Consequences

- `src/lib/motion-invariants.test.ts` scans for springs, staggers, scale,
  rotate, hover and scroll effects, and for any transition not routed through
  the shared hook.
- `e2e/motion.spec.ts` asserts the runtime half. It watches inline styles as
  well as `document.getAnimations()`, because Motion drives height on the main
  thread and the browser's own animation list cannot see it.
- App Router has no exit animation for route changes. Navigation is a cut, on
  purpose; animation happens within a route.

## 047 — Never size anything with a name the spacing scale defines

**Date:** 2026-09-07
**Status:** Accepted

### Decision

`max-w-sm`, `max-w-xl`, `min-w-lg` and the rest of that family are banned.
Widths use an explicit value — `max-w-[36rem]` — and
`src/lib/ui-invariants.test.ts` fails on any `max-w`, `min-w`, `w`, `basis` or
`size` utility whose name is also a step in the spacing scale.

### Why

The theme defines `--spacing-sm`, `--spacing-xl` and so on, and in Tailwind v4 a
named width utility resolves against the spacing scale before the container
scale. `max-w-sm` therefore meant `max-width: 12px`. `max-w-xl` meant 32px.
`max-w-2xl` matched nothing and applied no cap at all.

It shipped because everything about it looks correct: it is the class every
Tailwind project uses, the build says nothing, and the responsive suite is
happy — a 32px column does not overflow anything. The focus screen, which is
nothing but a centred column, rendered 32px wide on a desktop for a whole
release, and the sign-in card, the invite page and the offline page were all
12px.

This is decision 037 again in a different namespace. The rule generalises: when
a token namespace collides with a utility scale, name the value explicitly
rather than trusting the resolution order.

### Consequences

- Five files changed to explicit widths; the scanner covers the rest.
- `max-w-5xl` on the app shell is untouched and correct — the spacing scale
  stops at `3xl`, which is exactly why the collision was invisible in the one
  place anybody looked.

## 048 — Every script names its target before it acts

**Date:** 2026-09-07
**Status:** Accepted

### Decision

Every script that opens a database connection prints the cluster host, the
database name and whether that is treated as production, before doing anything.
One shape, `announceTarget()` in `scripts/target.ts`, enforced by a scanner in
`src/lib/script-target.test.ts`.

### Why

Production sign-in was broken for a day and one of the two causes was this:
`change:password` prompted, hashed, wrote, and printed "Password changed for
aryan.hegde@wizergos.com" — against a scratch database. Nothing on screen said
which one.

Every script reads `MONGODB_URI` from the shell first and `.env.local` second,
so an export left over from an earlier command in the same terminal redirects
the next one silently. The same email address exists in more than one database,
so the write succeeds. The command was correct, the output was true, and the
account it changed was the wrong one.

The connection-string guard (decision 021) was already in place and did not
help: it refuses development commands on production, and this was the opposite
direction — a production command landing on development.

### Consequences

- `users:list` and `access:reset` exist, and both announce first.
- A script that connects without announcing fails the suite, as does one that
  announces after connecting: a failed connection is exactly when the target
  matters most.
- No script interpolates `MONGODB_URI` into a log line; `describeUri` strips
  credentials.

## 049 — There is a way back in that does not need me

**Date:** 2026-09-07
**Status:** Accepted

### Decision

`npm run access:reset -- --username <name> --confirm` prints the target, lists
the accounts in that database, refuses without `--confirm`, generates a strong
password, prints it exactly once, never writes it to a file, and clears that
account's lockout rows.

It does **not** call `assertSafeToMutate`.

### Why

There is no reset-by-email flow, and decision 007 records why: one user, no
email provider, a token chain that is not worth its cost. That is a reasonable
trade only while some other way back in exists, and there was not one. The
previous route was `change:password`, which prompts interactively, names no
database, and reports success either way.

The guard is deliberately absent because this is a production recovery tool.
`assertSafeToMutate` exists to keep development commands off production data;
applying it here would refuse the one case the command is for. `--confirm`
after a printed target is the check that fits: it cannot be satisfied by
accident, and what it confirms is on screen.

Attempts against identifiers that resolve to nobody are reported rather than
deleted. An `unknown:` row means the username typed does not exist in that
database — a different problem from a wrong password, producing the same
deliberately generic error on screen — and deleting them would destroy the only
evidence of someone else guessing.

### Consequences

- A locked-out operator runs two commands and is back in.
- The password reaches the terminal and nowhere else. No `--password` flag,
  because a password passed as an argument is a password in shell history.
- `e2e/access.spec.ts` resets the OVERSEER fixture and signs in with the result.
  Resetting the primary's would invalidate `PACT_E2E_PASSWORD` for every later
  run.

## 050 — Configuration is reported by name, and before the session check

**Date:** 2026-09-07
**Status:** Accepted

### Decision

`npm run env:check`, `/api/health/detail` and the generated
`.env.production.example` all derive from the Zod schema in `src/lib/env.ts`.
They report **names and booleans only**, never values. `/api/health/detail`
answers unauthenticated when a required variable is missing.

### Why

`/api/auth/providers` returned 500. It touches no database, takes no session,
and the fault was `AUTH_SECRET` being unset — which Auth.js reads from
`process.env` itself and never through this app's schema. That is why the
schema "passed" while every auth route failed: **it was never called on that
path.** A loud schema only helps the code that consults it.

Requiring a session to read the diagnostic would make it useless in exactly
that case, because a missing `AUTH_SECRET` means no session can exist. The
disclosure is bounded: `/api/health` already names the same variables in its
503, and every name is in a committed example file.

Deriving from the schema rather than a hand-written list is what stops the
example file being subtly wrong — a template missing a variable is worse than
no template, because it looks complete.

### Consequences

- `ENV_DOCS` carries prose, grouping and secret-ness; a test fails if its keys
  and the schema's keys disagree.
- The upload template is `.env.production.upload`, **not**
  `.env.production.local`: Next loads that filename ahead of `.env.local` for a
  local production build, and a file of placeholders under the obvious name
  broke local sign-in within a minute of being written.
- The seeding variables are excluded from both production templates. A
  deployment carrying a plaintext password is the one thing to avoid.

## 051 — Shortcuts are a list, and nothing destructive is on it

**Date:** 2026-09-07
**Status:** Accepted

### Decision

One array in `src/lib/shortcuts/bindings.ts`. `?` renders it. Sequences (`g`
then a letter) navigate; single keys act on the current screen. Every
single-key binding is inert while an input, textarea, select or contenteditable
has focus, and every binding except Escape is inert while a focus session is
running.

No shortcut abandons a commitment, discharges a consequence or toggles vacation
mode.

### Why

A shortcut nobody can discover is a trap: it fires when a key is pressed by
accident and there is nothing to consult afterwards. Generating the sheet from
the bindings makes documenting one unavoidable, because the documentation is
where the binding is defined.

The typing rule is not a nicety — single-key bindings and text entry cannot
coexist. Typing "no" into an outcome field would open a new commitment and then
navigate.

The session rule follows the server-side lock rather than duplicating it: the
guard already returns 409 for `commitment:write` during a session, so a
keyboard offering those actions would be a faster way to collect an error, and
a shortcut that navigates out of a session is a shortcut out of the work. The
shell reads the running session server-side so a second tab cannot disagree.

Destructive actions are excluded because a decision that can be made by
brushing a key is not a decision. Abandoning cannot be undone at all.

### Consequences

- Actions reach the page through `data-shortcut` attributes, so the layer holds
  no state and a key does nothing when its target is absent.
- `isDestructive()` is matched against the binding list by a test, and the
  matcher itself is tested, so a rule that matched nothing could not pass.

## 052 — The focus ring is not a component's to remove

**Date:** 2026-09-07
**Status:** Accepted

### Decision

`:focus-visible` is defined once globally — 2px solid `signal` — and
`outline-none` is banned anywhere in `src/`, enforced by
`src/lib/a11y-invariants.test.ts`.

### Why

Six inputs carried `outline-none` with `focus:border-signal`. That reads as a
considered replacement and is not one: it removes a 2px ring for a 1px border
colour change, on the components where somebody is typing — the sign-in form
among them, which is the first thing a keyboard user meets.

The ring is 6.09:1 against the ground and 5.58:1 on a surface, comfortably over
the 3:1 that a non-text indicator needs. The border change stays; the outline
comes back on top of it.

### Consequences

- Focus restoration is treated as part of the same rule: a dialog that traps
  focus and drops it on `document.body` afterwards sends the next Tab to the
  top of the page.
- Inline disclosures are deliberately not trapped. They are not dialogs, and
  trapping focus in one would be a bug rather than a courtesy.
