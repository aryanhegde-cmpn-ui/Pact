# Pact — what it is and what it is for

> This document is authoritative. Where `CLAUDE.md` disagrees with it,
> **this wins** and CLAUDE.md gets corrected.
>
> Part one states the product. Part two is the reconciliation of the four
> source specifications, kept verbatim because the reasoning behind each
> decision is the part worth re-reading when someone wants to relitigate it.

## The problem

The gap between saying you will do something and doing it.

Most tools help you organise work. Organising is not the bottleneck. The
bottleneck is that a deadline passes, nothing happens, the item quietly moves,
and the moving leaves no trace. Do that thirty times and the record shows
thirty tidy commitments and no evidence of the pattern that produced them.

Pact exists to make that pattern impossible to lose.

## The feature test

> **Does this increase the probability that the user actually does the thing?**

Not "is this interesting", not "is this technically neat". Anything that fails
gets written into [`rejected.md`](rejected.md) with the reason, because writing
the rejection down is what stops it being relitigated in three months.

## The core loop

```
commit  →  deadline passes  →  MISS  →  RECKONING  →  RECOVERY  →  commit again
                                          ↑                          │
                                          └──────── missed again ────┘
```

A miss is not an ending. It is the point at which the system has something
worth asking about, and the answer is worth more than the miss cost.

**Miss.** Derived on read: `now > dueAt` and the status is neither done nor
abandoned. Never a stored flag — it changes with the clock, not with a write.

**Reckoning.** Three questions, in order: did you actually do it (recorded at
its real time, shown as late); why (a closed list, because free text cannot be
counted); and what changes.

**Recovery.** Every option produces an effect the system can observe or
enforce:

> **A reason that produces no consequence is journaling.**

**Until it is reckoned**, a missed commitment cannot be rescheduled, sorts above
everything else, and stops generating notifications.

## Two surfaces, one dataset

**Today is warm.** A greeting with a configurable nickname, a progress ring,
today's mission. It costs nothing and makes opening the app more likely, which
passes the feature test.

**Reckoning, history and patterns are cold.** Precise, unflattering, never
cute.

No cross-contamination: the reckoning flow never softens, and the Today page
never lectures. That boundary is a rule the code holds, not a matter of taste.

## Two creation paths, one model

**Plan-generated** commitments inherit their outcome and estimate from the
curriculum definition and are pure checkboxes. Nothing is typed.

**Manually created** commitments keep the full guardrails: outcome, estimate,
deadline, priority.

The friction exists to stop vague commitments entering the history. A
commitment generated from "DSA problem 47: Valid Anagram, medium, 25 min" is
already specific, so the guard has nothing to catch.

## Stakes

Symbolic in-app rewards are prohibited: XP, levels, badges, leaderboards,
confetti, any reward for creating or reorganising commitments. These are
internal currency with no external referent — the number only means something
inside the app.

**Real-world rewards and consequences administered by an Overseer are the
intended mechanism.** A second person sees the record and grants or withholds
something that actually matters outside the app.

Two constraints:

- **Consequences are bounded.** A maximum window, set once, that the Overseer
  works within. A month-long consequence stops being motivation and becomes
  background resentment.
- **The primary can revoke the arrangement** — the whole relationship, never an
  individual consequence. That distinction is the point. It is also ordinary
  engineering: an account with permanent write access you cannot remove is a
  liability regardless of who holds it.

The app is an **honest witness**. It reports what happened, including the
unflattering parts. It never decides the reward, never applies it, and never
softens the record.

## Adherence

**Displayed primarily as a rolling rate** — "17 of the last 21 days", with a
ring. A consecutive-day count may appear as a **secondary** stat, but never as
the headline and **never gating a reward or a consequence**.

A consecutive counter has a cliff: miss one day at 40 and it reads 0, which is
a lie about your adherence and the documented trigger for abandonment. A rate
degrades gracefully and still goes up.

## Schedule drift

When you fall behind, the plan **holds and shows the gap**. It does not
silently re-flow the remaining material into the remaining days.

Re-planning is an explicit action, recorded as an event with a reason, exactly
like a deadline change. Silent re-flowing is the study-plan version of silently
moving a deadline — a 26-week plan quietly becoming a 40-week one with no
moment where you noticed.

## Vacation mode

One toggle. Pauses accountability expectations without erasing history. It is
the pressure valve that prevents "I am behind, so I will abandon the whole
thing."

