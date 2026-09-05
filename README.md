# Pact

A personal execution dashboard for one user.

Google Tasks holds what you said you would do. This holds whether you actually
did it.

Most productivity tools help you **organise** work. This one is about
**executing** it — a task shouldn't quietly disappear when its deadline passes.
The dashboard exists to answer the uncomfortable questions: what did I commit
to, did I do it, how many times has this been rescheduled, and what am I
currently avoiding?

Google Tasks stays the execution store — it's already on your phone and in your
calendar. This app is the behavioural intelligence layer over it, plus a study
planner.

> Every feature faces one test: **does this increase the probability that the
> user actually does the thing?** Anything that fails goes in
> [`docs/rejected.md`](docs/rejected.md) with a reason instead of being built.
> See [`CLAUDE.md`](CLAUDE.md) for the full rules, including the hard
> anti-features (no points, streaks, badges or confetti — and why).

## Surfaces

| Route         | What it is                                         |
| ------------- | -------------------------------------------------- |
| `/`           | Landing and sign-in entry point                    |
| `/dashboard`  | The interactive surface                            |
| `/study`      | Study planner                                      |
| `/api/health` | Deploy check — database, environment, commit, time |

## Stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS v4 · TanStack Query ·
Mongoose + MongoDB Atlas · Zod · Vitest · ESLint + Prettier.

Deployed on Vercel Hobby, which means no background workers and one daily cron
— see [`docs/decisions.md`](docs/decisions.md).

## Status

**Scaffold, auth, and the core data model.** No notifications, no PWA, no study
planner yet.

Working: Commitments with a deadline that can only move through a logged,
reasoned change; an append-only event log; miss detection derived on read;
Series whose occurrences are materialised lazily; CRUD API routes; and a plain
responsive list at `/dashboard`.

The behaviour engine that reads the event log comes next.
`npm run seed:history` generates 60 days of synthetic history with configurable
failure patterns to build it against.

## Local setup

Requires **Node 22**. `.nvmrc` pins it, so `nvm use` picks the right version,
and `engines` in package.json makes Vercel build on the same major.

### 1. Install

```bash
npm install
```

### 2. Configure the environment

Create `.env.local` in the repository root with the variables below. Every one
is required — they are validated with Zod on first use, and the app refuses to
serve a request while any are missing, naming each one. `/api/health` reports
the same list as `"status": "misconfigured"`, so a deploy tells you what is
wrong instead of just failing.

A blank value counts as unset: `AUTH_SECRET=""` will not satisfy the
requirement.

