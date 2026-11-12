# Runs heal themselves when a lead or a hook goes quiet — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Verify:** `node scripts/verify.mjs ./pkg/orchestrate/... ./pkg/util/shellutil/... ./pkg/agentsleep/... ./pkg/agentobserve/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs run-row-stuck`

**Spec:** `docs/superpowers/specs/2026-11-12-run-self-heal-design.md` — read it first: every task below is one of its
eight decisions, and its evidence table says what each fixes.

**Goal:** A run whose lead hangs, whose worker's question was lost by a timed-out hook, or whose Verify shell cannot
run a shim recovers or reaches the person on its own, and its row says what is stuck.

**Architecture:** Go engine changes in `pkg/orchestrate` (wake deadline, ask recovery, background-shell busy, lock
phase timing), one in `pkg/util/shellutil` (launcher bash), one in `pkg/agentsleep` + the sleep loop (done workers
sleep), one in the run-context lookup (resumed lead), and one pure frontend model change (`runmodel.ts`) with a CDP
scenario.

**Tech Stack:** Go (tests with `go test`; on Windows prefix `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"`),
TypeScript + vitest, CDP scenarios in `scripts/cdp/scenarios.mjs`.

Rules for every task: TDD (failing test first), check only the files you touched with gofmt/prettier, never edit
generated files (run `task generate` if you change a wshrpc type), and commit with a pathspec
(`git commit -- <paths>`). No `Co-Authored-By` trailer.

---

### Task 1: Plan commands run through Git's launcher bash
**Depends on:** none

Spec decision 3. `findInstalledGitBash` (`pkg/util/shellutil/shellutil.go:168`) returns the first PATH dir with a
`git` part holding `bash.exe`. When that dir is `<git>\usr\bin`, bash runs without `/usr/bin` on PATH and every
`#!/usr/bin/env bash` shim (npx, npm globals) fails with exit 127.

**Files:**
- Modify: `pkg/util/shellutil/shellutil.go` (`findInstalledGitBash`)
- Test: `pkg/util/shellutil/shellutil_test.go` (create if absent)

**Step 1: Failing test.** Extract a pure helper `gitBashFromPathDir(dir string, exists func(string) bool) string` that
returns the bash to use for one PATH dir: `""` when the dir has no bash; `<git>\bin\bash.exe` when the dir is
`<git>\usr\bin` (case-insensitive, either slash) and that launcher exists; otherwise `<dir>\bash.exe`. Table-test it:
`C:\Program Files\Git\usr\bin` → `C:\Program Files\Git\bin\bash.exe`; the same with the launcher missing → the
`usr\bin\bash.exe`; `C:\Program Files\Git\bin` → itself; a non-git dir is still filtered by the caller.

**Step 2:** run `go test ./pkg/util/shellutil -run 'GitBash'` and see it fail.

**Step 3:** implement the helper and call it from the PATH loop in `findInstalledGitBash`. `term:gitbashpath` still
wins (`FindGitBash`, unchanged).

**Step 4:** the test passes. **Step 5:** commit `fix(shellutil): plan commands run through Git's launcher bash, not usr\bin\bash`.

### Task 2: A held wake has a deadline
**Depends on:** none

Spec decision 1. `flushLocked` (`pkg/orchestrate/wake.go:348-381`) returns early, logging `logHeld`, whenever the lead
is not at its prompt. Nothing ever ends that hold.

**Files:**
- Modify: `pkg/orchestrate/wake.go` (`runWake`, `flushLocked`, `tickWakes`, a new `LeadHungAfter` and note text)
- Test: `pkg/orchestrate/wake_test.go` (use the existing `newFakeLead` helpers and `wakeNow` override)

**Step 1: Failing tests.**
- `TestHeldWakeOnHungLeadHandsOver`: the lead reads `working` from `PreToolUse`, a wake is posted and held; advance
  `wakeNow` past `LeadHungAfter` with the lead's tree CPU idle (make the CPU read a package var, like
  `leadStateFn`, defaulting to the tree sampler `sampleChildTree` in `liveness.go:264`); `tickWakes` must record a
  `RunEventKindLeadWakeFailed` row whose reason names the hang, and go through `leadDiedLocked` (so an autonomous
  run's lead is relaunched via `relaunchLeadFn`, and a non-autonomous run's lead asks move to the person).
