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

### Two creation paths, one model

**Manually created** commitments require title, outcome, deadline, estimate and
priority. There is no quick-add: the friction exists to stop vague commitments
entering the history, and junk created in two seconds becomes junk history
forever.

**Plan-generated** commitments — produced from a curriculum definition — inherit
their outcome and estimate from that definition and are pure checkboxes. The
guard has nothing to catch, because "DSA problem 47: Valid Anagram, medium,
25 min" is already specific.

Both paths produce the same Commitment. Only the input differs. See
docs/product.md, Conflict 3.

### Two surfaces, one dataset

**Today is warm** — a greeting, a progress ring, today's mission. **Reckoning,
history and patterns are cold** — precise and unflattering.

No cross-contamination. The reckoning flow never softens and the Today page
never lectures. That is a rule the code holds, not a matter of taste.

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
- Confetti
- Celebratory animation
- Leaderboards
- Any reward for **creating** or **reorganising** commitments
- Any score driven by **commitment volume**
- Motivational quote generation
- An "hours wasted" metric — shame with no action attached

The reasoning: every one of these rewards _engagement with the tool_ rather
than _execution of the work_. They make tidying the backlog feel like progress.
This app exists to make the gap between commitment and execution visible, and a
reward layer papers directly over that gap.

If a request seems to want one of these, propose the underlying need instead —
usually it is "I want to see whether I am improving", which is answered by
honest trend data over the event log, not by a score.

### Rewards and consequences ARE intended — administered by a person

The prohibition above is on **in-app, self-administered, symbolic** rewards.
It is not a prohibition on stakes.

**Real-world rewards and consequences, administered by an Overseer, are an
intended feature.** A second person holds the outcome: they see the adherence
record and grant or withhold something that actually matters outside the app.

That is a different mechanism, not a softer version of the same one. A badge is
a number the app gives itself for behaviour it also measures — a closed loop
with no external referent. A consequence administered by someone who knows you
cannot be gamed by reorganising a backlog, and cannot be shrugged off by
closing the tab.

The app's job in that arrangement is to be **an honest witness**: report what
happened, accurately, including the parts that are unflattering. It never
decides the reward, never applies it, and never softens the record to make the
conversation easier.

### Adherence is a rolling rate; a streak is never the headline

Adherence is displayed **primarily as a rolling rate over a window** — "17 of
the last 21 days".

A consecutive-day count **may** appear as a secondary stat. It must never be
the headline, and it must **never gate a reward or a consequence**. See
docs/product.md, Conflict 1.

The reason is the cliff. Miss one day at 40 and a consecutive counter reads 0,
which is a lie about your adherence and the documented trigger for abandoning
the app entirely. It also rewards the wrong thing: protecting a streak means
avoiding hard commitments rather than keeping them. A rate degrades gracefully,
recovers visibly, and is the number an Overseer can act on.

Milestone recognition survives as a **message tied to a real reward** — never
as a collectible. Today's progress ring is fine: it measures execution, resets
daily, and cannot accumulate into a score.

## Data ownership

**MongoDB is the single source of truth for all data. There is no external
store.** Every field is owned here, written here, and read here. Nothing this
app needs lives anywhere else.

### Google is removed

Google Tasks and Calendar are **not part of this architecture.** Not postponed,
not deferred, not behind a flag — removed. There is no sync code, no adapter,
no reserved field, and none should be written.

Earlier revisions of this file described Google as "postponed" and sketched a
future one-way mirror. That is withdrawn. A postponed integration still shapes
decisions: it invites reserved fields, "we'll need this for sync later"
abstractions, and hesitation about owning a value outright. MongoDB owns
everything, full stop.

If a Google integration is ever genuinely wanted, it is a new proposal that
faces the feature test from scratch, not a plan already agreed.

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

## Identity, roles and ownership

