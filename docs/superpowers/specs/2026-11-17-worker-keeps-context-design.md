# Review fix round keeps the worker's session

Status: design, 2026-11-17. Brainstorm: `.superpowers/brainstorm/worker-keeps-context/brainstorm.json`.

## Intent

When a task's reviewer fails it for the first time, the engine sends the findings into the same worker session
that built the task, so it fixes its own work with its context intact, instead of a fresh worker that rereads the
spec, the plan and the code it just wrote. The idea comes from VelaTerm's Plan / Execute, whose executor "keeps its
context between rounds".

## Today

- A first review fail (`pkg/orchestrate/review.go:307-318`) increments `ReviewRound`, sets the task `pending` and
  clears `RunID`; `Schedule` then dispatches a new worker run in the same lane tree, which still holds the rejected
  commit, and `taskPrompt` carries the findings. A second fail (`MaxReviewRounds = 2`) goes to `failReview` and wakes
  the lead.
- `dag sendback` (`pkg/orchestrate/leadsteer.go:172`), `retry` and `escalate` likewise start a new worker.
- The engine can already reopen a worker's session in its own tab with a first turn: `ReopenSession`
  (`pkg/orchestrate/pause.go:394`) → `jarvis.ResumeRunWorker(ctx, tabORef, runtime, sessionId, nudge)`
  (`pkg/jarvis/runexec.go:139`), with resume flags for claude, pi, agy and codex (`ResumeWorkerArgs`,
  `runexec.go:112`). A Claude session with no transcript cannot be resumed (`pause.go:449-469`).
- arcterm reads a Claude agent's context use as `AgentUsage.ContextPct` (`pkg/baseds/baseds.go:66`).

## Decisions

### When the old session is kept

Only the automatic round after a task's first review fail. `dag sendback`, `retry`, `escalate` and a stalled task's
retry keep today's behaviour: a new worker.

Agent's call (builder question 3): the test is `ReviewRound == 1` alone. A worker that a lead's `retry` or `escalate`
started (which resets `ReviewRound` to 0, `pkg/orchestrate/mutation.go:579`, `:603`) gets the same-session round
after its own first review fail too; "retry keeps today's behaviour" covers the retry's own dispatch only. No new
flag.

### Context already large

The aim is a better fix (the worker remembers why it did what it did), not fewer tokens: workers keep their 5-minute
cache (`ShortCache`, `pkg/orchestrate/engine.go:999`), so a resumed session usually writes its context to the cache
again, which costs about what a fresh worker spends rereading the spec and the diff.

The engine reads the old worker's last known context size in tokens (`ContextPct × ContextMax`,
`pkg/baseds/baseds.go:66`). Below 150k tokens it reopens that session, whatever the window (200k or 1M); at 150k or
more, or when the runtime reports no figure (today pi, codex and agy), it starts a new worker as today.

### What the old worker receives

The session reopens in its own tab (scrollback kept) with one first turn: the reviewer's findings verbatim, an
instruction to fix them on top of the lane's current commit, rerun the task's own checks, and finish with
`wsh jarvis complete --report` as before. The task does not restate itself: the session already holds it. The second
round's reviewer is still a fresh session, and a second review fail still wakes the lead, unchanged.

### When the session cannot be reopened

The engine falls back to a new worker exactly as today and never leaves the task waiting on a failed reopen. Causes
include: the worker's tab is gone, a Claude session has no transcript, the worker was launched before resume support
(`agent:baseargs` missing), the runtime cannot resume, context at or above 150k tokens, or no context figure.

Agent's call (builder question 2): "a failed reopen" means one the engine can see before or at start. Before
resuming a Claude session the engine checks its transcript exists (`claudeTranscriptExists`,
`pkg/orchestrate/pause.go:440`), which removes the main cause of an immediate "No conversation found" exit, and
treats any error from `ResumeRunWorker` as a fallback to a new worker in the same round. A resumed session that
starts and later exits without a report goes through today's stall handling (stalled, then the lead, or the one
automatic stall retry); no new task state or watch window.

### What the person sees

One run event per fix round: `t-N: review fix round in the same session`, or `t-N: fresh worker: <reason>`. The
worker's row in the Agent tree keeps its tab, so no extra row appears. No other UI.

## Left to the builder

- Whether round two reuses the old worker's `Run` row or a new row pointing at the same session, and what the digest,
  the reviewer brief and `wsh jarvis complete` need for either.
- Where the engine reads the last `ContextPct` of a worker that has already ended its turn or exited.
- What state the old worker is in while the reviewer runs (exited, or idle in its tab), and how `ResumeRunWorker`
  restarts it from there.
- Tests in `pkg/orchestrate` for both branches: same session below 150k tokens, and each fallback reason.

## Out of scope

- Nesting workers under the lead in the Agent tree: already built (`frontend/app/view/agents/agenttreemodel.ts`,
  `TreeFolds`).
- Keeping the session for sendback, retry, escalate or stalled tasks.