## What the app owes the user

- **Accuracy over comfort.** A late completion is recorded as late.
- **Evidence, not assertion.** Every claim is backed by the event log.
- **No silent state changes.** Especially deadlines and schedules.
- **Honesty about its own failures.** Cached data is marked stale; a stopped
  notification tick is surfaced rather than looking like quiet.

## Not in scope

Google Tasks and Calendar are **removed from the architecture**, not postponed.
Also dropped: XP, levels, badges, leaderboards, confetti, motivational quote
generation, and an hours-wasted metric — shame with no action attached.

No AI runs inside Pact. A conversational layer reads Pact's state through a
read-only snapshot and event feed, plus a small command API that creates
commitments under Pact's own rules.

---

# Pact — product decisions

Four specifications, written by different people, describing overlapping products. This resolves them into one. It should land in the repo as `docs/product.md` and drive an update to `CLAUDE.md`, because right now CLAUDE.md forbids several things you've now asked for.

## What each document is

**PACT_FEATURE_SPEC** — the constitution. It restates the architecture already built and adds the behavioural layer. Treat this as authoritative where documents conflict, except where noted below.

**PACT_PERSONAL_OPERATING_SYSTEM_INTEGRATION** — Pact exposes its state to a conversational AI layer so that layer can read execution truth instead of guessing, and create commitments through Pact's rules instead of keeping a shadow list. Genuinely good, cheap to build, and correctly placed late.

**DSA_Life_Tracker_Features_FINAL** — the content: 165 DSA problems over 26 weeks, 22 system design videos, frontend projects, life tasks, habits, and the reward/consequence system.

**DSA_Life_Tracker_Login_User_Experience_FINAL** — the interface: a warm daily command centre with a greeting, a progress ring, and separate Today / Tomorrow / This Week / Progress tabs.

---

## Conflict 1 — Streaks

**The conflict.** PACT_FEATURE_SPEC §25 bans streaks outright, and §26 lists "streaks that turn one missed day into abandonment" as an anti-pattern. The tracker specs put `🔥 12 DAY STREAK` in the header of the first screen and use streak milestones to unlock rewards.

**Decision.** Build the underlying adherence data. Display it primarily as a rolling rate — "17 of the last 21 days" with a ring — rather than a consecutive-day counter. A consecutive count may appear as a secondary stat, but it is never the headline and never gates a reward or a consequence.

**Reasoning.** Both documents actually want the same thing: an answer to "am I keeping up?" A consecutive counter answers it in a way that has a cliff. Miss one day at 40 and the number becomes 0, which is a lie about your adherence and is the documented trigger for abandonment. A rolling rate degrades gracefully, resists the "do a token version to protect the streak" failure, and still gives you a number that goes up. Milestone rewards key off the rate over a window instead of an unbroken run.

This is a display decision over shared data, so switching is a one-line change if you disagree once you've lived with it.

## Conflict 2 — XP, levels, badges

**Decision.** Not building them. Milestone recognition stays as a message tied to a real reward.

**Reasoning.** These are internal currency with no external referent — the number only means something inside the app, which is exactly the failure the anti-feature list exists to prevent. You already have something far stronger: an Overseer who administers real consequences. A badge competes with that and dilutes it.

The `🥞 AHEAD OF SCHEDULE` recognition stays, as a message. Today's progress ring stays — it measures execution, resets daily, and can't accumulate into a score.

## Conflict 3 — Friction

**The conflict.** PACT_FEATURE_SPEC requires outcome, estimate and next action on every commitment. The tracker spec says it should never feel like a second job and the user shouldn't type every task.

**Decision.** Two creation paths against one model. Plan-generated commitments inherit outcome and estimate from the curriculum definition and are pure checkboxes — you never type anything. Manually created commitments keep the full guardrails.

**Reasoning.** The friction exists to stop vague commitments entering the history. A commitment generated from "DSA problem 47: Valid Anagram, medium, 25 min" is already specific, so the guard has nothing to catch. Both documents get exactly what they asked for.

## Conflict 4 — Tone

**The conflict.** Pact is deliberately uncomfortable. The tracker wants warm, cute, game-console.

**Decision.** Same data, two surfaces. Today is the warm command centre: greeting with your configurable nickname, progress ring, today's mission. Reckoning, history and patterns are the cold instrument. No cross-contamination — the reckoning flow is never cute, and the Today page never lectures.

