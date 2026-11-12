# Runs heal themselves when a lead or a hook goes quiet — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Verify:** `node scripts/verify.mjs ./pkg/orchestrate/... ./pkg/util/shellutil/... ./pkg/agentsleep/... ./pkg/agentobserve/... ./pkg/wshrpc/... ./pkg/runpause/... ./cmd/wsh/... ./cmd/server/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs run-row-stuck`

**Spec:** `docs/superpowers/specs/2026-11-12-run-self-heal-design.md` — read it first: every task below is one of its
eight decisions, and its evidence table says what each fixes.

**Goal:** A run whose lead hangs, whose worker's question was lost by a timed-out hook, or whose Verify shell cannot
run a shim recovers or reaches the person on its own, and its row says what is stuck.

**Architecture:** Go engine changes in `pkg/orchestrate` (wake deadline, ask recovery, background-shell busy, lock
phase timing), one in `pkg/util/shellutil` (launcher bash), one in the sleep loop (done workers sleep), one in the
run-context lookup (resumed lead), and one pure frontend model change (`runmodel.ts`) with a CDP scenario.

**Tech Stack:** Go (tests with `go test`; on Windows prefix `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"`),
TypeScript + vitest, CDP scenarios in `scripts/cdp/scenarios.mjs`.

Rules for every task: TDD (failing test first), check only the files you touched with gofmt/prettier, never edit
generated files (run `task generate` if you change a wshrpc type), and commit with a pathspec
(`git commit -- <paths>`). No `Co-Authored-By` trailer. Never start a dev app: Final runs the CDP scenario.

---

### Task 1: Plan commands run through Git's launcher bash
**Depends on:** none

Spec decision 3. `findInstalledGitBash` (`pkg/util/shellutil/shellutil.go:168`) returns the first PATH dir with a
`git` part holding `bash.exe`. When that dir is `<git>\usr\bin`, bash runs without `/usr/bin` on PATH and every
`#!/usr/bin/env bash` shim (npx, npm globals) fails with exit 127.

**Files:**
- Modify: `pkg/util/shellutil/shellutil.go` (`findInstalledGitBash`)
- Test: `pkg/util/shellutil/shellutil_windows_test.go` (new; Windows-only, since the paths and the live check are)

**Step 1: Failing tests.**
- Extract a pure helper `gitBashFromPathDir(dir string, exists func(string) bool) string` that returns the bash to use
  for one PATH dir: `""` when the dir has no bash; `<git>\bin\bash.exe` when the dir is `<git>\usr\bin`
  (case-insensitive, either slash) and that launcher exists; otherwise `<dir>\bash.exe`. Table-test it:
  `C:\Program Files\Git\usr\bin` → `C:\Program Files\Git\bin\bash.exe`; the same with the launcher missing → the
  `usr\bin\bash.exe`; `C:\Program Files\Git\bin` → itself; a dir with no bash → `""`.
- `TestInstalledGitBashRunsShims`: resolve the bash the way plan commands do (`FindGitBash` with no
  `term:gitbashpath`), and run it with `-c 'npx --version'`; it must exit 0. `t.Skip` when no Git for Windows or no
  `npx` on PATH is found. This replaces the hand check.

**Step 2:** run `go test ./pkg/util/shellutil -run 'GitBash'` and see the table test fail.

**Step 3:** implement the helper and call it from the PATH loop in `findInstalledGitBash`. `term:gitbashpath` still
wins (`FindGitBash`, unchanged).

**Step 4:** the tests pass. **Step 5:** commit `fix(shellutil): plan commands run through Git's launcher bash, not usr\bin\bash`.

### Task 2: A held wake has a deadline
**Depends on:** none

Spec decision 1. `flushLocked` (`pkg/orchestrate/wake.go:348-404`) returns early, logging `logHeld`, whenever the lead
is not at its prompt or is asking. Nothing ever ends that hold. A hung lead is still alive, so handing over through
`leadDiedLocked` alone does nothing: `RelaunchLead` (`wake.go:520-525`) revives a live lead (`reviveLive` →
`flushLocked`), which holds again. The hung process must be stopped first.