- `TestHeldWakeOnBusyLeadWaits`: same, but the lead's tree used CPU in the window: nothing is handed over.
- `TestHeldSinceResetsOnPrompt`: a lead that reaches its prompt gets the wake and the hold clock clears.

**Step 2:** run `go test ./pkg/orchestrate -run 'HeldWake|HeldSince'` and see them fail.

**Step 3:** add `heldSince int64` and the CPU sample at hold start to `runWake`; set them in `flushLocked` the first
time it holds with lines pending, clear them when a wake is sent or the lead revives. In `tickWakes`, for a run with
`heldSince != 0`, if `wakeNow()-heldSince >= LeadHungAfter` (30 min) and the CPU delta is below `IdleCPUShare` of the
window, call `leadDiedLocked(ctx, runId, rw, leadHungNote)`. Check that `relaunchLeadFn` stops the hung process
before it reopens the session (read it; if it does not, close the old controller first). Log one line naming
the hand-over.

**Step 4:** tests pass. **Step 5:** commit `fix(orchestrate): a lead hung in one tool call past 30 min hands its wakes over`.

### Task 3: A worker's open question is recovered from its transcript
**Depends on:** none

Spec decision 2. A worker's ask is registered only by its PreToolUse `wsh agent-hook`; when that hook is cancelled
(wavesrv slow), the question is invisible: `workerAsking` (`pkg/orchestrate/liveness.go:462`) reads false, the digest
says `running a command`, and `dag asks` is empty.

**Files:**
- Modify: `pkg/agentobserve/derive.go` (add `OpenAsk(path) (toolUseId string, questions []baseds.AgentAskQuestion, ok bool, err error)` beside `AskOpen`, reusing `pendingAsk`'s scan)
- Modify: `pkg/orchestrate/liveness.go` and the engine's liveness pass in `pkg/orchestrate/engine.go` (around `:529` and `:588`)
- Modify: `pkg/wshrpc/wshserver/wshserver_ask.go` (wire a recovery hook at startup, as `LaunchLeadHook` is wired)
- Test: `pkg/agentobserve/derive_test.go`, `pkg/orchestrate/liveness_test.go`

**Step 1: Failing tests.**
- `OpenAsk` on a transcript fixture whose last assistant record is an `AskUserQuestion` tool_use with no result
  returns its id and questions (header, options, multiSelect); with a tool_result after it, `ok` is false.
- In orchestrate: a running task whose worker block has no registry entry, and whose transcript (`transcriptForRun`)
  has an open ask, calls `RecoverAskHook(ctx, blockOref, toolUseId, questions)` once (not again on the next tick for
  the same tool_use id), and the task is then treated as asking (not stalled).

**Step 2:** run `go test ./pkg/agentobserve ./pkg/orchestrate -run 'OpenAsk|RecoverAsk'`, see them fail.

**Step 3:** implement. `orchestrate` cannot import wshserver: declare `var RecoverAskHook func(ctx context.Context,
blockOref, toolUseId string, questions []baseds.AgentAskQuestion)` (default no-op) and wire it in wshserver to the
same registration the `AskCommand` handler does for a hook ask (`wshserver_ask.go:29`), including
`forwardChildAsk` so it lands in the lead's queue. Only call it for Claude workers (the runtime whose transcript
`OpenAsk` parses), and only when `agentask.GlobalRegistry.Get` has nothing for the block.

**Step 4:** tests pass. **Step 5:** commit `fix(orchestrate): recover a worker's question its timed-out hook never registered`.

### Task 4: A worker waiting on its own background shell is busy
**Depends on:** Task 3