**Sign-in takes one field: username or email.** Both resolve to the same
account. Usernames are 3–20 characters of lowercase letters, digits, hyphen and
underscore, unique case-insensitively via a stored `usernameLower` — not a
collation, which is invisible in the document and silently degrades to
case-sensitive when a query does not request it. `admin`, `root`, `system`,
`pact`, `overseer`, `api` and `null` are reserved. Username changes are a
script, never a UI action.

**The lockout counter keys on the resolved user id, never the submitted
string.** With a per-string counter, "aryan" and "aryan@example.com" hold
separate budgets and an attacker alternating between them gets double the
attempts against one account. Identifiers resolving to nobody get their own
hashed counter, so enumeration is bounded without the collection becoming a
list of guessed identifiers. Unknown username, unknown email, wrong password
and locked-out all return **one byte-identical response**.

**Two roles: `primary` and `overseer`**, as an enum plus a permission matrix.
A third role later is a new value and a new column, not a new subsystem.

**Every scoped collection carries `ownerId`.** Commitments, series, events,
notifications, push subscriptions and settings. Every query filters on it, so a
primary reading their own data and an overseer reading the same primary's run
one query with a different value — rather than two code paths, one of which
eventually forgets. There is a **scanner test** that fails on any query against
a scoped model whose call text lacks an ownership filter, in the same style as
the `dueAt` writer scanner.

## Permissions

**One matrix, in [`src/lib/auth/permissions.ts`](src/lib/auth/permissions.ts).**
Every route guard derives from it via `requireCapability`. There is a test that
fails on any route without a guard, and on any inline `role === '...'`
comparison. Scattered role checks are how the fifteenth handler ends up subtly
wrong.

- **The primary has NO write path to reward or consequence configuration.** Not
  a hidden route, not a field accepted and ignored — the route must reject it.
  An arrangement whose subject can edit their own consequences is not an
  arrangement.
- **The overseer** reads progress, completions, misses, reckoning categories,
  deadline changes and adherence; writes only consequence configuration. No
  focus-session contents. **No raw event log** — nobody has `events:read` over
  HTTP. The overseer reads a purpose-built projection instead, because a
  filtered log exposes every future event type by default while a projection
  exposes only what someone put in it.
- **Free-text notes are private by default.** Structured categories are always
  visible; that is where the accountability value is. The free text is where
  the primary is honest with themselves, and they will be less honest if they
  know it is read. Sharing is opt-in, in settings.

## The relationship

A **Relationship collection**, not a field on User. A foreign key records only
the current state; a collection records the arrangement itself, so "you had an
overseer for six weeks and then removed them" survives it ending.

- **Invite:** single-use, 7-day expiry, stored hashed — it is a bearer
  credential. There is no open registration and there should not be.
- **Redemption is atomic**: a conditional update claims the row before the
  account is created, so a losing race leaves no orphan account.
- **Revocation is immediate.** The guard re-reads the relationship on every
  request rather than trusting the session, because a 90-day JWT issued before
  revocation would otherwise keep working — which is not a revocation.
- Revocation ends the **relationship**. It must never become a way to dismiss
  an individual consequence. That distinction is the point of the arrangement.

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

## The reckoning loop

A missed deadline is not an ending; it is the point at which there is something
worth asking about. **Needs-reckoning is derived on read**, exactly like the
miss it follows — `now > dueAt`, status open, and no `RECKONING_SUBMITTED` for
_this_ deadline. Never a stored flag.

While a miss is unanswered:

- **It cannot be rescheduled.** `changeDeadline()` refuses it. This is the
  whole point: rescheduling without answering is the frictionless drag that
  lets a deadline move ten times while the record shows a series of neutral
  replans.
- **It sorts above everything else** wherever work is listed.
- **Its notifications stop.** An unanswered miss must not generate a second
  wave about a deadline that has demonstrably passed.

Three questions, in order:

1. **Did you actually complete it?** If yes, the completion is recorded at its
   **real time**, and the history shows completed-late. Never on-time.
2. **Why?** One of twelve reasons — a closed list, because free text cannot be
   counted and a reason that cannot be counted cannot show a pattern.