**Files:**
- Modify: `pkg/orchestrate/wake.go` (`runWake`, `flushLocked`, `tickWakes`, `reviveLocked`, a new `LeadHungAfter`,
  `leadHungNote` and a `stopLeadFn` var defaulting to `blockcontroller.DestroyBlockController`)
- Test: `pkg/orchestrate/wake_test.go` (reuse the fixtures of `TestRelaunchLeadReplacesTheStaleTabOref` /
  `TestLeadDiedRelaunchesAnAutonomousLead`, `leadStateFn` and the `wakeNow` override)

**Step 1: Failing tests.**
- `TestHungLeadIsStoppedAndReplaced`: an autonomous run with a submitted dag; the lead reads `working` from
  `PreToolUse`, a wake is posted and held. Script `childTreeSample` (`liveness.go:259`, already a var) to return the
  same `CPUMs` at hold start and at the deadline; advance `wakeNow` past `LeadHungAfter`; `tickWakes` must call
  `stopLeadFn` with the lead's block id, record a `RunEventKindLeadWakeFailed` row whose reason is `leadHungNote`, and
  go through the **real** `RelaunchLead` (leave `relaunchLeadFn` as is; script `leadStateFn` to read not alive once
  `stopLeadFn` has run, and stub `LaunchLeadHook` to record): a replacement lead is started, not the old one revived.
- `TestHungLeadNonAutonomousHandsQuestionsToThePerson`: same with a non-autonomous run: the lead is stopped and its
  questions are forwarded to the person (`forwardAskToUser`).
- `TestHeldWakeOnBusyLeadWaits`: the lead's tree CPU grew by more than `IdleCPUShare` of the window: nothing is
  stopped or handed over, and the hold clock restarts (a second check comes one `LeadHungAfter` later).
- `TestHeldWakeWhileAskingNeverHangs`: the lead is held because it is asking (`leadAsking`), past `LeadHungAfter`
  with idle CPU: nothing is stopped.
- `TestHeldSinceResetsOnPrompt`: a lead that reaches its prompt gets the wake and the hold clock clears.

**Step 2:** run `go test ./pkg/orchestrate -run 'HungLead|HeldWake|HeldSince'` and see them fail.

**Step 3:** add `heldSince int64` and `heldCPUMs int64` to `runWake`. In `flushLocked`, when it holds because the lead
is not at its prompt and **not** asking, with something to deliver, set them the first time (CPU from
`childTreeSample(st.BlockId)`); when it holds for asking, clear them; clear them when a wake is sent and in
`reviveLocked`. In `tickWakes`, for a run with `heldSince != 0` and `wakeNow()-heldSince >= LeadHungAfter` (30 min):
sample the tree again; no reading → clear the clock (the next flush restarts it; a gone process is the not-alive path);
a CPU delta at or above `IdleCPUShare` of the window → busy: restart the clock at now with the new CPU; otherwise
hung: log one line naming the hand-over, call `stopLeadFn(blockId)` (the tab stays for the person to read), then
`leadDiedLocked(ctx, runId, rw, leadHungNote)`. `stopLeadFn` runs under the waker lock only if it does not block on a
dead process; if `DestroyBlockController` can block, run it and the hand-over on a `goStage` goroutine that retakes
the lock, as `autoRelaunchLocked` does.

**Step 4:** tests pass. **Step 5:** commit `fix(orchestrate): a lead hung in one tool call past 30 min is stopped and replaced`.

### Task 3: A worker's open question is recovered from its transcript
**Depends on:** none

Spec decision 2. A worker's ask is registered only by its PreToolUse `wsh agent-hook`; when that hook is cancelled
(wavesrv slow), the question is invisible: `workerAsking` (`pkg/orchestrate/liveness.go:462`) reads false, the digest
says `running a command`, and `dag asks` is empty.

**Files:**
- Modify: `pkg/agentobserve/derive.go` (add `Input json.RawMessage` to `contentBlock` and `OpenAsk(path)
  (toolUseId string, questions []baseds.AgentAskQuestion, ok bool, err error)` beside `AskOpen`)
- Modify: `pkg/orchestrate/liveness.go` and the liveness pass in `pkg/orchestrate/engine.go` (`scheduleLocked`,
  around `:529` and `:588`)