Spec decision 8. `sampleWorkerCPU` (`pkg/orchestrate/liveness.go:316`) sets `BusyTs` from the worker tree's CPU only.
A Claude worker waiting on a `run_in_background` typecheck reads idle and stalls.

**Files:**
- Modify: `pkg/orchestrate/liveness.go`, the liveness pass in `pkg/orchestrate/engine.go`
- Test: `pkg/orchestrate/liveness_test.go`

**Step 1: Failing test.** A running task whose transcript shows a background shell still running
(`agentsleep.BackgroundRunning(lines)` non-empty, `pkg/agentsleep/background.go:59`) and whose tree CPU is idle is not
marked stalled, and its digest reads busy.

**Step 2:** run the test and see it fail. **Step 3:** read the transcript tail (reuse the reader `agentsleep` uses)
only for a task about to be marked stalled, and treat a live background shell as activity (`BusyTs = now`). Keep the
existing stall bound for a background shell older than `StallThreshold` × 3 so a forgotten watcher still stalls.

**Step 4:** test passes. **Step 5:** commit `fix(orchestrate): a worker waiting on its background shell is not stalled`.

### Task 5: A worker whose task passed review may sleep
**Depends on:** none

Spec decision 5. The sleep loop sets `RunOwned: row.RunId != ""` (`pkg/wshrpc/wshserver/wshserver_agentsleeploop.go:219`)
and `agentsleep` never sleeps a run-owned agent (`pkg/agentsleep/agentsleep.go:62`).

**Files:**
- Modify: `pkg/wshrpc/wshserver/wshserver_agentsleeploop.go` (compute `RunOwned` false for a dag child whose task state
  is `done`, `verifying` or `verify-failed`; a lead and every other state stay owned)
- Test: the sleep loop's test file beside it (find it with `ls pkg/wshrpc/wshserver/*agentsleep*`)

**Step 1: Failing test** for the owned/not-owned decision as a pure function `runOwnedForSleep(taskState string,
isLead bool) bool`. **Step 2:** see it fail. **Step 3:** implement and use it where the row is built; look the task state
up through the run's dag (`wstore.GetDag`) once per loop pass, not per row. **Step 4:** passes. **Step 5:** commit
`fix(agentsleep): a run worker whose task passed review can sleep`.

### Task 6: A resumed lead keeps its run context
**Depends on:** none

Spec decision 6. After `wsh runs pause` / `resume` of run 1cad2fd0, the lead's `wsh jarvis dag status` failed with "no
run context for this block" (`cmd/wsh/cmd/wshcmd-jarvisdag.go:641`). `ownerRunForBlock`
(`pkg/wshrpc/wshserver/wshserver_ctx.go:18`) finds runs by the block's tab in a phase's `WorkerOrefs`
(`GetRunCandidatesByWorker`). The resume goes through `pkg/runpause` and `orchestrate.ReopenSession`
(`pkg/orchestrate/pause.go:362`), which reopens in the same tab or, when the tab is gone, `resumeInNewTab`
(`pkg/orchestrate/interrupted.go:219`).

**Files:** found by the test; likely `pkg/runpause`, `pkg/orchestrate/pause.go` or `interrupted.go`, `wshserver_ctx.go`.