3. **What changes?** A recovery action, offered based on the reason.

> **A reason that produces no consequence is journaling.**

Every recovery option in `src/lib/commitments/reckoning.ts` writes something
the system can observe or enforce — a rewritten outcome, created commitments, a
required next action, a blocked status with a named person. If a branch there
ever becomes a no-op, that option has stopped being a recovery and become a
feeling. Free text sits alongside every option, never instead of one.

**Reckonings are keyed to the deadline they answer**, via `ts`, like misses. A
commitment missed, reckoned, rescheduled and missed again requires a second
reckoning and produces two records. The unique partial index covers both
`DEADLINE_MISSED` and `RECKONING_SUBMITTED`, and **that list must match
`ONCE_PER_ENTITY`** — a type in one and not the other looks deduplicated in
tests and races in production. A test asserts they agree.

`changeDeadline()` requires a **category** as well as free text, and records
original, previous, new, both deltas, the category, the note and the count of
prior changes.

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

**`channel` is on the row.** Two channels are delivered: `in-app`, by whichever
request reads the inbox, and `web-push`, by the external per-minute tick. Both
read the same queue, and each delivery path **must filter on `channel`** — an
unscoped read marks the other channel's rows as sent without sending anything,
and the notification simply vanishes with no error. Never add a parallel queue
for a new channel; two queues drift.

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

## Web push

Push is a second adapter over the queue above, not a second queue. Everything
about scheduling has already happened by the time anything reaches the sender.

**Delivery is a queue scan, never a moment-in-time trigger.**
`POST /api/notifications/dispatch` asks "what is due and still pending?" and
acts on all of it. That is what makes a missed tick self-healing, and it is why
the Vercel daily cron works as a backstop for the per-minute Cloudflare Worker:
running late delivers late instead of not at all. **Nothing may ever depend on
the tick arriving.**

**Every row is claimed before it is sent** — a conditional update on
`status: 'pending'`. Exactly one of two overlapping invocations wins; the loser
sees `modifiedCount: 0`. Sending first and marking after double-sends whenever
one tick runs slow. The cost is that a crash between claim and send loses that
notification rather than repeating it, which is the right way round: a missed
reminder is a gap, a duplicated one is noise, and noise is what teaches someone
to ignore the app.

**The secret is compared in constant time.** A `===` returns on the first
differing byte, so response timing leaks how many leading characters were
right.

Subscription lifecycle:

- **404 and 410 delete the subscription immediately.** They are definitive: the
  endpoint will never exist again, and retrying generates an error on every
  tick forever.
- Any other error increments `failureCount`; five **consecutive** failures
  delete it. Any success resets the count, so a device that is merely offline
  is not deleted.
- **Browsers rotate or drop subscriptions without telling anyone.** The server
  keeps sending to a dead endpoint, the push service accepts it, and nothing
  arrives — with no error anywhere. This is the most common way push silently
  stops, so the browser's current subscription is compared against the server's
  on every app load and re-registered on mismatch.
- Payloads are capped near 4KB before encryption overhead. Send an identifier
  and short text, never a commitment document.
- `tag` is `commitmentId:type`, so a re-send **replaces** rather than stacks.

**The external tick fails silently.** Cloudflare cron does not retry and raises
no alert, so `lastDispatchAt` is recorded on every dispatch, exposed at
`/api/health/detail`, and surfaced as a dashboard warning past 15 minutes.
Without it push can stop for a week and the only symptom is notifications not
arriving — indistinguishable from having nothing due.

The Worker in [`infra/tick`](infra/tick/README.md) holds **no logic** on
purpose, so the scheduler stays swappable for cron-job.org or anything else
that can make one authenticated request.

## Focus sessions

A **FocusSession** is one sitting of work against one commitment. The
commitment says what was promised; the session says what actually happened
while trying to keep it. It is the only place real durations come from, and it
is what makes "you estimated 60 and it takes you 95" a fact rather than an
impression.

