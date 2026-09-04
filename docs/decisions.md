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