**Reasoning.** The feature test is whether it increases the probability you do the thing. A greeting costs nothing and makes you more likely to open the app. That's a pass. It only becomes a problem if warmth starts softening the accountability surfaces, which is a rule the code can hold.

Both tracker documents also say no motivational quote spam. Agreed, and easy — the personality lives in the greeting and the visual design, not in generated text.

## Conflict 5 — Schedule drift

**Not stated in any document, but it decides what the study planner is.** When you fall behind on a 26-week plan, does the plan re-flow the remaining material into the remaining days, or does it hold the original schedule and show the gap?

**Decision.** Hold and show the gap. Re-planning is an explicit action you take, and it's recorded as an event with a reason, exactly like a deadline change.

**Reasoning.** Silent re-flowing is the study-plan version of silently moving a deadline, which is the single behaviour this entire product exists to prevent. It would let a 26-week plan quietly become a 40-week plan with no moment where you noticed. The tracker spec asks the system to recognise whether you're ahead or behind, which requires an original schedule to compare against.

## Conflict 6 — Overseer authority

**Decision.** Build it as an authorization model, not a UI convention. The primary account has no write path to reward or consequence configuration — not a hidden button, no route that accepts it. The Overseer has read access to progress, completion, misses and reckoning reasons, and write access only to the reward and consequence configuration.

Two constraints on top of what the documents specify:

**Consequences are bounded.** Your own spec says consequences reset daily or weekly and do not accumulate indefinitely, then lists "no ice cream for a month" as an example. Those contradict. Enforce the rule in the config: a maximum window, set once, that the Overseer works within. A month-long consequence stops functioning as motivation and becomes background resentment.

**The primary can revoke the arrangement.** Not dismiss an individual consequence — that would defeat the point — but end the Overseer relationship entirely. This is partly a safety valve and partly ordinary engineering: an account with permanent write access to your app that you cannot remove is a liability regardless of who holds it.

## Conflict 7 — Where the AI layer lives

**Decision.** Pact exposes a read-only snapshot endpoint and a queryable event feed, plus a small command API for creating and updating commitments under Pact's rules. No AI runs inside Pact.

**Reasoning.** The integration document is right that the danger is two task lists. Keeping Pact as pure execution truth and letting a conversational layer read it is the correct split, and it means the interesting analysis can improve without touching the app. It's also cheap: a handful of endpoints and a scoped API token.

Late in the order, because the snapshot is mostly empty until reckoning, focus sessions and the study plan are generating data.

---

## New scope these documents add

- **Curriculum and lessons.** DSA problems with links and difficulty, system design videos with an in-page player, frontend projects. Modelled as Curriculum → Module → Lesson with an extensible lesson type, so adding a new content kind later is a new type rather than a new subsystem.
- **In-page video.** The YouTube IFrame Player API gives real watch progress from player state events, which makes "time spent watching" a measured number rather than a checkbox. Some videos disable embedding, so a fallback link is mandatory. Import lessons from a JSON file you provide rather than the YouTube Data API — no API key, no quota, and you're providing the list anyway.
- **Roles.** Primary and Overseer, with the model general enough for more later.
- **Rewards and consequences**, configured by the Overseer, triggered by adherence, with recovery unlocking a consequence as your spec describes.
- **Vacation mode.** One toggle, pauses accountability expectations without erasing history. Important beyond convenience — it's the pressure valve that prevents "I'm behind, so I'll abandon the whole thing."
- **Tabs.** Today / Tomorrow / This Week / Progress / DSA / Learning / Frontend, as specified. Today never shows history.
- **Ahead-of-schedule completion.** Completing tomorrow's work today is recognised, not just permitted.

## Dropped

XP, levels, badges as collectibles, leaderboards, confetti, any reward for creating or reorganising commitments, motivational quote generation, an hours-wasted metric (your spec explicitly rejects it and it's right — it's shame with no action attached), and Google Tasks, which is now removed from the architecture entirely rather than postponed.

## Still open

**Curriculum data.** Send the DSA list — problem name, link, difficulty, week or module — and the video list with YouTube IDs, in whatever format is convenient. JSON or a table is easiest; I'll specify the import shape in the PR that needs it.

**Who is the Overseer.** Not a design question, a practical one: that account needs its own credentials, and the sign-up path for a second user doesn't exist yet.

**Consequence window.** What maximum should the config enforce? A week is my suggestion.