**`/focus/:commitmentId` is full screen and sits OUTSIDE `(shell)`.** No
navigation, no lists, no badges. A screen with somewhere to go is a screen you
go from.

### The server holds the clock

**`startedAt` is written server-side and elapsed is recomputed from it every
time.** `actualMinutes` is written once at the end from `endedAt - startedAt`.
The request body has no duration field and would not be believed if it did.

Nothing counts intervals in the browser. A study block is 60 to 90 minutes with
the phone locked, and a backgrounded tab's timers are throttled to once a
minute or stopped outright — an accumulating counter would report ninety
minutes as a few and nothing would look wrong. The client recomputes
`now - startedAt` each tick using an offset measured once against the server's
`serverNow`.

### The lock is server-side, in the guard

While a session runs, `commitment:write`, `series:write`, `curriculum:write`
and `settings:write` return **409 "You're in a session."** from
`requireCapability`, before the handler. Only the focus routes opt out, with
`duringSession: true`, and a scanner fails on any other route that sets it.

A lock the UI holds is not a lock: a second tab posts straight around it. One
running session per owner is enforced by a **unique partial index** on
`(ownerId)` where `endedAt: null`, not by checking first.

Reckoning is deliberately not locked — answering a miss is not planning, and
locking it would let an accidental session wedge the reckoning queue.

### Kind is the most gameable field in the app

`execution` is the default and changing it takes a deliberate click. The
planning-versus-execution ratio is computed from it, and it is defeated
entirely by calling planning "execution" — which would not feel like cheating,
because reading around a problem feels like working on it. A **required** field
would be worse: it gets the first option every time. Mid-session, the only
switch offered is _to_ execution.

### Three exits

| Exit               | What it does                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| **Done**           | Records actual minutes, asks one line on what changed, completes the commitment, advances a block's topic |
| **Need more time** | Corrects the estimate, appends `PROGRESS_LOGGED`, leaves it open                                          |
| **Blocked**        | Records `TASK_BLOCKED` and the blocker's kind; a person gets a follow-up                                  |

**"Need more time" is not a failure anywhere** — not in copy, not in adherence,
not in any metric. It is the honest report that an estimate was wrong, and an
app that penalises it teaches the user to stop reporting it, at which point
every estimate in the history is fiction.

A **block session** records progress against its topic's target — problems
solved, build finished — and that is what advances `TopicProgress`. It is the
reason the block is the commitment and the topic is the content. A block ending
`more-time` leaves the topic `in-progress` and makes it **tomorrow's preferred
suggestion for that block**, ranked above the day's slant and the phase focus.

### The research budget interrupts once

Optional, per session, and only meaningful for a research session. At zero:
"Research budget spent. Decide or start building." **Once, ever** — a budget
that nags gets dismissed reflexively, and then it is noise rather than a
decision point. Extending requires a written justification, because a budget
that is always extended is the same as not having one.

## Rewards and consequences

Real-world stakes, **configured only by the Overseer**. Not in-app rewards: the
anti-feature list still bans XP, levels, badges and confetti, because those are
internal currency with no external referent. This is the opposite — a second
person holds the outcome, and the app's only job is to be an honest witness.

**The authorization rule is positional.** Every route under
[`src/app/api/stakes/`](src/app/api/stakes/) is the overseer's, and a scanner in
[`src/lib/stakes-authorization.test.ts`](src/lib/stakes-authorization.test.ts)
walks that directory and fails if any route there requires a capability the
primary holds. The matrix stays the source of truth: the test asks `can()`
rather than restating the rule.

There is deliberately **no `GET /api/stakes`** — a read both roles need would be
guarded by `consequence:read`, which the primary holds, and that one exception
would turn "every route here" into "every route here except one". The primary's
own two actions live outside that directory: `api/rewards/claim` and
`api/vacation`.

The primary cannot create, edit, delete, dismiss, expire or reschedule a
consequence. Not through a route, not through a field accepted and ignored, not
through vacation mode.

### Bounded, and they do not stack

