# Personal Accountability Dashboard

A personal command center designed to make procrastination, missed commitments, and recurring patterns of avoidance visible.

This is not meant to be another passive task-management app.

The goal is simple:

> If I say I will do something, the system should remember it, check whether I actually did it, and make me confront the pattern when I repeatedly don't.

## Why This Exists

Most productivity tools help you **organize** work.

This project is focused on helping you **actually execute** it.

A task shouldn't simply disappear when its deadline passes.

Instead, the system should answer:

- What did I commit to?
- When did I commit to doing it?
- Did I actually do it?
- If not, why not?
- What is the new deadline?
- How many times has this happened before?
- Am I consistently underestimating certain types of work?
- What commitments am I currently avoiding?
- Am I making progress or simply moving deadlines around?

The dashboard should make these patterns difficult to ignore.

## Core Philosophy

### 1. Commitments over intentions

A task is treated as a commitment with an owner, deadline, and expected outcome.

### 2. Accountability over aesthetics

The interface should prioritize useful feedback and behavioral visibility over unnecessary visual polish.

### 3. Failure should create information

Missing a deadline isn't the end of the workflow.

A missed commitment should produce useful data:

- Reason for failure
- Amount of delay
- Whether the task was rescheduled
- Previous attempts
- Recurring failure patterns

### 4. Rescheduling is not completion

Moving a deadline should not make the original commitment disappear.

The system should preserve the history.

### 5. Patterns matter more than individual tasks

One missed task may be normal.

Repeated behavior is what the dashboard should expose.

## Planned Features

### Task & Commitment Management

- Create commitments
- Deadlines
- Priority
- Categories
- Estimated effort
- Actual effort
- Recurring commitments
- Dependencies
- Notes and remarks

### Accountability Workflow

When a deadline passes:

1. Ask whether the commitment was completed.
2. If completed, record the completion.
3. If not completed, require a reason.
4. Ask for a new realistic deadline.
5. Record the delay.
6. Preserve the previous deadline and history.

### Behavioral Insights

The dashboard should eventually identify patterns such as:

- Frequently missed deadlines
- Chronic rescheduling
- Consistent underestimation of effort
- Tasks repeatedly avoided
- Categories with poor completion rates
- Time-of-day productivity patterns
- Weekly/monthly execution trends

### Daily Command Center

The main dashboard should answer:

> "What do I need to do right now, and what am I currently failing to deal with?"

Potential sections include:

- Today's commitments
- Overdue commitments
- Upcoming deadlines
- Recently missed commitments
- Commitments requiring a response
- Current streaks
- Execution statistics
- Accountability alerts

## Data Source

The initial implementation is expected to use the **Google Tasks API** as the task/commitment data source.

The application may maintain additional metadata required for accountability and historical analysis where Google Tasks alone is insufficient.

## Tech Stack

Planned stack:

- React
- TypeScript
- Vite
- Google Tasks API
- Modern CSS / component system
- Client-side state management where required

The exact architecture may evolve as the application grows.

## Development Workflow

The repository uses a protected branch workflow.

```text
main
 ↑
Pull Request
 ↑
dev
 ↑
feature/*