**Step 1: Failing test.** Pause a run with a lead, resume it (both the same-tab and the closed-tab path), then call
`ownerRunForBlock` with the resumed lead's block oref: it must return the run. **Step 2:** see which path fails and
why (write the cause in the commit message). **Step 3:** fix the cause (e.g. record the new tab in the phase's
`WorkerOrefs` and the store's worker index, or stamp the owner on the reopened block). **Step 4:** passes. **Step 5:**
commit `fix(runs): a resumed lead resolves its run context`.

### Task 7: A slow dag lock names its slow phase
**Depends on:** Task 4

Spec decision 7. `logSlowDagLock` (`pkg/orchestrate/mutation.go:55`) prints `held 27.793s, by orchestrate.runTick`.

**Files:**
- Modify: `pkg/orchestrate/engine.go` (`scheduleLocked`), `pkg/orchestrate/mutation.go`
- Test: `pkg/orchestrate/mutation_test.go`

**Step 1: Failing test.** A pure `slowPhases(timings []phaseTiming, n int) string` returns the n longest as
`review 12.1s, liveness 9.8s, merge 3.0s`; and a slow-lock line built with timings carries it after `by …`.
**Step 2:** fail. **Step 3:** time each block of `scheduleLocked` (liveness/CPU sampling, reviews, plan review, base
check, merges, dispatch) into a slice on the tick, pass it to the slow-lock log. No timing when the lock was fast.
**Step 4:** passes. **Step 5:** commit `chore(orchestrate): a slow dag lock names its three longest phases`.

### Task 8: The run row says what is stuck
**Depends on:** none

Spec decision 4. `dagProgressLabel` (`frontend/app/view/agents/runmodel.ts:43`) returns `Working · 1/6` whatever
the tasks' states.

**Files:**
- Modify: `frontend/app/view/agents/runmodel.ts`
- Test: `frontend/app/view/agents/runmodel.test.ts`
- Modify: `scripts/cdp/scenarios.mjs` (new scenario `run-row-stuck`)

**Step 1: Failing tests** in `runmodel.test.ts`: a working run whose dag holds tasks `stalled`, `verify-failed` and
`review-failed` returns text `Working · 1/6 · 3 stuck` and a title listing `t-2 Verify failed · t-3 stalled · t-4
review failed`; `blocked-merge` reads `merge conflict`, `failed` reads `failed`; a run with none stuck is unchanged;
a paused run is unchanged (its label already says paused).

**Step 2:** `npx vitest run frontend/app/view/agents/runmodel.test.ts` fails. **Step 3:** implement in
`dagProgressLabel` only, from `run.dag.tasks[].state` (no new store reads). **Step 4:** passes.

**Step 5: CDP scenario `run-row-stuck`.** Following `docs/reference/cdp-run-fixtures.md` (its arrange, seed and teardown
helpers are already in `scenarios.mjs`), seed a run with a dag of four tasks: one `done`, one `verify-failed`, one
`stalled`, one `pending`. Open the Agent surface, find the run's row in `[data-agent-tree]`, and assert its progress
text contains `· 2 stuck` and its `title` names both tasks. Screenshot the row. Run it against the dev app:
`task verify:ui -- run-row-stuck` (start the dev app first if none runs; if it cannot run, say so in the report).

**Step 6:** commit `feat(agents): a run's row says how many tasks are stuck`.

### Task 9: CHANGELOG, hand checks and open issues
**Depends on:** Task 1, Task 2, Task 3, Task 4, Task 5, Task 6, Task 7, Task 8

**Files:** `CHANGELOG.md`, `docs/hand-checks.md`, `docs/open-issues.md`, `docs/orchestrator-redesign-flaws.md`

- `CHANGELOG.md`, top `## Unreleased` section (open one above a dated top section): under `Fixed`, one line each,
  written for the user: a run whose lead hangs in one command for 30 minutes hands its decisions on instead of waiting
  forever; a worker's question no longer goes missing when arcterm is slow; a plan's Verify that calls `npx` no longer
  fails with exit 127 on Windows; a run worker whose task passed review can sleep and give its memory back; a resumed
  run's lead keeps its run commands working. Under `Changed`: a run's row says how many of its tasks are stuck.
- `docs/hand-checks.md`: `- [ ] (arcterm) …` lines for: remove `term:gitbashpath` from settings and confirm a plan
  Verify with `npx` passes; pause/resume a run and run `wsh jarvis dag status` from its lead with no flags; a run row
  with a stuck task shows `· N stuck` and its tooltip.
- `docs/open-issues.md`: under "RAM watch" note the done-worker sleep; add an `(arcterm)` entry "Re-measure the dag
  lock's slow phases on 2026-11-26" naming the new log line.
- `docs/orchestrator-redesign-flaws.md`: an entry for the held-wake hang (run 1cad2fd0) marked fixed by this run.

Commit `docs: changelog, hand checks and open issues for run self-heal`.