`MAX_CONSEQUENCE_WINDOW_DAYS = 7` — **one constant, enforced in the zod schema**,
not in the form. A cap that only exists in the UI is a cap the API does not
have.

**One active consequence at a time**, enforced by a unique partial index. A
second trigger while one is active appends `CONSEQUENCE_SUPPRESSED` and is
dropped — it extends nothing and queues nothing. Two stacked consequences are
not twice the motivation; they are the point at which the arrangement stops
feeling survivable, and that gets abandoned rather than satisfied.

### Discharge is doing the work

A consequence carries a discharge condition tied to what triggered it, and
satisfying it discharges automatically. **There is no dismiss branch and there
must not be** — a consequence with a dismiss button is a notification, and a
notification is what you learn to close without reading. It also expires at its
window regardless, so an undischarged consequence is never permanent.

Triggers evaluate against the **rolling adherence rate**, never a consecutive
count. Below five counting days nothing fires at all: one kept day out of one is
a rate of 1.0, and real stakes should not turn on a single Tuesday.

Evaluation runs on the **primary's** Today read. Reading never evaluates
elsewhere — an overseer opening their page must not be able to activate
anything.

### Vacation mode

One toggle, **the primary's**. `vacation:write` is absent from the overseer's
capabilities: a vacation someone else can veto is one you route around by not
opening the app.

While on, nothing is evaluated. Blocks still materialise and can still be
completed — it pauses expectations, not the app.

**Days on vacation leave the adherence denominator.** Not kept, not missed.
Counting them as kept flatters the record; counting them as missed makes the
pressure valve cost something, and a valve that costs something is one nobody
pulls. Stored as periods with `VACATION_STARTED` / `VACATION_ENDED`, so the
exclusion is auditable rather than invisible.

It **cannot discharge** an active consequence — that would be the dismiss button
by another name — and it does not stop one expiring.

### Revocation

Revoking the overseer relationship leaves active consequences and earned
rewards alone. Revoking is about who configures the arrangement in future; if it
cleared what was running, the fastest way out of any consequence would be
revoke, wait, re-invite. See docs/decisions.md, 040.

## Recovery mode

Above **10 unanswered misses or 20 overdue commitments**, `/dashboard` is
**replaced** — not annotated. Three slots: one commitment to finish, one to
reschedule with a reason, one to abandon. No metrics, no lists, no curriculum,
no drift. Leaving happens when both counts drop back under, which takes as many
passes as it takes.

A backlog past a certain size stops being information and becomes wallpaper,
and the normal dashboard invites the response that caused it: faced with a long
overdue list the reflex is to reschedule all of it, producing a bigger plan
than the one already not being kept. Three dispositions make that impossible —
only one slot reschedules.

It takes the **planning surfaces** with it: `/study`, `/postponements`,
`/tomorrow` and `/week` all redirect to the dashboard, and the nav stops
offering them. `/settings` stays reachable — locking someone out of settings
during a restrictive state is how they get stuck in it.

**Whether it is on is derived from the counts, every read.** There is no
`inRecovery` column. The _episode_ is a `RecoverySession` document, with a
unique partial index so concurrent reads open exactly one, and
`RECOVERY_MODE_ENTERED` / `RECOVERY_MODE_EXITED` in the log.

Recovery's reschedule **answers the miss first** and only then moves the
deadline. An unanswered miss cannot be rescheduled, and a backlog is exactly
when it would be tempting to let that slide.

`listOverdue` is a bounded page — 15, oldest first, unanswered above answered
within the page — returned with the true totals so a client cannot render a
page as if it were the whole set.

## The curriculum

The plan comes from a spreadsheet, `data/Aryan_SDE2_Frontend_Study_Plan_Jan2027.xlsx`,
which is **committed and is the authority.** Where it contradicts an earlier
tracker specification, it wins. `npm run curriculum:import` reads all four
sheets through a dependency-free reader in `scripts/xlsx.ts`; the mapping is
pure and lives in `src/lib/curriculum/import-map.ts`.

