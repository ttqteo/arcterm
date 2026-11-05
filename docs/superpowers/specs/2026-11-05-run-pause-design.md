# Run pause and RAM regulation — design

Date: 2026-11-05. Brainstorm: `.superpowers/brainstorm/run-pause/brainstorm.json`.

## Intent

A run can be **paused** to give the machine its RAM back: everything the run started stops and frees its memory,
and **Resume** later carries on from exactly where it stopped. Pause is not Cancel: Cancel stays terminal and
unchanged.

Arc also **regulates RAM** with pause: when the machine's memory is tight, Arc pauses a run by itself; when memory
is free again, Arc resumes it by itself. **Automatic is the primary path; manual Pause / Resume is a fallback.**

## What runs today

- `CancelRunCommand` (`pkg/wshrpc/wshserver/wshserver_runs.go:1093`) is the only way to stop a run. For a dag run it
  calls `orchestrate.Cancel`; `DagStatus_Cancelled` is a terminal override that `RecomputeDagStatus`
  (`pkg/orchestrate/dag.go:348`) never moves. For a run with no dag, `jarvis.CancelRun` skips open phases and
  `stopRunWorkers` stops the worker. There is no pause anywhere in `pkg/orchestrate`.
- Reusable pieces: `jarvis.ResumeRunWorker` reopens an agent in its own session with a nudge (used by
  `ResumeInterruptedLeads`, `pkg/orchestrate/interrupted.go:106`); a worker whose controller is gone is marked
  stalled and retried (`autoRetryStalled`, `pkg/orchestrate/engine.go:274`).
- RAM throttling today: `workerGrant` (`pkg/orchestrate/workerslots.go:106`) holds new workers back while
  `jobqueue.ReadPressure` reads warn or critical; heavy commands wait in `pkg/jobqueue` (estimates in
  `pkg/memgate/memgate.go`). `pkg/memusage` measures each process tree, and the engine samples each worker's tree per
  tick (`memusage.ProcessTree`). Nothing stops work already running to free RAM.

## Decisions

### What pause stops

Pause stops the run's lead and every worker **at once**. Worktrees, commits and sessions are kept. Resume reopens
each agent in its own session, carrying on from where it stopped.

To free the RAM, pause stops every process the run started: the lead, task workers, reviewers, the plan reviewer,
stage sessions, any running Verify / Check / Setup / Final command, and the dev app a Final started itself. Their
job slots go back to `pkg/jobqueue`. A git merge already under way finishes first and then stops: killing git
mid-commit leaves an `index.lock` no later tick gets past (see the comment at `Schedule`, `engine.go:392`).

On resume, agents reopen in their old sessions; a Verify / Check / Setup / Final command that was cut off reruns from
the start.

While a run is paused:
- the watchdog, stall detection and `autoRetryStalled` leave it alone;
- `MarkInterruptedRuns` skips it, so an app restart never marks it interrupted;
- an ask waiting on the person stays open; an answer given while paused is delivered when the agent resumes.

**App restart** (answer 9): when the app restarts, a paused run resumes by itself, as it was before it paused. The
one exception is memory that is already tight at startup. Then the run stays paused, and the regulator resumes it
once memory is free.

Asks (builder question 3, settled by the person's edit): an open ask stays for the life of the wavesrv process.
`LivePendingAsks` (`pkg/jarvis/attention.go:1039`) must not prune, claim or cancel the ask of an agent whose run is
paused. On a restart the in-memory ask is gone. The resume nudge tells the agent to ask again if it was waiting on an
answer. Asks are not persisted.

### Child runs

Agent's call (builder question 1): **only a top-level run can be paused** (`runqueue.TopLevel`,
`pkg/runqueue/rules.go:24`).
- Pausing it also pauses every child run it has: task workers, reviewers, stage sessions, and runs its lead spawned,
  including a child orchestrator run with its own dag, lead and workers.
- Resume reopens them all.
- A single task-worker run or child run cannot be paused on its own. The buttons appear only on a top-level run's
  surfaces.
- The regulator picks only top-level runs: the ones `runqueue.Active` counts.
- Cancelling a child run works as it does today.

### Which runs

Every run: orchestrator runs and quick runs. A quick run's pause stops its one worker and keeps its session.

### The run queue

A paused run still counts as active against `runs:maxactive` (`runqueue.Active`, `pkg/runqueue/rules.go:32`): the
queue does not start a queued run in its place.

### Controls

Pause / Resume are a **fallback**, not primary buttons: they do not sit beside Cancel. They live in the run's own
menu (⋯) on a top-level run's surfaces:
- the run sheet header (`frontend/app/view/jarvis/runsheet.tsx:1221`, where Cancel is today);
- the run card (`frontend/app/view/agents/runcards.tsx`);
- the lead card (`frontend/app/view/agents/leadcard.tsx`);
- the DAG header (`frontend/app/view/orchestrate/daggraph-header.tsx`).

