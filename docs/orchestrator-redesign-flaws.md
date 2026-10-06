# Orchestrator redesign — observed flaws tracker

> Living tracker captured 2026-08-16 during the first live DAG run of the "check Evidence snapshot in
> channel run, how do we improve it" goal (lead run `e6ed1a8d`, DAG `dd172828`, engine parallelism 2).
> Every flaw below was observed first-hand in that run, with evidence. The redesign
> (this tracker) closes these rows; resolved rows keep only their
> summary line.
> A second capture (2026-09-04, a 13-task plan executed end to end) adds F11-F17 below; the
> capture-1 sections keep their original scope.
> A code review the same day, after the Claude-lead change (eda08f24), adds F18-F21. Those rows
> were read from source, not observed in a run, and the evidence column says so.

## Capture 1 — first live DAG run (2026-08-16)

### The failure story in one paragraph

The engine spawns headless children that run the full superpowers workflow, including human gates
(brainstorming design-approval, `ask_user_question`). The ask bridge projects the question onto the
child's own session card in the cockpit, where the user never looks, and the lead receives no event, no
notification, and has no command to list or answer it. Meanwhile nothing watches the children: a
provider hang sits "running" for 40+ minutes, the 30-minute ask timeout expires into a frozen child,
and `dag status` reports both as healthy. The lead's only unblock was a hand-written raw socket RPC
client. Current DAG state at capture time: both children frozen, tasks still `running`.

### Flaw table

| #  | Flaw                                                         | Evidence (this session)                                                        | Impact                                   | Status |
| -- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------- | ------ |
| F1 | Child asks invisible to lead, unreachable for user           | t-ev-3 (`b63e97ef`) raised `ask_user_question` 14:20:52; parked 40+ min; card projects only on the child session; user could not find it; lead got no event/CLI/notification | silent whole-DAG deadlock                | ✅ Resolved 2026-08-16 |
| F2 | Lead has no channel into children                            | `wsh jarvis` has no ask list/answer/steer; `AnswerAgentCommand` exists only as an RPC (`pkg/wshrpc/wshclient/wshclient.go:38`); had to write a raw socket client to answer | lead cannot resolve the deadlock         | ✅ Resolved 2026-08-16 |
| F3 | No watchdog for stalled children                             | t-ev-1 (`03e4a16f`) last session write 14:22:17 (model call to deepseek-v4-flash never returned); `dag status` still `running` at 15:01; no alert in 40 min | DAG sits dead indefinitely, progress lies | ✅ Resolved 2026-08-16 |
| F4 | Silent 30-min ask expiry with no recovery                    | `askWaitTimeout` 30m (`cmd/wsh/cmd/wshcmd-ask.go`); t-ev-3's ask expired ~14:50:52; child stayed frozen (session file unchanged 15:01) | the safety valve does not resume work     | ✅ Resolved 2026-08-16 |
| F5 | `dag status` lacks per-task health                           | status JSON has only `state` + `runid`; no age / last-activity / ask indicator; stalled and working tasks look identical | lead cannot triage without forbidden transcript reads | ✅ Resolved 2026-08-16 |
| F6 | Plan pins never reach children                               | `ImportPitasks` (`pkg/orchestrate/import.go:12`) maps only Subject→label, drops Description; t-ev-3 asked a question the plan had already answered in the description | children re-litigate decided questions    | ✅ Resolved 2026-08-16 |
| F7 | Children run a human-gated workflow headless                 | t-ev-1 followed the brainstorming skill ("present a short design and get approval", 14:22:17) — a gate with no human on the other end | deadlock-by-design for any judgment call | ✅ Resolved 2026-08-16 |
| F8 | Lead run context not injected                                | `wsh jarvis dag status -b <block>` → `run "" not found`; `--channel/--runid` had to be dug out of `waveterm.db` by hand (sqlite) | ~2 min DB archaeology per lead session    | ✅ Resolved 2026-08-16 |
| F9 | Plan tooling fights the lead                                 | pi-tasks extension quality gate rejected `task_plan` 5× (multi-action steps, multi-output expectedOutputs, allowedActions > 3); the engine file store `.pi/tasks/tasks.json` has no gate and imported clean on the first write | minutes of churn; wrong tool for the destination | ✅ Resolved 2026-08-16 |
| F10 | No template/init for the DAG store                           | `.pi/tasks` schema rediscovered from `pkg/pitasks` source (`pitasks.go` Read/Parse); no example or scaffold command | every lead re-learns the schema; wiring errors possible | ✅ Resolved 2026-08-16 |

