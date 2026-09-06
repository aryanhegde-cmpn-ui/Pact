# pact-tick

A Cloudflare Worker that POSTs to Pact's dispatch endpoint once a minute.

It contains **no logic**, on purpose. Every decision about what to send, when,
and to whom lives in Pact. This exists only because Vercel Hobby allows one
cron invocation per day, which is not a notification scheduler.

Keeping it empty is what makes it swappable — see [Replacing it](#replacing-it).

## Deploy

```bash
cd infra/tick
npm install
npx wrangler login
```

Set the target and the shared secret:

```bash
# Edit wrangler.toml and set PACT_URL to your deployed origin, no trailing slash.

# Must match CRON_SECRET in the Vercel project exactly.
npx wrangler secret put CRON_SECRET
```

Then:

```bash
npm run deploy
```

Cloudflare's free plan includes cron triggers. A once-a-minute schedule is
~43,200 invocations a month, inside the free allowance.

## Verify

Run one tick by hand — the Worker exposes `/tick` for exactly this, because a
failed cron is otherwise invisible:

```bash
curl -X POST https://pact-tick.<your-subdomain>.workers.dev/tick
```

A healthy response looks like:

```json
{ "ok": true, "status": 200, "body": { "ok": true, "scanned": 0, "sent": 0 } }
```

Watch live logs while it runs:

```bash
npm run tail
```

## When it fails

**Cloudflare cron does not retry a failed tick, and sends no alert.** That is
tolerable here only because dispatch is a queue scan rather than a
moment-in-time trigger: the next tick picks up whatever this one missed, so a
failure delays delivery instead of losing it.

It does mean silent failure is possible, so Pact watches for it from the other
side:

- `GET /api/health/detail` returns `dispatch.lastDispatchAt`,
  `dispatch.minutesSince` and `dispatch.stale`.
- The dashboard shows a warning when the last successful dispatch is more than
  15 minutes old.

If that banner appears, check `npm run tail` first, then the secret.

Common causes, in the order worth checking:

| Symptom                     | Cause                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `401` from dispatch         | `CRON_SECRET` differs between Cloudflare and Vercel                                                       |
| `404` from dispatch         | `PACT_URL` wrong, or has a trailing slash                                                                 |
| Ticks fine, nothing arrives | No push subscriptions, or VAPID keys unset — check `dispatch.pushConfigured` and `dispatch.subscriptions` |

## The backstop

Pact also runs the same endpoint once a day from Vercel Cron
(`vercel.json`), invoked with `GET` and the same bearer secret.

That is not redundancy for its own sake: it means a Cloudflare outage degrades
the system to daily delivery rather than stopping it. Dispatch being a queue
scan is what makes running it late safe.

## Replacing it

Nothing here is Cloudflare-specific beyond `wrangler.toml`. Any scheduler that
can make one authenticated HTTP request will do.

**cron-job.org** (free, no account infrastructure needed):

1. Create a job at `https://<your-pact-origin>/api/notifications/dispatch`
2. Method `POST`
3. Header `Authorization: Bearer <your CRON_SECRET>`
4. Schedule: every minute

**Any machine with cron:**

```cron
* * * * * curl -fsS -X POST https://<your-pact-origin>/api/notifications/dispatch \
  -H "Authorization: Bearer $CRON_SECRET" >/dev/null
```

**GitHub Actions** works too, but its scheduled workflows are best-effort and
routinely run several minutes late, which defeats the point of a per-minute
tick.

Whatever you use, the contract is the same: `POST` with a bearer `CRON_SECRET`,
as often as you want notifications to be able to arrive. Calling it more often
than necessary is harmless — the endpoint is idempotent and claims each row
before sending, so overlapping invocations cannot double-send.