**The import is idempotent and never touches progress.** `topicprogress` is a
separate collection keyed on the same stable keys, and nothing in the import
path writes to it. Re-running is the normal way to pick up a spreadsheet edit;
an import that could lose progress is one nobody dares re-run, and a curriculum
that cannot be re-imported drifts out of sync with its source until they are
two different plans. Two things it will not overwrite, and reports instead: a
phase moved by an explicit re-plan, and a practice target corrected by hand.

The stable key is `block/module/topic/sub-topic`, slugged — derived from what a
row **is** rather than where it sits, so inserting a row halfway down the sheet
does not renumber every key below it and orphan their progress. Dry-run first;
the report says how many rows the parser could not read.

### The parser refuses to guess

`practiceRaw` is stored **verbatim** and the parse sits alongside it, never
instead of it. The rules are narrow: 21 of the 60 rows come in as `targetKind:
'other'`, flagged, and listed at `/study/review` to be fixed by hand.

That is the design working. "8–10 representative problems" has a target in it;
"Whiteboard + edge cases" does not, and no pattern matching changes that. A
target invented from "Choose storage for scenarios" becomes a number the plan
measures progress against, and every reading of it is wrong while looking
exactly like a number somebody set. An obvious gap gets fixed; a confident
wrong answer does not. Text matching two kinds at once is flagged rather than
resolved by precedence.

### A playlist is a pool, not a course

The workbook says so twice — the curriculum sheet's own header line, and every
Core resource's "how to use": _"Daily; don't finish as a course"_, _"Pick
relevant videos only"_.

So **`Resource` has no progress, no percentage, no remaining count, and never
will.** A source-scanning test fails on any identifier naming a pool and a
score together, and on any division by the size of one. Progress belongs to a
topic, which is a thing you can be done with; 40% of a shelf is not a fact
about anybody. A percentage here would turn "watch the two videos on the thing
you are weak at" into "get through 214 videos" and then reward the second —
the anti-feature list's failure arriving by a different door.

### Blocks, rhythm and the day's topic

Three study blocks — DSA 07:00–08:00, Frontend 08:00–09:30, System Design
09:30–10:00 — are **ordinary Series carrying a `blockId`.** They materialise
through the existing machinery and produce ordinary Commitment occurrences.
Never build a second scheduler for them.

`materialiseRange` resolves the topic **per occurrence**, because the weekly
rhythm makes Monday machine coding and Thursday testing; resolving once per
pass would name the same topic for a fortnight. The suggestion is ordered by
revision-on-Sunday, phase focus, day slant, P0 first, already-started, then
sheet order — and it is **a default, never a lock.** Every alternative is
offered, the reasons are shown, and an override sets `topicOverridden` so the
plan will not quietly revert it.

The estimate is the **block's** length, not the topic's parsed duration.
"5-min verbal framework" is the size of the output; a five-minute estimate on a
half-hour block makes the morning look cheaper than it is.

### The evening

**Never new material, and nothing at all when the morning blocks closed.** The
sheet's two evening rows are both prohibitions: "Only finish an incomplete
morning task or revise a weak topic", and "Protect sleep and consistency;
don't turn every free hour into study — Priority".

A day where everything closed is exactly the day it is tempting to offer a
bonus, and precisely the day the sheet says to stop. When a block did not
close, the evening points at **that existing commitment** rather than creating
a second one — the morning work already has a deadline and a miss, and a
duplicate row would double-count it everywhere.

### Drift

Phase-level: the proportion of the phase's **P0** topics done against the
elapsed proportion of its dates, derived on read, ±10% tolerance.
`needs-revision` does not count as done — it is the status meaning "finished
badly", and counting it would make the number agree with the most optimistic
reading of the user's own work. Ahead-of-schedule is computed too.