- Modify: `pkg/wshrpc/wshserver/wshserver_ask.go` (the recovery function the hook points at)
- Modify: `cmd/server/main-server.go` (wire `orchestrate.RecoverAskHook` beside `LaunchLeadHook`, `:633`)
- Test: `pkg/agentobserve/derive_test.go`, `pkg/orchestrate/liveness_test.go`, the digest's test file in
  `pkg/orchestrate` (find it with `grep -ln "running a command" pkg/orchestrate/*_test.go`)

**Step 1: Failing tests.**
- `OpenAsk` on a transcript fixture whose last assistant record is an `AskUserQuestion` tool_use with no result
  returns its id and questions, decoded from the tool_use `input` (`questions[].question`, `header`, `options[].label`
  and `description`, `multiSelect`); with a tool_result after it, `ok` is false.
- In orchestrate: a running task that is a stall candidate (quiet past `StallThreshold`, tree CPU idle), whose worker
  block has no registry entry and whose transcript (`transcriptForRun`) has an open ask, is not marked stalled, and
  `RecoverAskHook(ctx, blockOref, toolUseId, questions)` is called once, after the dag commit; the next tick with the
  same tool_use id does not call it again. A task that is not a stall candidate never has its transcript read
  (count reads through a scripted reader var).
- The digest line of a task whose ask was recovered (registry entry present) reads `ask:` with the question, as for a
  hook-registered ask (decision 2's acceptance).

**Step 2:** run `go test ./pkg/agentobserve ./pkg/orchestrate -run 'OpenAsk|RecoverAsk|Digest'`, see them fail.

**Step 3:** implement. `OpenAsk` reuses `pendingAsk`'s scan and keeps the open tool_use's input. In the liveness pass,
only for a Claude worker's stall candidate with nothing in `agentask.GlobalRegistry.Get` for its block, read the
transcript (`ReadTail` reads the whole file, so this gate is what keeps it off every tick), and when an ask is open
treat the task as asking on this tick and append the `RecoverAskHook` call to `afterCommit`, so the registration runs
outside the dag lock. The once-per-tool_use dedupe is an in-memory map in `pkg/orchestrate` keyed by block oref, holding
the last recovered tool_use id (no `TaskNode` field, so no `task generate`). `orchestrate` cannot import wshserver:
declare `var RecoverAskHook func(ctx context.Context, blockOref, toolUseId string, questions
[]baseds.AgentAskQuestion)` (default no-op), implement it in `wshserver_ask.go` with the same registration the
`AskCommand` handler does for a hook ask (`wshserver_ask.go:29`), including `forwardChildAsk` so it lands in the lead's
queue, and wire it in `cmd/server/main-server.go` next to `LaunchLeadHook`.

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
marked stalled, and its digest reads busy; one whose background shell started more than `StallThreshold` × 3 ago
still stalls.

**Step 2:** run the test and see it fail. **Step 3:** use the same gated transcript read Task 3 added (one read per
stall candidate, shared by both checks), and treat a live background shell as activity (`BusyTs = now`). Keep the
stall bound for a background shell older than `StallThreshold` × 3 so a forgotten watcher still stalls.

**Step 4:** test passes. **Step 5:** commit `fix(orchestrate): a worker waiting on its background shell is not stalled`.

### Task 5: A worker whose task passed review may sleep
**Depends on:** none

Spec decision 5, the automatic sleep loop only. The sleep loop sets `RunOwned: row.RunId != ""`
(`pkg/wshrpc/wshserver/wshserver_agentsleeploop.go:219`) and never sleeps a run-owned agent (`:235`). A person's Sleep
(`sleepRefusal`, `wshserver_agentsleep.go:198`) keeps refusing every run agent: not in scope.

**Files:**
- Modify: `pkg/wshrpc/wshserver/wshserver_agentsleeploop.go` (compute `RunOwned` false for a dag child whose task state
  is `done`, `verifying` or `verify-failed`; a lead and every other state stay owned)
- Test: the sleep loop's test file beside it (find it with `ls pkg/wshrpc/wshserver/*agentsleep*`)

**Step 1: Failing tests.**
- The owned/not-owned decision as a pure function `runOwnedForSleep(taskState string, isLead bool) bool`, table-tested.
- Resumable: a dag child in state `done` that the loop sleeps keeps what a person's wake needs to resume it: drive the
  loop's decision and `sleepAgent` with a fake row the way the existing loop tests do, and assert the slept row records
  its session/transcript path (as for a non-run agent) so `wakeAgent` (`wshserver_agentsleep.go:363`, behind
  `AgentsWakeCommand`) reopens the same conversation rather than a fresh one.

**Step 2:** see them fail. **Step 3:** implement and use it where the row is built; look the task state up through the
run's dag (`wstore.GetDag`) once per loop pass, not per row. **Step 4:** passes. **Step 5:** commit
`fix(agentsleep): a run worker whose task passed review can sleep`.

### Task 6: A resumed lead keeps its run context
**Depends on:** Task 2

Spec decision 6. After `wsh runs pause` / `resume` of run 1cad2fd0, the lead's `wsh jarvis dag status` failed with "no
run context for this block" (`cmd/wsh/cmd/wshcmd-jarvisdag.go:641`). `ownerRunForBlock`
(`pkg/wshrpc/wshserver/wshserver_ctx.go:18`) finds runs by the block's tab in a phase's `WorkerOrefs`
(`GetRunCandidatesByWorker`). The resume goes through `pkg/runpause` and `orchestrate.ReopenSession`
(`pkg/orchestrate/pause.go:362`), which reopens in the same tab or, when the tab is gone, `resumeInNewTab`
(`pkg/orchestrate/interrupted.go:219`). `clearLeadTab` (`pkg/orchestrate/wake.go:582`) also drops a lead's tab oref.

**Files:**
- Modify (the one the test shows is at fault): `pkg/runpause/*.go`, `pkg/orchestrate/pause.go`,
  `pkg/orchestrate/interrupted.go`, `pkg/orchestrate/wake.go` (`clearLeadTab`), `pkg/wshrpc/wshserver/wshserver_ctx.go`
- Test: `pkg/runpause/runpause_test.go` (its `tabOf` / lead fixtures, `:247-266`) and, if the lookup is at fault,
  a test beside `wshserver_ctx.go`

**Step 1: Failing test.** Pause a run with a lead, resume it (both the same-tab and the closed-tab path), then call
`ownerRunForBlock` with the resumed lead's block oref: it must return the run. This test is the pause/resume
acceptance check; there is no hand check for it. **Step 2:** see which path fails and why (write the cause in the
commit message). **Step 3:** fix the cause (e.g. record the new tab in the phase's `WorkerOrefs` and the store's worker
index, or stamp the owner on the reopened block). **Step 4:** passes. **Step 5:** commit
`fix(runs): a resumed lead resolves its run context`.

### Task 7: A slow dag lock names its slow phase
**Depends on:** Task 4

Spec decision 7. `logSlowDagLock` (`pkg/orchestrate/mutation.go:51`) prints `held 27.793s, by orchestrate.runTick`. It
is called from `WithDagMutation` / `TryWithDagMutation`, which cannot see `scheduleLocked`'s timings.

**Files:**
- Modify: `pkg/orchestrate/engine.go` (`scheduleLocked`), `pkg/orchestrate/mutation.go`
- Test: `pkg/orchestrate/mutation_test.go` (update `TestSlowLockLogNamesItsCaller`, `:1187-1194`, to the new signature)

**Step 1: Failing test.** A pure `slowPhases(timings []phaseTiming, n int) string` returns the n longest as
`review 12.1s, liveness 9.8s, merge 3.0s`; a slow-lock line logged with timings carries them after `by …`; a fast
lock logs nothing and a slow one with no timings reads as today.
**Step 2:** fail. **Step 3:** how the timings travel: a per-dag recorder in `mutation.go` (`lockPhases`, a map keyed by
dag id holding the current holder's `[]phaseTiming`, written only while that dag's lock is held, so it needs no lock
of its own beyond the map's mutex). `scheduleLocked` records each block (liveness/CPU sampling, reviews, plan review,
base check, merges, dispatch) into it; `WithDagMutation` / `TryWithDagMutation` take and clear the entry after `fn`
returns and pass it to `logSlowDagLock(dagID, wait, hold, phases)`. Recording is a `time.Now()` pair per block; the
string is built only when the lock was slow.
**Step 4:** passes. **Step 5:** commit `chore(orchestrate): a slow dag lock names its three longest phases`.

### Task 8: The run row says what is stuck
**Depends on:** none

Spec decision 4. `dagProgressLabel` (`frontend/app/view/agents/runmodel.ts:43`) returns `Working · 1/6` whatever
the tasks' states.

**Files:**
- Modify: `frontend/app/view/agents/runmodel.ts`
- Modify: `frontend/app/view/agents/sessionsruns.ts` (export `FAILED_TEXT`, `:115`, so both read the same words)
- Test: `frontend/app/view/agents/runmodel.test.ts`
- Modify: `scripts/cdp/scenarios.mjs` (new scenario `run-row-stuck`)

**Step 1: Failing tests** in `runmodel.test.ts`: a working run whose dag holds tasks `stalled`, `verify-failed` and
`review-failed` returns text `Working · 1/6 · 3 stuck` and a title naming each in `FAILED_TEXT`'s words, in task order:
`t-2 verify failed · t-3 stalled · t-4 review failed`; `blocked-merge` reads `merge blocked`, `failed` reads
`failed`; a run with none stuck is unchanged; a paused run is unchanged (its label already says paused).

**Step 2:** `npx vitest run frontend/app/view/agents/runmodel.test.ts` fails. **Step 3:** implement in
`dagProgressLabel` only, from `run.dag.tasks[].state` and `FAILED_TEXT` (no new store reads). **Step 4:** passes.

**Step 5: CDP scenario `run-row-stuck`** (Final runs it; do not start a dev app). Model it on `run-paused`
(`scenarios.mjs:20826`): `arrangeFixtureRun` (`:15537`) with a roster fixture for the lead, so the run has a row in the
Agent tree, then write its dag's task states the way `seedFinalShots` (`:22621`, through `seedDag`, `:22602`) writes a
dag: four tasks, one `done`, one `verify-failed`, one `stalled`, one `pending`. Open the Agent surface, find the run's
row in `[data-agent-tree]`, assert its progress text contains `· 2 stuck` and its `title` names both tasks, and
screenshot the row. Tear down with `teardownFixtureRun` as `run-paused` does. Check it parses with
`node --check scripts/cdp/scenarios.mjs`.

**Step 6:** commit `feat(agents): a run's row says how many tasks are stuck`.

### Task 9: CHANGELOG and open issues
**Depends on:** Task 1, Task 2, Task 3, Task 4, Task 5, Task 6, Task 7, Task 8

**Files:** `CHANGELOG.md`, `docs/open-issues.md`, `docs/orchestrator-redesign-flaws.md`

- `CHANGELOG.md`, top `## Unreleased` section (open one above a dated top section): under `Fixed`, one line each,
  written for the user: a run whose lead hangs in one command for 30 minutes is restarted (or hands its decisions to
  you) instead of waiting forever; a worker's question no longer goes missing when arcterm is slow; a plan's Verify
  that calls `npx` no longer fails with exit 127 on Windows; a run worker whose task passed review can sleep and give
  its memory back; a resumed run's lead keeps its run commands working. Under `Changed`: a run's row says how many of
  its tasks are stuck.
- No hand checks: Task 1's live bash test, Task 6's pause/resume test and Final's `run-row-stuck` cover them.
- `docs/open-issues.md`: under "RAM watch" note the done-worker sleep; add an `(arcterm)` entry "Re-measure the dag
  lock's slow phases on 2026-11-26" naming the new log line and saying the due-dated initiative chunk carries it.
  The lead adds that chunk at wrap-up (`wsh effort chunk add <effort> "Re-measure: dag lock phases" --due 2026-11-26`),
  since this run names no effort and choosing one is the lead's call.
- `docs/orchestrator-redesign-flaws.md`: an entry for the held-wake hang (run 1cad2fd0) marked fixed by this run.

Commit `docs: changelog and open issues for run self-heal`.
