# A run's lead that dies is brought back, and a pause does not count against a reviewer — design

Date: 2026-11-12. Trigger: run `ca080f5c` (Chat fork, autonomous) sat 3h50m at plan review, 0/6 tasks, with no
live lead and nothing in the cockpit to press. Initiative: "Orchestrator engine follow-ups" (effort 39803de1),
chunk 29. Complements `2026-11-12-run-self-heal-design.md`, whose decision 1 covers a lead that hangs alive; this one
covers a lead whose process is gone.

## What happened (evidence)

Run events (`db_runevent`, run `ca080f5c`), waveapp.log, and the Claude debug logs of each lead start
(`D:\tmp\claude-watch\debug`, `232bb733…`, `2e8ebf73…`, `85bd97dc…`).

| Time | Event |
|---|---|
| 13:36:29 | run-created from a plan; the dag is submitted at once, so the run has no lead yet (it is launched on the first wake) |
| 13:36:45 | plan review round 1: reviewers `full` and `second` start |
| 13:49:37 | run-paused by the run regulator (RAM) |
| 14:00:59 | run-resumed; both reviewers are judged lost (24 min since start) and respawned (respawns=1) |
| 14:19:54 | run-paused by the regulator, 18m55s into the respawned reviewers |
| 15:33:05 | run-resumed; the same tick judges both reviewers lost again, "no verdict within 20m0s" (92 min of wall time, ~19 min of it running), and fails plan review round 1 |
| 15:33:05 | lead-launched: the first lead, `--session-id 6e6ec281…`, its launch prompt carrying the wake "plan reviewer did not finish … run `wsh jarvis dag submit` again" |
| 15:33–15:44 | the lead's Claude stalls 472 s on its event loop (machine at 100% CPU) and is still in its first turn ("Gitifying… 3m28s") |
| 15:44:27 | run-paused by the regulator: the lead is killed before Claude wrote any transcript (`6e6ec281*.jsonl` exists nowhere under `~/.claude/projects`) |
| 16:17:35 | run-resumed: the lead is reopened with `claude --resume 6e6ec281…`, which prints `No conversation found with session ID` and exits 1 (16:22:18, worker-output) |
| 17:12 | a manual pause and resume: the same `--resume`, the same exit 1 (17:15:48) |

From 16:22 the dag reads `plan review failed round=1, waiting on the lead's revised submit`, `wsh agents list` has no
lead, and nothing relaunches one.

## Root causes

1. **Reviewer timeouts count paused time.** `JudgingSessionLost` (`pkg/orchestrate/stagesession.go:148`) compares
   `now - startedTs` with `ReviewTimeout` (20 min); a task reviewer does the same with `ReviewSpawnedTs`
   (`review.go:183`). `unmarkDagPaused` (`pause.go:315-320`) moves only a running task's `LastActivity`, `AskTs` and
   `ProgressTs` past the pause. So the first tick after a resume finds every plan, task and Final reviewer that was
   alive at the pause "lost". In ca080f5c both rounds of reviewers were lost this way; neither ever ran 20 minutes.
2. **A session with no transcript is resumed anyway.** `ReopenSession` (`pause.go:362`) → `ResumeRunWorker` →
   `ResumeWorkerArgs` (`pkg/jarvis/runexec.go:96`) always builds `--resume <id>`. Claude creates the transcript only
   when it persists the first turn; a session killed before that has an id and nothing behind it, and every resume
   exits 1 at once.
