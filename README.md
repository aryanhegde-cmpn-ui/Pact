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
| `/mirror`     | Read-only display for a wall-mounted smart mirror  |
| `/study`      | Study planner                                      |
| `/api/health` | Deploy check — database, environment, commit, time |

## Stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS v4 · TanStack Query ·
Mongoose + MongoDB Atlas · Zod · Vitest · ESLint + Prettier.

Deployed on Vercel Hobby, which means no background workers and one daily cron
— see [`docs/decisions.md`](docs/decisions.md).

## Status

**Scaffold and tooling only.** No authentication, no Google APIs, no features.
The four routes render stubs. Auth lands in the next change.

## Local setup

Requires **Node 20.9+** (`.nvmrc` is not used; `node --version` should satisfy
the `engines` field in `package.json`).

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

A blank value counts as unset: `NEXTAUTH_SECRET=""` will not satisfy the
requirement.

| Variable                                    | Where it comes from                                                                                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`                               | Atlas → your cluster → Connect → Drivers. The M0 free tier is enough.                                                                                                             |
| `NEXTAUTH_SECRET`                           | `openssl rand -base64 32`                                                                                                                                                         |
| `NEXTAUTH_URL`                              | `http://localhost:3000` locally; the deployment URL on Vercel.                                                                                                                    |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID (Web application). Add `http://localhost:3000/api/auth/callback/google` as an authorised redirect URI. |
| `ALLOWED_EMAIL`                             | Your Google account. It is the only one permitted to sign in.                                                                                                                     |
| `MIRROR_DEVICE_TOKEN`                       | `openssl rand -hex 32`. The mirror device presents this instead of a session.                                                                                                     |
| `CRON_SECRET`                               | `openssl rand -hex 32`. Vercel Cron presents this on scheduled invocations.                                                                                                       |
| `APP_TIMEZONE`                              | Defaults to `Asia/Kolkata`. Any IANA zone.                                                                                                                                        |

The OAuth and cron values are not used yet — auth arrives in the next change —
but the schema requires them so a deploy cannot get halfway configured.

### 3. Atlas network access

Atlas blocks connections by default. In **Network Access**, allow your IP for
local development. For the Vercel deployment you need `0.0.0.0/0`, because
Vercel's serverless functions do not have stable outbound IPs on Hobby.

### 4. Run

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

| Command               | What it does                                                     |
| --------------------- | ---------------------------------------------------------------- |
| `npm run dev`         | Development server on :3000, opens your browser once it is ready |
| `npm run dev:no-open` | Same, without launching a browser                                |
| `npm run build`       | Production build                                                 |
| `npm start`           | Serve the production build                                       |
| `npm test`            | Run the Vitest suite once                                        |
| `npm run test:watch`  | Vitest in watch mode                                             |
| `npm run typecheck`   | `tsc --noEmit`                                                   |
| `npm run lint`        | ESLint                                                           |
| `npm run format`      | Prettier, writing in place                                       |

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

3. Set `NEXTAUTH_URL` to the deployment URL.
4. Allow `0.0.0.0/0` in Atlas Network Access.
5. Confirm the deploy with `/api/health` — it needs no authentication and
   reports the commit SHA, so you can verify _which_ build you are looking at.

## Layout

```
src/app/            routes
src/app/(shell)/    routes rendered inside the nav shell
src/app/api/        route handlers
src/lib/db/         mongoose connection + models
src/lib/schemas/    zod schemas — the source of truth for types
src/lib/behavior/   pure analysis functions, no I/O
src/components/
src/styles/         design tokens + global stylesheet
scripts/            dev tooling
docs/
```

`/mirror` sits outside `(shell)` so it renders bare, with no navigation.

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
