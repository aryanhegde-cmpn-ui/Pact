# Rejected

Features considered and not built, with the reason.

The test every feature faces:

> **Does this increase the probability that the user actually does the thing?**

An entry here is not a "no for now" backlog. It is a record of a decision, so
the same idea does not get relitigated from scratch later. If circumstances
genuinely change, add a new entry that supersedes the old one — do not quietly
delete.

---

## Streaks

**Rejected:** 2026-09-04
**Source:** Listed as a "Current streaks" dashboard section in the original
project README.

**Why it fails the test:**

A streak measures consecutive days of tool compliance, not execution. It fails
in both directions:

- While it is alive, it rewards doing the minimum to keep the number intact,
  which pulls effort toward whatever is easiest to tick off.
- The moment it breaks, it converts one bad day into a reason to stop opening
  the app — precisely when the user most needs to see what happened.

The underlying want is real: _"am I improving?"_. That is answered by trend
data over the event log — completion rate over rolling windows, delay
distributions, categories that are drifting — which is honest, survives a
missed day, and cannot be gamed by rescheduling.

Also a listed hard anti-feature in `CLAUDE.md`.

---

## Points, XP, levels, badges

**Rejected:** 2026-09-04

**Why it fails the test:**

Every one of these is a score over _interaction with the app_. They can be
raised by creating tasks, splitting tasks, reorganising lists — activity that
feels productive and is not. The app's entire purpose is exposing the gap
between commitment and execution; a points layer sits directly on top of that
gap and hides it.

Hard anti-feature in `CLAUDE.md`.

---

## Confetti and celebratory animation on completion

**Rejected:** 2026-09-04

**Why it fails the test:**

The reward arrives at the wrong moment. Celebration on completion trains
attention toward the click that marks a thing done rather than the work, and it
makes marking-done attractive independently of whether the work happened.

Completing something should be quiet and unremarkable. The signal this app
should give is about the pattern over time, not the individual tick.

Hard anti-feature in `CLAUDE.md`.

---

## Leaderboards

**Rejected:** 2026-09-04

**Why it fails the test:**

This is a single-user application. There is nobody to compare against, and
importing a comparison target — past self, an average, a goal line — turns the
data into a performance rather than a mirror.

Hard anti-feature in `CLAUDE.md`.

---

## Task-volume metrics

**Rejected:** 2026-09-04

**Why it fails the test:**

"Tasks completed this week" rewards splitting one real commitment into six
small ones. Any metric driven by count rather than by whether commitments were
honoured on their own terms is trivially gamed, and gaming it feels like
success.

Behavioural metrics must be defined over commitments and their outcomes —
made, met, missed, rescheduled — never over volume.

Hard anti-feature in `CLAUDE.md`.