3. **A dag run's lead that exits is not noticed.** `HandleRunWorkerExit` (`outcome.go:214`) returns early for a run with
   a dag, trusting the wake adapter. The adapter checks the lead only in `flushLocked` (`wake.go:359-376`), and only
   when it has a line or an untold question to deliver. A dag that waits on the lead (a resubmit after a failed plan
   review, the run's report after Final) posts nothing, so `leadDiedLocked` never runs, the autonomous relaunch
   (`autoRelaunchLocked`) never fires, and no `lead-wake-failed` row is written.
4. **The person has no way in.** The cockpit offers Relaunch lead only when `isLeadDown` sees a `lead-wake-failed` row
   (`frontend/app/view/agents/leadcardmodel.ts:416`), which cause 3 never writes. The `relaunch-lead` dag action
   (`wshserver_dag.go:619`) works, but no `wsh` command reaches it.
5. **The replacement lead's prompt is wrong for a plan review.** `replacementLeadWake` (`wake.go:571`) tells the new
   lead "the dag is already running, so do not resubmit the plan". A dag waiting on a resubmit needs the opposite.

## Decisions

1. **A pause stops the reviewer clocks.** `unmarkDagPaused` shifts by the paused span (`now - PausedTs`) every clock
   a reviewer's timeout reads: each plan reviewer's `StartedTs`, a reviewing task's `ReviewSpawnedTs`, and the Final
   verifier's `StartedTs` (check while implementing whether any other stage clock is read against a timeout). One helper, `shiftStageClocks(g, span)`, so a new stage clock is added in one
   place. A reviewer lost while paused for another reason (its controller is gone) is still lost.
2. **A reopen with no transcript starts fresh.** Before `--resume`, `ReopenSession` checks the session's transcript
   for a Claude worker (`sessiontrash.ProjectsDirs`, `<id>.jsonl` in any project dir; pi and the other runtimes keep
   their resume as today). With none:
   - the run's lead is launched again with its last launch text (the newest `lead-launched` row's `text`, which is
     what it never got to read), through `startLead`, and the run records the new session (`LeadSessionIds`);
   - a dag task worker is left to the task's existing stalled retry, which starts a fresh worker, and the reason is
     logged as "no transcript to resume".
3. **A dag run's lead exit reaches the waker.** In `HandleRunWorkerExit`, a run with a dag whose exiting worker is the
   running phase's lead tab, not under pause, with the dag not terminal, calls a new `LeadExited(ctx, channelId,
   runId)`. It takes the waker lock and runs `leadDiedLocked(…, leadNotRunningNote)`: the `lead-wake-failed` row is
   written (so the cockpit shows Relaunch lead), an autonomous run relaunches its lead (up to `MaxAutoRelaunches`),
   and the lead's open questions go to the person otherwise. A lead that exits after `wsh jarvis complete` finds the
   dag terminal and is skipped, as now.
4. **The replacement lead is told what the dag waits on.** `replacementLeadWake` reads the dag: waiting on a
   resubmit (plan review failed or lost) → "the plan review did not pass; read `wsh jarvis dag status`, revise if it
   found something, and run `wsh jarvis dag submit` again"; Final failed → the existing Final wording; otherwise the
   current text.
5. **The person can relaunch from the CLI and from the run.** `wsh runs relaunch-lead <run>` calls the `relaunch-lead`
   dag action. The cockpit also treats a run as lead-down when its dag waits on the lead and the lead's tab has no
   live process, so the button shows even if a row was never written. `wsh runs cancel` counts only workers whose
   process runs: `runsLiveWorkers` (`cmd/wsh/cmd/wshcmd-runs.go:1445`) counts every tab of the running phase, so
   ca080f5c's dead lead asked for `--yes` as "1 live worker(s)".

## Tests

- `TestResumeShiftsReviewerClocksByThePause`: pause a dag with a plan reviewer started at T, resume at T+90 min; the
  next `JudgingSessionLost` at T+95 min returns "" (5 min of running); a task in review and a Final verifier likewise.
- `TestReopenWithoutTranscriptRelaunchesTheLead`: a lead session id with no `.jsonl` under a temp
  `CLAUDE_CONFIG_DIR`; `ReopenSession` starts a fresh lead with the newest `lead-launched` text and never builds
  `--resume`. With the file present, it resumes as today.
- `TestDagLeadExitHandsOverToTheWaker`: an autonomous dag run in plan review whose lead tab exits with code 1 gets a
  `lead-wake-failed` row and one `relaunchLeadFn` call; a non-autonomous one gets the row and its asks forwarded; a
  lead exiting after the dag is done changes nothing; one exiting under a pause changes nothing.
- `replacementLeadWake` table test over dag states.
- `isLeadDown` frontend test: a run waiting on its lead with no live lead block is down.

## Out of scope

- Why the regulator paused a run in plan review three times, and the CPU starvation behind the lead's 472 s of stalls
  (Heavy job queue follow-ups, chunk 10 and the wavesrv CPU chunk).
- A lead hung alive (self-heal spec, decision 1).
- Delivering a report a reviewer wrote but could not hand in before its timeout (engine follow-ups, chunk 27).