### Derived redesign requirements

The redesign must provide (one per flaw cluster):

- **R1 (F1/F2):** child asks → `child_ask` control event to the lead + card rendered on the parent run
  surface + `wsh jarvis ask list` / `wsh jarvis ask answer <task> <option|text>` (wrapping the existing
  `answeragent` RPC).
- **R2 (F3):** per-task last-activity tracking; after 15 min of silence the engine emits
  `child_stalled` to the lead and flags the task `stalled` in status.
- **R3 (F4):** ask expiry must resume the child (decline semantics, "proceed with best judgment"), not
  leave it frozen.
- **R4 (F5):** `dag status` per-task: `state ∈ pending/running/stalled/ask/done` + age + ask summary.
- **R5 (F6):** `ImportPitasks` passes the task description into the child goal/prompt so plan-pinned
  decisions reach the child.
- **R6 (F7):** child contract: the plan is the authority for what it pinned; children do not re-plan or
  pause for design approval (that is the lead's job). Genuinely unpinned, consequential decisions are
  ASKED — the ask forwards to the orchestrator lead, who decides or escalates to the human; the child
  waits on the answer rather than guessing.
- **R7 (F8):** engine injects run context (`WAVE_RUN_ID` / `WAVE_CHANNEL_ID`, or `wsh jarvis ctx`).
- **R8 (F9/F10):** document the `.pi/tasks/tasks.json` format + ship a scaffold (`wsh jarvis dag init`
  or `docs/orchestrator/tasks.example.json`); lead writes the store directly, skipping the extension
  quality gate.

## Capture 2 — executing a 13-task plan (2026-09-04)

> Second live capture, evidence in `git show a4b5bd4f:docs/jarvis-orchestrator-plan-e2e.md`: lead run
> `e4a54512`, DAG `f2347178`, `mode=orchestrator runtime=pi model=openai-codex/gpt-5.6-sol`,
> project `.claude/worktrees/git-compare-viewer-parity`, engine parallelism 2. Plan under execution:
> `git show edf0132b:docs/superpowers/plans/2026-09-04-git-compare-viewer-parity.md` (13 numbered tasks).

The engine itself worked: it validated the DAG, spawned children into managed worktrees, drained them
against the parallelism cap, derived state from child runs, and stopped correctly at the merge gate.
Everything that went wrong sat around it. The route picker's first offer was a route the account
cannot run, and the lead died on its first API call in a way indistinguishable from thinking for 15
minutes. Re-launched, the lead spent ~10 minutes planning and produced 13 task records, which
`import-tasks` rejected outright at 8. Asked how to proceed, the lead recommended splitting into two
DAG phases — a shape this build cannot execute, because a run links exactly one `TaskGroup` for its
lifetime, a constraint stated nowhere. It compressed 13 → 8 instead and the DAG ran. State at capture
and still true at review time: 4 of 8 tasks done, four child branches unmerged, project HEAD still at
the base commit, digest `health: "healthy"`, nothing advancing.

### Flaw table

| #  | Flaw                                                    | Evidence (2026-09-04 run)                                                      | Impact                                   | Status |
| -- | ------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- | ------ |
| F11 | `MaxTasks = 8` has no path for a larger plan           | 13-task plan; `wsh jarvis dag import-tasks` → `Error: no more than 8 tasks are allowed` (`pkg/orchestrate/dag.go:137`) after the lead had already spent ~10 min producing 13 pi-tasks records. `MaxTasks` (`dag.go:39`) is referenced from that one call site and asserted by no test | plan rejected *after* the planning cost; only workaround is lossy compression | ✅ Closed 2026-09-16 (`1e4bb179`) |
| F12 | One run holds exactly one DAG, stated nowhere           | `wstore.CreateDagForRun` (`pkg/wstore/wstore_dag.go:88`) returns the *existing* dag whenever `run.DagORef != ""`; `DagSubmitCommand` fails a differing proposal with `dag conflict: run %s already linked to a different dag` (`wshserver_dag.go:91`). The lead's own recommended escalation answer — "two DAG phases, import 9–13 after the first integrates" — would have hard-failed at the second import, stranding tasks 9–13. Nothing in the prompt, CLI help, or error text says so | lead confidently recommends a dead-end shape; a human taking it discovers it eight tasks later | ✅ Resolved 2026-09-04 |
| F13 | No first-token deadline: a dead lead looks like a thinking one | First launch pinned `openai-codex/gpt-5.3-codex-spark`; lead died on its first API call (`the 'gpt-5.3-codex-spark' model is not supported when using Codex with a ChatGPT account`) with a 4-line transcript, while the run read `executing / orchestrate:running`. Liveness is transcript-mtime only (`pkg/orchestrate/liveness.go:25`, `StallThreshold` 15 min), so dying *before* writing is indistinguishable from thinking | 15 min to notice a launch that failed in seconds | ✅ Resolved 2026-09-04 |
| F14 | Route picker offers routes the account cannot run       | `openai-codex/gpt-5.3-codex-spark` listed, selectable, rejected by the provider; the `pi` **tier** routes resolve to a bare `deepseek-v4-pro`, which pi rejects as "ambiguous across providers". `ListHarnessesCommand` reports capability, not entitlement | the picker's first option is a guaranteed dead run | open |
| F15 | `import-tasks` hardcodes `parallelism: 2`               | `cmd/wsh/cmd/wshcmd-jarvisdag.go:82` sends `Parallelism: 2` with no flag; `DagSubmitCommand` accepts up to `MaxParallelism = 8` (`dag.go:40`). This DAG had 4 independent backend tasks (t-1..t-4) draining two at a time — digest `next.kind = parallelism-wait` while t-1/t-4 were ready | ~2× wall clock on wide DAGs; only the CLI path pins it | ✅ Resolved 2026-09-04 |
| F16 | Merge gate has no liveness and no age                   | 4 done / 4 worktrees on `wave/e4a54512-…-t-1..t-4`; digest `health: "healthy"`, 0 stalled, 0 attention, `next.kind = merge-ready`, `actions: ["resolve-merge"]`. `StallThreshold` covers only *running* children, so nothing ages the gate. Confirmed still parked at review time: project worktree still at `fcfca8da`, four child branches unmerged | a lead that died or drifted strands finished work indefinitely while health reads clean | ✅ Resolved 2026-09-04 |
| F17 | `runtime` silently selects between two different orchestrators | `BuildOrchestratePrompt` (`pkg/jarvis/run.go:353`) forks: `pi` → create pi-tasks + `dag import-tasks`, engine schedules (the only path producing a `TaskGroup`); `claude`/`codex` → "execute it adaptively by dispatching your own subagents" — no TaskGroup, no managed worktrees, `pkg/orchestrate` never runs. Nothing in the composer says which one a route buys | same UI, two execution models; every DAG affordance silently absent on one of them | ✅ Closed 2026-09-16 (`1e4bb179`, `e9e480b3`) |

*Also observed, outside the seven:* `.waveterm/worktrees/34571345-…-t-3` and `-t-4` sit in the main
checkout on disk but are absent from `git worktree list` — orphans leaked by an earlier DAG. Worktree
cleanup debt is already real, not just a risk at the merge gate.

### Derived requirements

- **R9 (F11/F12):** a plan larger than one DAG needs *a* path. Either raise `MaxTasks` (one call site,
  no test pins it) or make the import failure state the real constraint — "one run holds one DAG for
  its lifetime; compress, or split into a second run" — so the lead cannot recommend a shape the
  engine refuses. Whichever, the one-DAG-per-run rule belongs in the lead's prompt and the CLI help.
- **R10 (F13/F16):** these are one root cause — *nothing watches the lead itself*. `StallThreshold`
  only covers running children, so both a lead that dies before its first token and one that dies at
  the merge gate read as healthy. Needs a spawn/first-token deadline at launch and an age on the merge
  gate. Note the fix is **not** health precedence: `next.kind = merge-ready` already reports the state
  correctly, there is just no signal that nobody is acting on it.
- **R11 (F14):** the route list must reflect entitlement, not just capability — either probe at
  `CreateRunCommand` (which already resolves the route before persisting,
  `wshserver_runs.go:282`) or mark unusable routes in the picker.
- **R12 (F15):** `import-tasks --parallelism`, defaulting to the DAG's ready-width capped at
  `MaxParallelism`, instead of a literal 2.
- **R13 (F17):** the composer must say which orchestrator a runtime buys (engine-managed DAG vs.
  adaptive self-dispatch), or the shape choice must stop depending on the route.

> **F11–F17 are mirrored into `docs/open-issues.md` §2 as of 2026-09-04**, re-verified against the
> code. They had lived only here since Capture 2, which is why the consolidated backlog read as
> though orchestration were closed. File new rows in both places.

### Resolution — 2026-09-04

Four of the seven shipped the same day. Recorded with what each fix did **not** take, so a later
reader does not assume more coverage than exists.

- **F12 (R9, second branch) — resolved.** The one-dag-per-run rule is now stated in all three places
  a lead meets it: the prompt (`run.go:416`, already there since `eda08f24` — the earlier note that
  it was "unstated in the prompt" was wrong), both submit paths' `--help` via `dagOneDagPerRunNote`,
  and both error texts (the task-ceiling error in `dag.go`, the `dag conflict` error in
  `wshserver_dag.go`). Each message now carries the constraint that decides what to do next, not just
  the number that was exceeded.
- **F13 (R10, half) — resolved, by an existing seam rather than a new watcher.** The root cause was
  not a missing subsystem: `blockcontroller.AgentOutcomeHook` → `jarvis.OnWorkerExit` →
  `orchestrate.HandleChildOutcome` already reports an exited worker in *seconds*, and `OnWorkerExit`
  was discarding the F13 case at one early return — an agent block that exited without ever stamping
  a transcript was treated as a non-agent block. It is now reported when the exit was non-zero
  (`reportableExit`); a **clean** exit with no transcript stays silent, because that is a runtime
  whose reporter hook is not installed, and reporting those would turn every hook-less exit into a
  spurious failure. A lead that dies this way fails its running phase (`jarvis.FailPhase`), so the
  run derives `blocked` instead of reading `executing` — nothing hand-sets a status, because status
  is derived from phases everywhere else. Separately, a child that *hangs* before its first token
  leaves no exit to hook, so the engine sweep ages it from its spawn time against
  `FirstTokenDeadline` (5 min); before this the stall path was gated on `LastActivity > 0` and a
  child that never wrote anything could not stall at all. **Narrowed 2026-09-11:** the deadline is
  armed per runtime (`firstTokenRuntimes`) and only `pi` qualifies — a claude child commits correct
  work having written no transcript at all, so ageing it there was a coin flip, not a stall.
- **F15 (R12) — resolved.** `import-tasks --parallelism`, defaulting to
  `orchestrate.DefaultParallelism` — the dag's ready width, capped at `MaxParallelism`. The `submit`
  JSON path still requires an explicit width; it was never the path that pinned a literal.
- **F16 (R10) — resolved.** A merge-ready task open past
  `MergeGateStaleAfter` (30 min) counts as attention, so `health` leaves `healthy` for `needs-you`.
  Purely a digest derivation — no schema change, no new event kind — aged from the retained
  task-done boundary. **Two limits.** Run events are pruned by volume, so a gate whose done event is
  gone has no clock and is deliberately left alone (a missed escalation costs a timeout; a
  fabricated one raises a false alarm on live work). **Renderer shipped 2026-09-27:** the digest
  carries the gate's clock as `DagTaskDigest.MergeGateTs`, from the same `mergeGateClock` the stale
  check reads. `wsh jarvis dag status` shows `merge waiting 34m` on the gate's row, and the lead card
  lifts the gate out of Done as a live `merge waiting 34m` row. A gate with no clock shows
  `merge waiting` with no age.

Still open, and why:

- **F14 (R11).** Investigated 2026-09-04 and deliberately not fixed. Entitlement is not statically
  knowable: `ListHarnessesCommand` reports capability by construction, and a probe costs a process
  spawn per launch and goes stale anyway. The pi half **did not reproduce** — `pi --list-models` on
  this install shows `deepseek-v4-pro` only under `opencode-go`, so the bare id is unambiguous and
  resolves. The failure is data-dependent (a second provider offering the same id makes the pin
  ambiguous overnight), which also means a hardcoded provider prefix would be exactly as fragile.
  The durable fix is catalog-backed resolution at spawn, where ctx is available. F13 lowers the
  severity either way: a dead route now fails in seconds with the provider's own message.

None of the four is verified against a live DAG run; all are unit-tested only.

Closed later:

- **F11 — closed 2026-09-16 by `1e4bb179`** ("delete the plan gate, the task cap, adaptive
  orchestration and pipeline mode"). The cap is gone rather than raised: `orchestrate.MaxTasks`,
  `jarvis.MaxDagTasks`, `MAX_DAG_TASKS` and the `NewTaskGroup` check were deleted, so a plan of
  any size fits one DAG and no remainder needs a second run. `MaxParallelism` still bounds
  concurrent cost. (Until then it stayed open: the 2026-09-04 raise to 16 fixed the message, not the
  structural gap.)
- **F17 — closed 2026-09-16 by `1e4bb179` and `e9e480b3`** (2026-09-14, "run workers are claude
  and pi only"). `1e4bb179` deleted adaptive orchestration: every orchestrator lead now drives the
  engine and writes `Orchestration_Engine` (`jarvis.IsEngineRun`), so no route selects a second
  orchestrator. `e9e480b3` made codex and opencode consult-only (`RunWorkerCapable: false`), so a
  run's workers are claude or pi. What remains is a reader for runs stored before the change (an
  empty or `adaptive` orchestration), which starts nothing.

## Capture 3 — code review after the Claude-lead change (2026-09-04)

> Not a live run. A read of `pkg/orchestrate`, `pkg/jarvis/run.go`, `wshcmd-jarvisdag.go` and
> `wshserver_dag.go` at 409ea04a, prompted by the Claude-lead e2e
> (`git show a4b5bd4f:docs/jarvis-claude-lead-e2e.md`). Unit tests for `pkg/orchestrate` and `pkg/jarvis` pass at this
> commit (cgo via zig, as the Taskfile builds wavesrv). Every row below is inferred from source and
> cross-checked against the e2e's wake log; none has been reproduced in the dev app.

The Claude-lead change made the engine reachable from a non-pi lead and, by the composer default
("workers same as lead"), from non-pi children. Three of the four rows are places where the engine
still assumes pi on the other side.

> **All four resolved 2026-09-04** (`d966c27e` for F19/F20/F21, `3ca9cd6d` for F18; `75738bfb` names
> `cleanup-wait` in the DAG overview). Unit-tested only — none has been reproduced or confirmed in a
> live DAG run, which is the same evidence gap the capture was written under. See the R14–R17 notes
> below for what each fix did and did not take.

### Flaw table

| #  | Flaw                                                    | Evidence (source at 409ea04a)                                                  | Impact                                   | Status |
| -- | ------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- | ------ |
| F18 | Stall detection is pi-only; every non-pi child is flagged stalled at the threshold regardless of progress | `lastActivityForRun` (`pkg/orchestrate/liveness.go:67`) scans `~/.pi/agent/sessions` only (`piSessionsRoot`, `liveness.go:29`); a claude/codex/opencode child writes no pi session. The engine seeds `LastActivity` at spawn (`engine.go:351`) and only ever raises it from that scan (`engine.go:230`), so for a non-pi child it never moves. At `StallThreshold` (15 min, `liveness.go:25`) the running task flips stalled (`engine.go:233`), `dag:task-stalled` wakes `dag wait`, and the digest hands the lead `retry/skip/escalate` (`digest.go:310`). `retry` runs `cancelAndStopTaskRun` (`mutation.go:171`), which kills the child. The Claude-lead e2e wake log shows no stall wake, so all four children finished inside the window — the only reason it did not surface | a healthy non-pi child looks stalled after 15 min; a lead that follows its prompt retries and destroys in-flight work. This is the composer's default worker route for a Claude lead | ✅ Resolved 2026-09-04 |
| F19 | `buildNext` is not total: a running DAG can still yield a bare `terminal` step | The flat-DAG merge-gate bug (`docs/open-issues.md`, 2026-09-04 note) is one path into the fallthrough at `digest.go:334`. At least one more: every task merged with worktree removal still pending. `RecomputeDagStatus` keeps the DAG running while `CleanupPending` (`dag.go:267`); the digest's attention path only sees `CleanupError` (`failedCleanupIDs`, `digest.go:372`); nothing is busy, ready or dependency-waiting, so step 6 returns `{Kind: "terminal"}` with no status and `waitDecision` (`wshcmd-jarvisdag.go:150`) prints `woke: terminal:healthy`. Transient (the watchdog retries cleanup), but it is the same fabricated stop signal, and worktree removal is exactly what is slow or locked on Windows | the lead is told to stop while the engine is still working; the wake protocol has a case its own contract calls impossible | ✅ Resolved 2026-09-04 |
| F20 | Engine prompt and digest disagree on the merge vocabulary | `buildEngineOrchestratePrompt` (`pkg/jarvis/run.go:426`): "when the digest reports `merge`, run `wsh jarvis dag merge`". The digest never reports `merge`: the wake line is `action:merge-ready` (`wshcmd-jarvisdag.go:159`) and the per-task action is `resolve-merge` (`digest.go:31`). The e2e lead bridged the gap by reading `dag merge --help` | the prompt is load-bearing protocol; a lead that pattern-matches the literal word never acts on the gate | ✅ Resolved 2026-09-04 |
| F21 | Digest child-run cap was not raised with `MaxTasks` | `dagDigestChildRunLimit = 8` (`wshserver_dag.go:111`) bounds `dagDigestChildRuns`; `MaxDagTasks = 16` (`pkg/jarvis/run.go:45`). Tasks 9–16 of a full DAG load no child run, so their durations report `Partial` (`digest.go:619`) | durations degrade on exactly the larger DAGs the raise was for; one constant | ✅ Resolved 2026-09-04 |

### Derived requirements

- **R14 (F18):** a task with no activity source must not be flagged stalled; the digest reports its
  freshness as unknown instead. The engine already accepts this trade in `sessionMentions`
  ("cross-refreshing a sibling's heartbeat is a far cheaper wrong answer than declaring a live child
  stalled"). A non-pi activity source is a separate, later step: the child block's retained
  `agent:status` event is the obvious candidate (the same read `resolveLeadSessionID` does at
  `control.go:163`), but that hook has the install-ownership flakiness recorded in the retired
  `docs/agents/runs-pipeline-known-issues.md` (`git show b8de5b11^:docs/agents/runs-pipeline-known-issues.md`),
  so it must not be the only thing standing between a healthy child and `retry`.
  **Shipped `3ca9cd6d`**, taking the trade as written: `lastActivityForRun` returns a `tracked` flag,
  and an untracked runtime reports freshness unknown (`LastActivity = 0`) rather than aging into a
  stall from its spawn-time seed. Activity sources now read pi, claude and codex transcript roots
  through `agentsessions.SessionRoot`. **`opencode` stays untracked on purpose** — its cwd lives only
  in a sidecar info file whose rewrite behaviour was not verified, and a wrong activity read is worse
  than none. The later non-pi source this note contemplates (the child block's `agent:status` event)
  was not built and is still the open follow-up.
- **R15 (F19):** `buildNext` must be total over a running DAG: no bare `terminal`. Give the
  merged-cleanup-pending case its own kind (`cleanup-wait`, no actions) so `wait` keeps blocking.
  Only after that may `waitDecision` treat an empty `TerminalStatus` as a contract error instead of
  substituting `Health` — the ordering caveat in the open-issues note still holds.
  **Digest side shipped `d966c27e`**: the fall-through is now `cleanup-wait` (no actions), and the
  flat-DAG hole that fed the same fallthrough is closed by a second `merge-ready` branch ranked below
  dispatch and parallelism-wait. **The `waitDecision` half deliberately did not ship** —
  `wshcmd-jarvisdag.go:150` still substitutes `d.Health` for an empty `TerminalStatus`. That is now
  unblocked and safe to take, but it is a hardening step, not a live defect: with `buildNext` total
  over a running DAG, nothing produces the bare `terminal` it would have to catch.
  **Closed 2026-09-27.** `waitDecision` itself was deleted with `wsh jarvis dag wait` in `2ce4161b4`,
  when the engine began waking the lead by typing into its terminal. The last consumer that invented
  a status, the cockpit's `nextStepText`, now renders an empty `terminalstatus` as a digest contract
  error instead of `done`. `TestNextTerminalCancelledCarriesItsStatus` pins that `buildNext` names
  the cancelled status too.
- **R16 (F20):** the prompt uses the digest's words. One constant set for `merge-ready` /
  `resolve-merge`, referenced from both the prompt builder and the digest, so they cannot drift again.
  **Half shipped `d966c27e`:** the prompt now says "when the digest reports `merge-ready` with the
  action `resolve-merge`" (`pkg/jarvis/run.go:428`), which closes the observed failure. The *shared
  constant* was not built — `run.go` still writes the words as literals in prose while `digest.go`
  keeps its own `digestActionResolveMerge`, so the two can drift again. A comment at `run.go:426`
  pins the intent; that is the only thing holding them together.
  **Closed as obsolete 2026-09-27.** `buildEngineOrchestratePrompt` was replaced by
  `OrchestrationRules` (`pkg/jarvis/leadprompt.go`) in `117b42724`. The current prompt never writes
  `merge-ready` or `resolve-merge`, because the engine merges by itself, and a wake names each
  conflict or failed Verify the lead fixes. `TestEngineLaunchPromptDropsTheOldPlanningProtocol`
  fails if `resolve-merge` returns. With no prompt reading the digest's words, a shared constant
  would have one reader, and `jarvis` cannot import `orchestrate`.
- **R17 (F21):** `dagDigestChildRunLimit` follows `jarvis.MaxDagTasks`, or is removed — sixteen run
  reads per status call is not a cost worth a partial digest. **Shipped `d966c27e`:** the constant is
  now `= jarvis.MaxDagTasks`, so raising the task cap carries the digest cap with it.
- **R10 addendum (F13/F16, Claude lead):** pull-based wake removes the last signal. For a pi lead an
  unreachable session at least leaves a `lead-control-failed: unavailable` row. For a Claude lead
  every attempt is `unavailable` by construction (`NotifyLead`, `control.go:119-126`; the Claude
  `agent-hook` never sets `SessionID`), so the row carries no information, and a dead lead is simply
  nobody calling `wait`. The lead-liveness check R10 asks for cannot come from the control channel
  on this runtime; it needs the lead block's own status or a merge-gate age, surfaced in `health`.

## Live check — run 02d0840e (2026-09-29)

A 3-task claude run (lead, workers, reviewers and verifier all `claude-opus-5-5`, parallelism 3), on the
installed build of 2026-09-29 08:55 (`15553268`), read from `db_runevent` and every session's transcript.
It ran 26 min end to end and landed on `main` as `4dda4b54`.

- **Seen working:**
  - **F1, F2, F7:** t-3 raised a two-question ask instead of guessing. The lead was woken with it and answered both in
    one `dag answer` 15 s later, and t-3 went on.
  - **F5, F8:** the lead read `wsh jarvis dag status` with no flags.
  - **F6:** the workers followed the plan's pinned rules. Their file sets were disjoint, though t-1 also
    edited `maintest_test.go`, which the plan gave to no task.
  - **F15:** all three tasks spawned within 4 s at width 3.
  - **F18:** three claude children, running 4-14 min each, raised no stall or suspect event.
  - **F19:** each merge's brief `cleanup-pending` produced no false stop.
- **Not exercised:**
  - F12, F13 and F14.
  - F16: no gate went stale, since the engine merges by itself.
- **Not in that build:** today's flaky Verify reporting (`8b322aa0`), multi-question Gatekeeper (`ac04d587`) and lane
  rewind (`69abf62e`), and the run's own three changes. They need a rebuilt Arc and another run.

## Incident — run a088e568's land held on a merge conflict, and nobody was told (2026-09-29)

Run a088e568 (agent tree and details rail polish, 3 claude tasks, base `3530fa43`) finished clean, but its
branch did not land. The human found out only by asking "is it landed". Timeline (`db_runevent`, +07:00):

- 11:47: run a2521425 lands `a7415e63` on `main`. It appends `narrationFeed` as the last entry of
  `SCENARIOS` in `scripts/cdp/scenarios.mjs`.
- 12:12:32: `dag-done`, and the lead is woken with "run finished". The wake says nothing about whether the
  branch still merges with `main`.
- 12:13:37: the lead runs `wsh jarvis complete`, which closes its tab. Its report says "landed" per task and
  never mentions the land back to `main`.
- 12:13:40: `land-held`, reason "the merge conflicts with main in scripts/cdp/scenarios.mjs; it was aborted".
  The run's own plan had appended `agentTreeRail` at the same spot.
- 12:15: `c403609e` lands on `main` and edits `agenttree.tsx`, adding a second conflict (the lucide import).

The hold itself worked: `checkoutHold` and `reverifyHold` caught the conflict and left the checkout alone.
The gaps are in who hears about it.

- **The hold lands after the only agent with context has gone.** `complete` triggers seal-then-land
  (`sealThenLand`, `wshserver_runs.go`), so the hold is decided after the lead's tab has closed. The only
  signal is a `run-land-held` item in the Brief queue. A merge conflict inside a run goes back to the lead,
  but a conflict at land does not. **Fixed:** a lead's `complete` runs `orchestrate.LandConflicts` (`git
  merge-tree`, no tree touched) and is refused while the land would conflict, naming the files;
  `wsh jarvis complete --hold-land` completes anyway when the human decides to leave it. The base can still
  move between `complete` and the merge, and a conflict that arrives then still holds the land.
- **"Run finished" does not check the land first.** The conflicting `main` commit was 25 min old when the lead
  was woken. **Fixed:** at `dag-done` the run-finished wake ends with "The land into main will conflict in
  <files>: merge main into this tree, resolve, commit, then complete" (`landConflictLine`, `queue.go`).
- **The reason names one file.** **Wrong premise, dropped.** `mergeRefusal` lists every unmerged file
  (`git diff --diff-filter=U`). At the hold (12:13:40) `scenarios.mjs` was the only conflict; the
  `agenttree.tsx` conflict arrived with `c403609e` at 12:15, after the hold.
- **`wsh runs show` prints `land` after the whole task digest** (line 42 of 73 here), below the task results.
  A `| head` read misses it. **Fixed:** the `land` line follows `status`.
- **The plan asked for a guaranteed conflict.** The goal said run a2521425 was appending `narrationFeed`, and
  this run's plan still appended its entry at the end of the same list. Two concurrent runs that append to one
  list tail always conflict at land. **Not pursued:** a lead generally cannot see what other runs' plans touch,
  and with the conflict predicted before `complete`, an overlap like this costs the lead one resolve.

None of the fixes has run live; they are unit-tested (`TestLandConflictsPredictsTheLandsConflicts`,
`TestRunFinishedWakeNamesTheConflictsTheLandWouldHoldOn`, `TestLeadCompleteRefusesALandThatWouldConflict`,
`TestRunsShowLinesPrintTheLandBesideTheStatus`).

Recovery, by the lead on the human's go-ahead:

1. Merge `main` into `wave/a088e568` in the landing tree, keeping both scenario entries and adding
   `ExternalLink` to the lucide import.
2. Run tsc (exit 0), then vitest on `frontend/app/view/agents` and `frontend/app/element` (1839 passed).
3. Commit the merge as `7561443d`.
4. `wsh runs land`, which landed it as `fb4e5db2`.

## Incident — run e8ddc171's lead started without its plan review's findings (2026-10-06)

Run `e8ddc171` sat in `plan-review` for 59 minutes with no task started, and `wsh runs attention` said nothing was
waiting on the user. The run: plan `docs/superpowers/plans/2026-10-06-agent-rail-tabs.md`, dag `b4238bb3`, a claude
lead, sonnet workers.

What happened, read from the two session transcripts under
`~/.claude/projects/D--projects-arcterm--waveterm-worktrees-e8ddc171-…`:

1. The plan reviewer (session `9de9cc36`) started at 11:29 and recorded `planreview fail` at 11:40:16, after 11 minutes.
   - Its findings were over `MaxReviewNoteLen` (2,000 characters), which refuses rather than clips.
   - It cut them down to fit and said so in its closing message. A wake that arrived would still have carried the
     short version.
2. The run had no lead yet, so the fail wake launched one (`launchLocked`: a lead's first wake is its launch prompt).
   The lead's session (`15fc3b1a`) began at 11:40:19.
3. The first message in the lead's transcript is 1,155 characters and stops mid-sentence, at
   `` `wsh jarvis dag forward <task> <what ``. Two things are missing from it:
   - the rest of `PlanLeadPrompt`'s contract;
   - the wake line (`wake: plan review failed in round 1: …`).
4. The lead ran `dag status` and read `status=plan-review`. It then wrote "Nothing needs me yet. The engine will wake me
   with the next event, such as the review verdict", and ended its turn at 11:40:31. The verdict had been its launch
   wake, so no further wake came.
5. Nothing ages a `plan-review` stage whose reviewer has ended. `dag status` printed the same digest for 59 minutes, and
   `runs attention` stayed empty.

Open:

- **Where the launch prompt was cut.** Not established. To reproduce, give a lead its first wake as a long text full of
  quotes and backticks, as these findings were, and compare the `lead-launched` run event's text with the lead's first
  transcript message.
- **A failed plan review that no lead acts on is invisible.** The digest's `next` could name the failed review, or the
  stage could age into `runs attention`, the way F16 aged the merge gate.

Recovery, by the human's session:
1. Read both transcripts.
2. Cancel the run. It needed `--yes`, because the idle lead counted as a live worker.
3. Remove its tree with `task worktree:cleanup`.
4. Revise the plan from the reviewer's full findings (`abcccd05`).
5. Start run `fe95d11e`.

## Constraints carried into the redesign

- KISS/YAGNI: no new subsystems, no per-task timeout policies, no message bus. Only the failure modes
  observed above.
- The lead is the child's human: children stay headless; every question routes to lead or cockpit.
- Everything is verifiable with a live DAG run (the evidence goal re-run is the validation case).