A paused run shows **Paused · resumes when memory frees** in the Agent tree and the run lists, with a small Resume
button beside it, for resuming sooner than the regulator would.

CLI: `wsh runs pause <run>` and `wsh runs resume <run>`.

Agent's call: the labels are English (Pause, Resume, Paused), like the rest of the app's UI. The brainstorm used
Vietnamese names for them.

### RAM regulation: who decides

**A rule loop in wavesrv decides both when and which run**, by progress. It uses no agent and spends no tokens.

- Every few seconds it reads `jobqueue.ReadPressure`.
- **Pausing.** When the pressure stays at warn or critical, it pauses one run, picked in this order:
  1. it never picks a run in its Final stage or mid-merge;
  2. it picks the run with the fewest tasks done;
  3. on a tie, it picks the most recently started run.
- **Resuming.** When the pressure is back at normal long enough, and the free RAM exceeds what the run held when it
  paused plus a margin, it resumes the run paused longest.
- **Scope.** Auto-resume applies to every paused run, however it was paused: by the regulator, by the button, or by
  `wsh runs pause`.
- **Where it does not run.** Where pressure cannot be read (Linux), Arc does not regulate; the manual buttons
  still work.

When the machine is tight for reasons outside Arc's runs (builder question 2), the regulator does not keep pausing
for nothing:
- It never picks a run that holds less than 1 GB.
- If two runs paused back to back have not lowered the pressure, it stops pausing until the pressure is back at
  normal.

At pause time the run records the RAM it held: the sum of the process trees of every agent and command in the run,
measured with `pkg/memusage`.

### Resuming

The regulator resumes paused runs by itself. There is no resume suggestion card. The manual Resume is a fallback,
for resuming sooner than the regulator would.

### What Arc reports

An automatic pause or resume shows only in the run itself:
- its state (**Paused · resumes when memory frees**) in the Agent tree and the run lists;
- a run event recording the action, with the RAM the run held.

There is no Needs you card and no toast: automatic actions need nothing from the person.

## Left to the builder

- **Storing the paused state.** Add a new run status (`paused`) and a matching dag status. `RecomputeDagStatus`, the
  watchdog, stall detection, `autoRetryStalled`, `ResumeInterruptedLeads` and `MarkInterruptedRuns` must all leave
  a paused run alone, while `runqueue.Active` still counts it. A new `waveobj` field needs a regenerate
  (`task generate`). A new registered type needs a migration.
- **Stopping and reopening each harness.** Stop each kind of agent (claude, pi, agy, codex) while keeping its
  session. Reopen it with `jarvis.ResumeRunWorker` and a short nudge saying it was paused and resumed.
- **Job slots.** Hand the job slots of running Verify / Check / Setup / Final commands back to `pkg/jobqueue`, and
  rerun those commands on resume.
- **Thresholds.** These are starting points, to be tuned:
  - pause after the pressure has stayed tight for about one minute;
  - auto-resume after it has stayed normal for about five minutes;
  - a free-RAM margin of 4 GB;
  - pause one run at a time, then wait for a fresh reading before pausing the next.
- **No flapping.** A run that was resumed and then paused again for tight memory does not auto-resume for 30
  minutes. Every resume costs a full re-read of the agent's context, and a lapsed cache makes that a full cache
  write.
- **Settings.** The regulator respects `jobs:mode off` and `jobs:pauseuntil`, as `workerPressure` does
  (`workerslots.go:28`).
- **CHANGELOG.** Add `CHANGELOG.md` lines for Pause / Resume and for RAM regulation.
- **CDP scenario.** Add a scenario in `scripts/cdp/scenarios.mjs` that shows a paused run: the Paused state and the
  small Resume button in the Agent tree and the run list, and Pause in the run sheet's ⋯ menu.

## Builder decisions (2026-11-05, made autonomously by the run's lead)

Each decision below fills something "Left to the builder" or a gap the sections above leave open, with why.

