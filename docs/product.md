# Pact — what it is and what it is for

> **Status of this document.** The reconciled specification was to be supplied
> separately and has not arrived. This is assembled from `CLAUDE.md` and the
> `feat/reckoning` brief, which are the authoritative sources currently in the
> repository. Where the supplied specification differs, **it wins** — replace
> the relevant sections here rather than reconciling by hand.

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

**Reckoning.** Three questions, in order:

1. _Did you actually complete it?_ If yes, the completion is recorded with its
   real time, and the history shows completed-late — not completed-on-time.
2. _Why was it missed?_ One of twelve reasons. Not free text: free text cannot
   be counted, and a reason that cannot be counted cannot show a pattern.
3. _What changes?_ A recovery action, offered based on the reason.

**Recovery.** Every option produces an effect the system can observe or
enforce. This is the load-bearing rule of the whole feature:

> **A reason that produces no consequence is journaling.**

Free text sits _alongside_ every option, never instead of one.

**Until it is reckoned**, a missed commitment cannot be rescheduled, sorts above
everything else wherever it is listed, and stops generating notifications. The
first rule is the important one: rescheduling without answering is exactly the
frictionless drag this app exists to prevent.

## Stakes

Symbolic in-app rewards are prohibited — see the anti-features list in
`CLAUDE.md`. Points, XP, levels, badges, confetti and leaderboards all reward
engagement with the tool rather than execution of the work.

**Real-world rewards and consequences administered by an Overseer are an
intended feature.** A second person sees the adherence record and grants or
withholds something that actually matters. That cannot be gamed by
reorganising a backlog or shrugged off by closing the tab.

The app's role is **honest witness**. It reports what happened, including the
unflattering parts. It never decides the reward, never applies it, and never
softens the record to make the conversation easier.

**Adherence is a rolling rate over a window**, never a consecutive-day streak.
A streak converts one missed day into a reason to stop opening the app, and
rewards avoiding hard commitments over keeping them. A rate degrades
gracefully and recovers visibly.

## What the app owes the user

- **Accuracy over comfort.** A late completion is recorded as late.
- **Evidence, not assertion.** Every claim is backed by the event log, and the
  timeline shows the sequence that produced it.
- **No silent state changes.** Especially deadlines.
- **Honesty about its own failures.** Cached data is marked stale; a stopped
  notification tick is surfaced rather than looking like quiet.

## Not in scope

Google Tasks and Calendar are **removed from the architecture**, not postponed.
See `CLAUDE.md`. Reintroducing them is a new proposal facing the feature test
from scratch.
