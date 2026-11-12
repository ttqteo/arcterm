# Runs heal themselves when a lead or a hook goes quiet — design

Date: 2026-11-12. Trigger: run `1cad2fd0` (Kael sync small fixes) sat 2h30m at 1/6 tasks while its row read
`Working · 1/6`, holding ~5.6 GB, and nothing in it moved until a person paused and resumed it.

## What happened (evidence)

| # | Observed | Where it comes from |
|---|---|---|
| 1 | The lead called `wsh jarvis dag merge t-2 --continue` at 14:40 and the call never returned; no child process was left under it. The engine held every wake from then on (`wake: run … holds its lead's wake: state "working" from PreToolUse`), so t-3's stall and t-4's review timeout reached no one. | `flushLocked` (`pkg/orchestrate/wake.go:378`) holds while the lead is not at its prompt, with no deadline. |
| 2 | t-3's worker asked an AskUserQuestion at 14:06; `wsh jarvis dag asks` said "No questions waiting" and the digest read `stalled · running a command`. Its transcript shows the hooks of that stretch cancelled on timeout (PreToolUse 139 s, UserPromptSubmit 76 s) while wavesrv was slow. | The ask is registered only by the PreToolUse `wsh agent-hook`; a cancelled hook leaves no trace. `agentobserve.AskOpen` (`pkg/agentobserve/derive.go:125`) can read it from the transcript. |
| 3 | Verify `npx vitest run …` failed twice with exit 127 `/bin/bash: C:/nvm4w/nodejs/npx: No such file or directory`. Reproduced: `Git\usr\bin\bash.exe -c 'npx --version'` fails, `Git\bin\bash.exe -c …` passes (the launcher puts `/usr/bin` on PATH, so `#!/usr/bin/env bash` shims resolve). | `findInstalledGitBash` (`pkg/util/shellutil/shellutil.go:168`) takes the first PATH dir with a `git` part that holds `bash.exe`, which can be `Git\usr\bin`. Worked around on this machine with `term:gitbashpath`. |
| 4 | The run row read `Working · 1/6` in the asking tone with three red task segments and no word of what was stuck. RAM showed 1.9 GB (the lead) for ~5.6 GB held. | `dagProgressLabel` (`frontend/app/view/agents/runmodel.ts:43`). The RAM sum is already fixed by 62837edf0 (not in the installed build then). |
| 5 | t-1's worker passed review at 13:30 and stayed alive, idle, holding 1.9 GB, for 2h37m while its merge waited. | `agentsleep` exempts every run-owned agent (`pkg/agentsleep/agentsleep.go:62`). |
| 6 | After pause/resume the lead's `wsh jarvis dag status` failed "no run context for this block". | `ownerRunForBlock` (`pkg/wshrpc/wshserver/wshserver_ctx.go:18`) does not find the resumed lead's tab among the run's phase workers. |
| 7 | `runTick` held the dag lock 5–28 s per pass under memory pressure; `wsh runs list/show` timed out (EC-TIME) on the first try. | `logSlowDagLock` (`pkg/orchestrate/mutation.go:55`) names the caller but not which part of `scheduleLocked` took the time. |
| 8 | After the resume, t-3 read `stalled` while its worker waited on its own background `task check:ts` (tsc running 6+ min). | The stall check's busy signal is the worker tree's CPU (`pkg/orchestrate/liveness.go:336`); the transcript's live background shell is not consulted. |

## Decisions

1. **A held wake has a deadline.** When wakes have been held for `LeadHungAfter` (30 min) and the lead's process
   tree used no CPU over that time, the lead is hung: the engine treats it as `leadDiedLocked` with a "lead hung"
   reason, which relaunches an autonomous run's lead and otherwise hands its questions to the person. A lead running
   a long command uses CPU and is left alone.
2. **A worker's open question is recovered from its transcript.** The liveness pass, for a running or stalled dag task
   with no registered ask, reads the worker transcript with `AskOpen`; an open question is registered as the hook
   would have registered it, so it reaches the lead's `dag asks` and the digest shows `ask:`.
3. **Plan commands run through Git's launcher bash.** A PATH hit in `<git>\usr\bin` resolves to `<git>\bin\bash.exe`
   when that exists. `term:gitbashpath` still wins.
4. **The run row says what is stuck.** A working run with tasks in `stalled`, `verify-failed`, `review-failed`,
   `blocked-merge` or `failed` reads `Working · 1/6 · 3 stuck`; the tooltip names each (`t-2 Verify failed`).
5. **A worker whose task passed review may sleep.** `agentsleep` lets a run-owned worker sleep once its task is
   `done`, `verifying` or `verify-failed`; its session stays resumable. Leads and workers of unfinished tasks stay
   exempt.
6. **A resumed lead keeps its run context.** Root-caused by a test that pauses and resumes a lead and asks
   `JarvisCtx` from the lead's block.
7. **A slow dag lock names its slow phase.** `scheduleLocked` times its phases; the slow-lock log line adds the three
   longest. Re-measure on 2026-11-26 decides what to move out of the lock.
8. **A worker waiting on its own background shell is busy.** The liveness pass counts a live background shell in
   the worker transcript (`agentsleep.BackgroundRunning`) as activity.

## Out of scope

The wavesrv slowness itself (7) beyond measuring it; the run row's RAM (already shipped).