1. **Pause is a record; the status is derived from it.** `waveobj.Run` gains `Pause *RunPause` (paused at, by
   `auto` | `manual` | `boot`, the RAM held, the sessions suspended, the no-flap hold; nil once resumed),
   `LastResumedTs int64` (outlives the record, for the no-flap rule) and
   `PausedUnder string` (the top-level run's id, set on every child run in the paused tree). `waveobj.TaskGroup`
   gains `PausedTs int64`. The top-level run's `Status` reads `paused` (`jarvis.RunStatus_Paused`) while `Pause` is
   set; a dag reads `paused` (`orchestrate.DagStatus_Paused`) while `PausedTs` is set, checked in
   `RecomputeDagStatus`: the status is derived as before, then becomes `paused` unless it is done (cancelled still
   returns first). *Why:* `recomputeStatus` and `RecomputeDagStatus`
   re-derive status from phases and tasks on every write, so a bare status override would be undone by the next
   derive, and Resume needs the record anyway. Done and cancelled still win over paused (a worker that completed in
   the instant before its stop is done), and Cancel on a paused run clears the record.
2. **Child runs keep their own status; only `PausedUnder` marks them.** *Why:* the engine derives task states from
   child runs (`DeriveTaskStates`); a child reading `paused` would need a new task state and a new DAG node look,
   and a child is never paused alone. One helper, `jarvis.RunPaused(run)` (status paused or `PausedUnder` set), is
   the single test every guard uses: the exit hook, stall detection, `autoRetryStalled`, `MarkInterruptedRuns`,
   `ResumeInterruptedLeads`, `cancelOrphanedDagRun` and `LivePendingAsks`.
3. **No migration.** These are new fields on registered types, not a new type: `task generate` only.
4. **A paused agent is suspended, not stopped.** New `jarvis.SuspendRunWorker(ctx, workerORef)` ends the block's
   process tree (destroying its controller) so the RAM is freed, keeps the tab, scrollback and session, and leaves
   the block disarmed so no `ResyncController` restarts it (the durability `StopRunWorker` documents).
   `ResumeRunWorker` re-arms the block's controller before it starts the resume args. One path for all four
   harnesses (claude, pi, agy, codex): each keeps its session on disk, and the resume is `ResumeWorkerArgs` as today.
5. **Mark before stopping; every exit path ignores a paused run.** A pause persists the top-level `Pause` record,
   each child's `PausedUnder` and each dag's `PausedTs` before it stops any process. `HandleRunWorkerExit`,
   `HandleChildOutcome` and `HandleWorkerTabClose` return early when the run is `jarvis.RunPaused` or its dag has
   `PausedTs`. So a suspended quick-run worker does not fail its phase, and a task worker is not read as failed,
   done or gone. The dag check also covers a worker spawned just before the dag lock was taken. A suspended quick
   run whose tab is closed stays paused, and its resume reopens it in a new tab.
6. **Dag pause takes the dag lock, so a merge under way finishes first.** `orchestrate.PauseDag` first cancels a
   running Setup (a new per-dag cancel like `stopDagFinal`: Setup runs under the dag lock and would otherwise hold
   the pause for up to `SetupTimeout`), then takes `withDagMutation`, which waits out a merge (`AutoMergeReady`
   takes the same lock), sets `PausedTs` and marks every run of the dag with `PausedUnder` in the same
   transaction, and after commit stops Verify (`stopDagVerify`) and Final
   (`stopDagFinal`, which kills its command's whole process tree, the dev app `final-verify.mjs` started included),
   releases the dag's worker claim, and suspends the lead, every live task worker, reviewer, plan reviewer and final
   verifier. Their job slots go back as their contexts end. A command cut off by the pause records no result: tips
   stay `verifying`, the final stage stays where it was. `scheduleLocked`, `AutoMergeReady` and `retryCleanupDebt`
   do nothing for a paused dag, and `watchdogStatuses` leaves `paused` out, so the watchdog never ticks it; the
   live-worker cap (`liveDags`) still counts none of its workers, since none run.
7. **Dag resume reopens sessions before it unpauses.** `orchestrate.ResumeDag(ctx, dagID, sessions)` reopens each
   session the caller stored in `Pause.Sessions` with
   `jarvis.ResumeRunWorker` and the resume nudge (in a new tab when its tab was closed, as `resumeInNewTab` does),
   resets each running task's activity baseline to the resume time so stall detection measures silence from the
   resume, clears `PausedTs`, then calls `resumeVerify` and ticks the dag, whose existing path restarts a final stage
   the server lost. *Why:* clearing the pause first would let the next tick see dead controllers and retry the tasks
   in fresh sessions, losing their context.
8. **One package owns a run tree's pause: `pkg/runpause`.** `Pause(ctx, channelId, runId, by string) error`,
   `Resume(ctx, channelId, runId, by string) error`, `ResumeAtBoot(ctx)`, and `HeldBytes(ctx, channelId, runId)
   (uint64, error)` for the regulator. Pause refuses a run that is not `runqueue.TopLevel`, or is done, cancelled
   or already paused; Resume refuses a run that is not paused. It walks the tree (child runs whose `ParentLeadORef`
   is a tab of a run in the tree, recursively, and each run's dag, a child orchestrator's included), measures the
   RAM held, and then works in this order. First it writes the `Pause` record and the `PausedUnder` marks; then it
   pauses each dag with `orchestrate.PauseDag`; then it suspends each non-dag session (a quick run's worker, a lead
   whose run has no dag yet, a child quick run); then it stores the sessions it suspended; and last it appends a `run-paused` /
   `run-resumed` run event carrying `by` and the RAM held. *Why:* wshserver, the CLI and the regulator need the same
   operation, and the regulator cannot import wshserver. The RAM held is each live session block's process tree
   (`orchestrate.BlockTreeBytes`) plus each running plan command's tree, found through `jobobject.LiveJobs()`
   owners of kind run-cmd (`orchestrate.RunCommandBytes`). That second part works on Windows only; elsewhere plan
   commands are not counted.
9. **RPC and CLI.** `PauseRunCommand` / `ResumeRunCommand` (`CommandPauseRunData{ChannelId, RunId}`) call
   `runpause` with by `manual`. `wsh runs pause <run>` and `wsh runs resume <run>` resolve the run the way
   `wsh runs cancel` does.
10. **Asks while paused.** `LivePendingAsks` leaves the ask of a paused run's block alone. An answer given while
    paused is not typed into the dead TUI: `agentask` holds it (a `HoldAnswer` hook jarvis sets, keyed by block
    oref), and the resume nudge carries it ("While you were paused, the person answered your question: …"). The
    nudge always says: if you were waiting on an answer that is not above, ask again. Asks stay in memory.
11. **Boot.** `runpause.ResumeAtBoot` runs after `MarkInterruptedRuns` / `ResumeInterruptedLeads` and before
    `StartWatchdog`: when `jobqueue.ReadPressure` reads warn or critical it leaves every paused run paused for the
    regulator; otherwise it resumes each paused top-level run with by `boot`.
12. **The regulator is `pkg/runregulator`: a pure `Decide` plus a loop.** The loop ticks every 5 s in wavesrv, only
    on darwin and windows (`runtime.GOOS`), and idles while `jobqueue.Off()` (jobs:mode off or jobs:pauseuntil):
    then it neither pauses nor resumes, since the person switched Arc's memory waiting off. "Tight" is warn or
    critical; "normal" is anything else. *Why:* on Windows `PressureFromCommit` never returns normal, only unknown,
    so reading normal literally would never resume there. `Decide` takes the reading, free RAM, the candidate runs,
    the time and its own state, and returns at most one action:
    - **pause** when tight has lasted 60 s, at least 60 s (one fresh reading window) has passed since its last
      pause, and it is not stood down. Candidates: top-level active runs, not paused, not finalizing (dag
      `finalizing`) and not mid-merge, holding at least 1 GB. Mid-merge means a task is `verifying`, or the dag is
      `MergeRequired` and has a `done` task that is not yet `Merged`. A merge itself runs under the dag lock, and a
      pause waits for it anyway. Pick fewest tasks
      done, then most recently created.
    - **stand down** after two back-to-back pauses that did not lower the pressure (critical to warn counts as
      lower), until the pressure is normal again.
    - **resume** when normal has lasted 5 min and free RAM (`mem.VirtualMemory().Available`, as the job queue reads
      it) exceeds the run's held RAM plus 4 GB. Pick the run paused longest whose no-flap hold has passed. After a
      resume the 5-minute clock restarts.
    - **no flapping:** an automatic pause of a run that has been resumed before sets a 30-minute hold, during which
      the regulator does not resume it (manual Resume still does).
    Thresholds are named constants in one place.
13. **Frontend.** The run's own ⋯ menu gets Pause on a top-level active run and Resume on a paused one, on the run
    sheet header, the run card, the lead card and the DAG header, never beside Cancel. The Agent tree's run row and
    the run lists show `Paused · resumes when memory frees` with a small `Resume` button. `runmodel.ts` maps `paused`
    to that label and a `paused` tone drawn from an existing muted token. Actions live in `runactions.ts`
    (`pauseRun`, `resumePausedRun`; `resumeRun` is already the failed-phase resume).
14. **Changelog and docs.** Two `Added` lines (Pause / Resume; RAM regulation). `docs/guide/orchestrator.md` gets a
    short Pause section.
15. **Cancel on a paused run.** `jarvis.CancelRun` clears `Pause` and `PausedUnder`, and `CancelGroup` clears
    `PausedTs`, so a cancelled dag's children no longer read as paused. `CancelRunCommand` also calls
    `runpause.ClearOnCancel`. That clears every mark left under the run, and cancels each lead-spawned child run that
    is not done, because its agents are suspended and nothing would ever resume them.