| Variable                                 | Where it comes from                                                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`                            | Atlas → your cluster → Connect → Drivers. The M0 free tier is enough.                                                                               |
| `AUTH_SECRET`                            | `openssl rand -base64 32`. Signs the session JWT; rotating it invalidates every session.                                                            |
| `CRON_SECRET`                            | `openssl rand -hex 32`. Vercel Cron presents this on scheduled invocations.                                                                         |
| `APP_TIMEZONE`                           | Optional. Defaults to `Asia/Kolkata`. Any IANA zone.                                                                                                |
| `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` | Optional, read only by `npm run seed:user`. Do **not** set these on a deployment — a live environment has no business holding a plaintext password. |
| `SEED_USER_NAME`                         | Optional display name for the seeded user. Defaults to the part of the email before the `@`.                                                        |

`CRON_SECRET` is not used yet, but the schema requires it so a deploy cannot get
halfway configured.

### 3. Atlas network access

Atlas blocks connections by default. In **Network Access**, allow your IP for
local development. For the Vercel deployment you need `0.0.0.0/0`, because
Vercel's serverless functions do not have stable outbound IPs on Hobby.

### 4. Create your user

There is no signup page — see [`docs/decisions.md`](docs/decisions.md) 007. Set
`SEED_USER_EMAIL` and `SEED_USER_PASSWORD` in `.env.local`, then:

```bash
npm run seed:user
```

It refuses to run once a user exists. To reset that account's password:

```bash
npm run seed:user -- --force
```

Or change a password interactively, without it reaching your shell history:

```bash
npm run change:password -- --email you@example.com
```

Ten failed sign-ins within an hour lock the account for fifteen minutes.
Wrong password, unknown email and locked-out all return the same message, so the
form cannot be used to discover which addresses have accounts.

### 5. Run

```bash
npm run dev
```

This opens <http://localhost:3000> in your browser as soon as the server is
actually listening. Suppress it with `npm run dev:no-open`, `BROWSER=none`, or
`npm run dev -- --no-open`. Arguments are forwarded, so `npm run dev -- -p 4000`
works and the browser follows the port.

Then check <http://localhost:3000/api/health>. A green result looks like:

```json
{ "status": "ok", "database": { "status": "connected" } }
```

If the database is unreachable the endpoint returns **503** with the reason in
`database.message` — usually a missing Atlas IP allowlist entry or bad
credentials.

## Scripts

| Command                   | What it does                                                                |
| ------------------------- | --------------------------------------------------------------------------- |
| `npm run dev`             | Development server on :3000, opens your browser once it is ready            |
| `npm run dev:no-open`     | Same, without launching a browser                                           |
| `npm run build`           | Production build                                                            |
| `npm start`               | Serve the production build                                                  |
| `npm test`                | Run the Vitest suite once                                                   |
| `npm run test:watch`      | Vitest in watch mode                                                        |
| `npm run typecheck`       | `tsc --noEmit`                                                              |
| `npm run lint`            | ESLint                                                                      |
| `npm run format`          | Prettier, writing in place                                                  |
| `npm run seed:user`       | Create the single user from `SEED_USER_*`; `-- --force` resets the password |
| `npm run change:password` | Change a password interactively (`-- --email you@example.com`)              |
| `npm run seed:history`    | 60 days of synthetic history (`-- --pattern chronic-postponer --reset`)     |

No test touches the network — see the conventions in [`CLAUDE.md`](CLAUDE.md).

## Deploying to Vercel

1. Import the repository as a new Vercel project. The framework is detected
   from [`vercel.json`](vercel.json); no build settings need changing.
2. Add every variable from the table above under **Settings → Environment
   Variables**, for Production and Preview. A missing one fails the build
   loudly, which is intentional.

   **Paste a value for each one.** Creating the variable and leaving the value
   blank is the easy mistake here — the dashboard shows the name either way, so
   it looks configured. A blank value is treated as unset, and the build error
   says `set, but the value is empty` to tell the two apart.

3. **Do not set `AUTH_URL`.** Auth.js derives the origin from the request,
   which is what keeps preview deployments working. Setting it pins every
   redirect to one host — see [`docs/decisions.md`](docs/decisions.md) 008.
4. Allow `0.0.0.0/0` in Atlas Network Access.
5. Confirm the deploy with `/api/health` — it needs no authentication and
   reports the commit SHA, so you can verify _which_ build you are looking at.

## Layout

```
src/app/            routes
src/app/page.tsx    landing + sign-in, outside the shell on purpose
src/app/(shell)/    routes rendered inside the nav shell (signed-in only)
src/app/api/        route handlers
src/proxy.ts        route protection (Next 16's renamed middleware)
src/lib/auth/       Auth.js config, password hashing, login throttling
src/lib/db/         mongoose connection + models
src/lib/schemas/    zod schemas — the source of truth for types
src/lib/env.ts      environment schema + parsed values, server-only
src/lib/behavior/   pure analysis functions, no I/O
src/components/
src/styles/         design tokens + global stylesheet
scripts/            dev and operator scripts
docs/
```

The landing page sits outside `(shell)` so a signed-out visitor renders no
navigation. `/mirror` is deferred and its stub has been removed.

Two rules in the data model are enforced by tests that scan the source rather
than by convention, because both are the product rather than a style
preference:

- **Only `changeDeadline()` may write `dueAt`**, and it requires a reason.
- **The event log has no update or delete path anywhere**, including through
  the raw driver.

## Contributing

Read [`CLAUDE.md`](CLAUDE.md) first — it defines the data-ownership boundary
with Google Tasks, the event-log rule, and the anti-features that are never to
be built.

Branch workflow:

```text
main
 ↑
Pull Request
 ↑
dev
 ↑
Pull Request
 ↑
feature/*
```

## Licence

MIT — see [LICENSE](LICENSE).
