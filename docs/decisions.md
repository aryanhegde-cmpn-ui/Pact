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