**Nothing re-flows the plan.** Phase dates move only through `replanPhase()`,
which requires a reason, shifts every later phase by the same amount rather
than squeezing them, and appends `PLAN_REPLANNED`. `originalStartDate` and
`originalEndDate` are immutable, because the original schedule is the only
thing that makes "behind" mean anything.

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
- **Mongoose does not validate updates.** `updateOne`, `updateMany`,
  `findOneAndUpdate`, `replaceOne` and `bulkWrite` all skip validators by
  default — that is how `role: 'owner'`, a value outside its own enum, reached
  this database and produced an account that failed every capability check.
  `connectToDatabase()` sets `runValidators` and `setDefaultsOnInsert`
  globally, and a scanner in
  [`src/lib/db-validation.test.ts`](src/lib/db-validation.test.ts) fails on raw
  driver access outside a short annotated list, on any `bulkWrite`, and on any
  call that turns validation off. It must be a global rather than a schema
  plugin: `mongoose.plugin()` only reaches schemas compiled after it runs, and
  the model modules are evaluated at import time.
- **Materialisation costs one round trip per RANGE, not per occurrence.**
  Commitments, events and notifications each go in one bulk insert, with ids
  generated up front. Writing one at a time still produces the right rows and
  took 34 seconds for a fortnight against M0 — past a Hobby function's whole
  budget. A test asserts the write count does not scale with the number of
  occurrences, because this regresses invisibly.
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
src/lib/auth/          Auth.js config, permissions matrix, throttling, relationship
src/lib/commitments/   commitment + series services, reckoning, timeline, deadline
src/lib/db/            mongoose connection + models
src/lib/db/events.ts   appendEvent — the ONLY write path into the event log
src/lib/schemas/       zod schemas — source of truth for types
src/lib/env.ts         environment schema + parsed values, server-only
src/lib/behavior/      pure analysis functions, no I/O, clock passed in
src/lib/notifications/ queue, delivery, dispatch, push, settings, inbox
src/lib/focus/         focus sessions: the clock, the lock, the three exits
src/lib/stakes/        rewards, consequences, vacation
src/app/api/stakes/    OVERSEER ONLY -- enforced positionally by a scanner
src/lib/today/         the day, the greeting, the week, progress
src/components/today/  the ring, the next action, the block ledger
e2e/                   Playwright: the 390px checks
src/lib/curriculum/   import, suggestion, rhythm, evening rule, re-plan
data/                 the study workbook -- the authority on the plan
src/lib/db/migrations/ one-off index migrations
infra/tick/            Cloudflare Worker: the per-minute tick, no logic
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

Breakpoints are 640 / 1024 / 1440 (`sm` / `lg` / `xl`). **Mobile first** —
commitments get created and completed on a phone, and the desktop layout is the
secondary case. Every surface is checked at 390px by
[`e2e/today.spec.ts`](e2e/today.spec.ts).

### There is no colour for "done"

`signal` means **"this needs you"** and appears at most twice on a screen.
Every other state is a **value** distinction on the one foreground:

| Token     | Means                                      |
| --------- | ------------------------------------------ |
| `text`    | done, present, real                        |
| `text/60` | a secondary fact                           |
| `text/40` | metadata: times, counts, labels            |
| `text/25` | not yet, absent, the empty half of a gauge |
| `edge`    | structure: rules, tracks, inactive strokes |
| `signal`  | needs you                                  |

The obvious move when "done" needs a colour is a green. That green is a reward
for completing, and a reward for completing is the one reward this app is
allowed to withhold.

### Two typefaces: text, and figures

The system sans sets text. The system mono is the **figure face** and carries
every measured number — times, durations, counts, percentages — through the
`.figures` class, with `tabular-nums` and `slashed-zero`. A column of times
that aligns, and a duration that reads as a quantity rather than as words, is
most of what separates an instrument from a list. No webfont: nothing to fetch,
nothing to shift, nothing to fail offline.

`display` (44px) exists for the ring's numerator and nothing else.

### The references are instrument panels and printed ledgers

Not SaaS dashboards. Hierarchy is carried by size and weight. Rows are
separated by hairline rules, not by identical rounded cards with soft shadows.
`surface` is used for the one or two raised planes on a page, not for every
list item.

**Avoid:** gradient decoration, all-caps eyebrow labels above every section,
emoji as structural chrome. A section label is lowercase and small, or it is
not there. There is a test that fails on emoji in any component and on
`uppercase` anywhere on the Today surfaces.

## Today

Order down the page, and the order IS the design:

1. **Recovery mode**, if active — replaces everything below.
2. **Needs reckoning**, if any. Above all other work, always.
3. **The next action** — the largest element on the page. One commitment, its
   outcome, its estimate, and a Start button that opens focus mode.
4. **The three blocks and the ring.**
5. **Other commitments due today**, listed plainly. Not in the ring.
6. **The overdue count**, as a link. Never a list — that lives on its own page
   and is paged.
7. **Phase drift**, one line.

Two registers on one page. The greeting is 28px with room around it; the ledger
below is 14px on hairline rules with tabular figures. **Warmth comes from the
copy and the typography, never from softening what the numbers say.**

The visual boldness is spent on exactly two things: the next action, and the
ring.

### The ring is three segments

One arc per block, filled or hollow, with a gap between them. **The denominator
is exactly three.** It measures adherence to the plan, and the plan is three
blocks — other commitments are real work and are listed as such, but a
denominator of "everything due today" would make a day with nine errands read
as nine-elevenths of a study plan. A continuous arc is also what every fitness
app has; three segments read as an instrument, and partial fill is not a state
that exists.

### The greeting is a rotation, not a shuffle

All copy lives in [`src/lib/today/greeting.ts`](src/lib/today/greeting.ts) —
add a line there and nothing else changes. Selected from the date, the time
bucket and the block state, stepping through each pool in order so no line
repeats within `pool.length` days.

Never random. A line that changes on every render is a variable reward
schedule: it teaches the user to reload the page, which is engagement with the
tool rather than execution of the work.

The buckets are the workbook's boundaries — 07:00, 10:00, 11:00, 19:00, 22:00,
23:30 — so nobody is greeted mid-block as though they had the evening. The late
bucket ignores block state on purpose: "well done" at 11:45pm would be the warm
surface endorsing the thing the plan says not to do.

### Tabs

**Today, Tomorrow, Week, Study, Progress.** Postponements and Settings are
reachable but not in the primary bar.

Blocks 1, 2 and 3 are sections **within** Study, not tabs. The earlier
DSA / Learning / Frontend split predates the block model and describes a
different product: those were three subjects, these are three windows in one
morning against one curriculum.

**Progress is history and none of it appears on Today.** Adherence is a rolling
rate over 21 days; the consecutive run appears once, small, named `currentRun`,
and gates nothing. A test fails on the word "streak" in any component.

## Current state

Scaffold, auth, the core data model, an installable PWA, notifications with web
push, the reckoning loop, the role/ownership model, the curriculum with its
daily generator, **focus sessions and recovery mode.**

Working: username or email sign-in, primary and overseer roles, ownership
scoping across every collection with a scanner enforcing it, a permission
matrix every route derives from, single-use invites with immediate revocation,
and an overseer surface showing categories but not free text.

Working, additionally: the workbook import, the three daily study blocks as
Series, per-day topic suggestion with override, phase drift, and an explicit
re-plan.

Working, additionally: server-clocked focus sessions with a server-enforced
lock, block sessions that advance topic progress, recovery mode replacing the
dashboard and gating the planning surfaces, and the Today / Tomorrow / Week /
Study / Progress surfaces with the greeting and the block ring.

Working, additionally: overseer-configured rewards and consequences with
bounded non-stacking windows, discharge by doing the work, and primary-
controlled vacation mode.

Not built yet: the video player and the behaviour engine.

The product is specified in [`docs/product.md`](docs/product.md), which is
authoritative where this file disagrees. Decisions and their reasoning are in
[`docs/decisions.md`](docs/decisions.md).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
