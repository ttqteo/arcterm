# Kael sync (2026-11-03): the fork's engine fixes and optimizations

**Verify:** `node scripts/verify.mjs ./pkg/orchestrate/... ./pkg/jarvis/... ./pkg/wshrpc/... ./pkg/wcore/... ./pkg/waveobj/... ./cmd/wsh/...`
**Check:** `task check:ts && go vet ./pkg/orchestrate/... ./pkg/jarvis/... ./pkg/wshrpc/... ./pkg/wcore/... ./pkg/waveobj/... ./cmd/wsh/...`
**Final:** `node scripts/cdp/final-verify.mjs final-rerun final-stage`

## Context for every task

The `kael` remote is `https://github.com/kaeltran16/waveterm.git`; `kael/main` is at `16b726ffd` (fetched
2026-11-03). Our last real merge of it is `a8020da45` (2026-10-19); the 2026-10-30 sync ported later commits by
hand, under different subjects. Read a commit with `git show <hash>`, a file at the fork's tip with
`git show kael/main:<path>`. The remote's refs are shared by every worktree. There is no spec: this plan is the
requirement list.

Scope is the orchestrator engine only (`pkg/orchestrate`, its lead/worker prompts in `pkg/jarvis`, `wsh runs` /
`wsh jarvis dag`, and the run UI only where a ported engine change needs a control). Not in scope: remote mode,
Jira, sessions, Code, brainstorm, workflow scan, and the fork's dropping of the `Arc-Run`/`Arc-Task`/`Arc-Model`
commit trailers (`0db3b5bd7`, `d834c09f1`): keep our trailers. Two named exceptions: Task 3 edits one line of
`skills/brainstorm/SKILL.md` (81485fa70: the spec path), and Task 4 ports only the `DeleteTab` hook and the Resume
half of `af66a198a` (`pkg/wcore/workspace.go`), not its `wshserver_workflowscan.go` part.

**Port, don't cherry-pick blindly.** Our engine has diverged. For each commit: read it, check in our source whether
the bug or gap exists here (it may already be fixed under another name), and port the behaviour with its tests
(adapted) if it does. `git cherry-pick -n` is fine where it applies cleanly. The fork's `docs/orchestrator-guide.md`
and `AGENTS.md` edits are not ported by Tasks 1–6: Task 7 writes the docs.

Rules: Go is the source of truth for wire types; change the Go and run `task generate`, never hand-edit
`frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go` or
`pkg/{waveobj,wconfig}/metaconsts.go`. Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target
x86_64-windows-gnu"` (Bash). Tasks 1–6 do not edit `CHANGELOG.md` or `docs/guide/orchestrator.md`; each task's last
commit message ends with a table of every commit it looked at: ported / already here / not ours, and for each ported
one a line saying what a user would notice (Task 7 writes the CHANGELOG from those lines).

Commits since `a8020da45` the lead checked and found already here (no task ports them): `a2ab52c4a` (5m prompt
cache: `PromptCacheTTLEnv` in `pkg/consult/consult.go`), `736eea369` (settle ended runs' dags: `settleEndedRun` in
`pkg/orchestrate/engine.go`), `3b4177dfc` (round 1 plan review's second pass: `PlanReviewLens_Second`),
`4464bdbf3` (in-feature leftovers go to a fix round: the lead prompt's run-finished line), `8e6f6b893` (slow dag lock
log `logSlowDagLock` in `mutation.go`; the DAG header already counts through `runProgress`). Not ours:
`0db3b5bd7`, `d834c09f1`.

### Task 1: Rerun a failed final stage; a Check/Verify exit 3 or a killed command is not a verdict
**Depends on:** none
**Files:** `pkg/orchestrate/final.go`, `pkg/orchestrate/final_test.go`, `pkg/orchestrate/finalend_test.go`, `pkg/orchestrate/land.go`, `pkg/orchestrate/land_test.go`, `pkg/orchestrate/queue.go`, `pkg/orchestrate/wake.go`, `pkg/orchestrate/watchdog.go`, `pkg/orchestrate/basecheck.go`, `pkg/orchestrate/basecheck_test.go`
**Files:** `pkg/jarvis/plan.go`, `pkg/jarvis/plan_test.go`, `pkg/jarvis/leadprompt.go`, `pkg/jarvis/leadprompt_test.go`, `pkg/jarvis/attention.go`, `pkg/waveobj/wtype.go`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshserver/wshserver_dag.go`, `cmd/wsh/cmd/wshcmd-runs.go`
**Files:** `frontend/app/cockpit/actions/run.ts`, `frontend/app/cockpit/actions/run.test.ts`, `frontend/app/view/agents/finalstagepane.tsx`, `frontend/app/view/agents/finalstageviews.tsx`, `frontend/app/view/agents/runactions.ts`, `frontend/app/view/jarvis/runsheet.tsx`, `frontend/app/view/jarvis/runsheetmodel.ts`, `frontend/app/view/jarvis/runsheetmodel.test.ts`, `scripts/cdp/scenarios.mjs`

Commits: `feb854902` (rerun a failed final stage in the same round from `wsh runs rerun-final` (an existing
`DagAction` with action `final-rerun`, no new RPC), the run sheet, the Final verification pane and the palette; in
the final stage Check and Verify may exit 3 as unverified; the lead is told to drop its fix plan; a run held only by
the failed stage lands once the rerun passes; a done run's lead gets no wakes; it adds the CDP scenario
`final-rerun`: keep it under that name, adapted to our run sheet), `36ecddae6` (a timed-out or killed command is not
read as a verdict on the code), `71620ec41` (a lead fixes every failing final step, one already failing on the base
included). We already have three final rounds and the human's grant of one more (`bb4b4605f`): build on it.

Acceptance:
- Go: `final_test.go` / `finalend_test.go` cases for a failed stage that reruns in the same round and passes, a
  Check or Verify exit 3 recorded as unverified with the stage going on, and a timed-out or killed command read as
  unverified, not failed; `land_test.go` for a run held only by the failed stage that lands once the rerun passes;
  `basecheck_test.go` for a killed base check that blames nothing; `leadprompt_test.go` pinning the lead's
  drop-the-fix-plan and fix-every-failing-step text. Run them with `go test ./pkg/orchestrate -run '<names>'` and
  `go test ./pkg/jarvis -run '<names>'`.
- Frontend: `run.test.ts` (the palette action is offered only for a failed final stage and sends `final-rerun`) and
  `runsheetmodel.test.ts` (the sheet's rerun control shows for a failed stage only).
- Scenario `final-rerun` steps: (1) the run sheet offers `Rerun final stage` on a dag seeded with a failed final
  stage; (2) clicking it resets the stage to the round not started and the button goes; (3) the engine refused
  nothing; (4) after reseeding the failed stage, the Final verification pane shows its Rerun control, and clicking
  it reruns the stage; (5) after reseeding again, the palette lists the rerun command for the run, and running it
  reruns the stage. Each step takes a screenshot. The existing `final-stage` scenario still passes (Final runs both).

### Task 2: A machine-wide worker cap, and slots freed under review
**Depends on:** none
**Files:** `pkg/orchestrate/engine.go`, `pkg/orchestrate/engine_test.go`, `pkg/orchestrate/workerslots.go`, `pkg/orchestrate/workerslots_test.go`, `pkg/orchestrate/maintest_test.go`, `pkg/wshrpc/wshserver/maintest_test.go`, `pkg/orchestrate/dag.go`, `pkg/orchestrate/digest.go`, `pkg/orchestrate/digest_test.go`, `pkg/orchestrate/review_test.go`, `pkg/orchestrate/scheduler.go`, `pkg/orchestrate/scheduler_test.go`, `pkg/orchestrate/retry.go`, `pkg/orchestrate/mutation_test.go`, `pkg/orchestrate/watchdogscope_test.go`

Commits: `b78686ca4` (dispatch claims slots against a machine-wide cap of MaxParallelism, refills a run only to its
fair share while another runs, and holds dispatch while memory is short; `pkg/orchestrate/workerslots.go`). Our
`pkg/jobqueue` already reads the machine's memory: replace the fork's gopsutil `availableMemory` with
`jobqueue.ReadPressure` behind a package var tests stand in for, and hold new dispatch while it reads
`PressureWarn` or `PressureCritical` (unknown holds nothing: the job queue still gates each heavy command). No second
memory reading. `2eec2a796` (`UncapWorkersForTest` in `pkg/wshrpc/wshserver/maintest_test.go`, and in
`pkg/orchestrate/maintest_test.go` if its tests need it: without it the cap stalls the wshserver dag tests that
Verify's `./pkg/wshrpc/...` runs). `28e43a4c3` (a task under review frees its parallelism slot), `cfeedca95` (a
stopped worker fails its task, not the whole dag), `70c90eb0d` (split `scheduleLocked` along its phases) if it makes
the above cleaner, and the worker-contract half of `18f7167ea` (the worker runs a test the task says to watch fail
before writing the code it tests, a compile error counting as that failure; one line in `engine.go`, pinned in
`engine_test.go`; the plan-format half is already in `pkg/jarvis/plan.go`).

Acceptance: `workerslots_test.go` cases for the cap across two dags, the fair-share refill while another run is
active, and dispatch held under a stand-in pressure of warn and critical and not under unknown or normal;
`scheduler_test.go` / `review_test.go` / `digest_test.go` for a task in review that no longer counts against
parallelism; `mutation_test.go` / `watchdogscope_test.go` for a stopped worker that fails its task while the dag goes
on; `engine_test.go` pinning the red-first line; the full `./pkg/wshrpc/...` package passes with the cap in place.

### Task 3: Plan review, lead wakes and the run's spec
**Depends on:** Task 1, Task 2
**Files:** `pkg/orchestrate/planreview.go`, `pkg/orchestrate/planreview_test.go`, `pkg/orchestrate/planreviewpicks_test.go`, `pkg/orchestrate/planreviewlens_test.go`, `pkg/orchestrate/reportsections.go`, `pkg/orchestrate/queue.go`, `pkg/orchestrate/queue_test.go`, `cmd/wsh/cmd/wshcmd-jarvisdag.go`, `cmd/wsh/cmd/wshcmd-jarvisdag_test.go`, `pkg/jarvis/leadprompt.go`, `pkg/jarvis/leadprompt_test.go`
**Files:** `pkg/orchestrate/snapshot.go`, `pkg/orchestrate/snapshot_test.go`, `pkg/wshrpc/wshserver/wshserver_runs.go`, `pkg/wshrpc/wshserver/wshserver_dag.go`, `pkg/wshrpc/wshserver/wshserver_landing_test.go`, `skills/brainstorm/SKILL.md`
**Files:** `pkg/orchestrate/engine.go`, `pkg/orchestrate/engine_test.go`, `pkg/orchestrate/land.go`, `pkg/orchestrate/laneschedule_test.go`, `pkg/orchestrate/liveness_test.go`, `pkg/orchestrate/merge_test.go`, `pkg/orchestrate/mergetask.go`, `pkg/orchestrate/mutation.go`, `pkg/orchestrate/outcome.go`, `pkg/orchestrate/review.go`, `pkg/orchestrate/review_test.go`, `pkg/orchestrate/setup_test.go`, `pkg/orchestrate/verify.go`, `pkg/orchestrate/verify_test.go`, `pkg/orchestrate/verifybisect_test.go`

Commits: `be564a7a9` (plan review flags a command that names a path a later task creates), `559231030` (cap the
failed plan review wake; `wsh jarvis dag planreview findings` prints them whole), `da42814bd` (plan review checks
the plan's claims about code: in our prompts and `skills/`, never the claude-mod copy), `c8c607ecc` (task wakes
carry the fact to act on: a failed review's first note line, a failed task's first detail line, a failed Verify's
first failing line, a conflict's files; every task wake ends with `wsh jarvis dag status <task>`, which prints the
dag's line and that task's part only; ours takes no argument today), `00d5bec9d` (move a run's spec into its tree so
its land never holds; ours has no design attach, so port the run-start and dag-submit paths only), `81485fa70`
(refuse a gitignored spec at run start and at dag submit's specpath check; no approve path exists here; the
brainstorm skill names `docs/superpowers/specs/` as the spec path).

Acceptance: `planreviewpicks_test.go` for a command naming a path a later task creates; `planreview_test.go` and
`wshcmd-jarvisdag_test.go` for the capped failed-review wake and `planreview findings` printing every finding whole;
`planreviewlens_test.go` pinning the claims-about-code checklist item; `queue_test.go` / `merge_test.go` /
`review_test.go` / `verify_test.go` for each wake's fact line and its closing `dag status <task>`, and
`wshcmd-jarvisdag_test.go` for `dag status <task>` printing only that task; `snapshot_test.go` /
`wshserver_landing_test.go` for a spec moved into the landing tree (tracked, ignored and taken paths stay put) and a
gitignored spec refused with an error naming the fix; `leadprompt_test.go` for the autonomous lead writing its spec
in its working directory.

### Task 4: Worktrees, cleanup and interrupted runs
**Files:** `pkg/orchestrate/cleanup.go`, `pkg/orchestrate/cleanup_test.go`, `pkg/orchestrate/engine.go`, `pkg/orchestrate/mergetask.go`, `pkg/orchestrate/rewind.go`, `pkg/orchestrate/worktree.go`, `pkg/orchestrate/treedirs.go`, `pkg/orchestrate/worktreeroot.go`, `pkg/orchestrate/worktreeroot_test.go`, `pkg/orchestrate/final.go`, `pkg/orchestrate/final_test.go`, `pkg/orchestrate/verifier.go`
**Files:** `pkg/orchestrate/plancmd_windows.go`, `pkg/orchestrate/plancmd_test.go`, `pkg/orchestrate/interrupted.go`, `pkg/orchestrate/interrupted_test.go`, `pkg/orchestrate/outcome.go`, `pkg/orchestrate/outcome_test.go`, `pkg/wcore/workspace.go`, `pkg/wshrpc/wshserver/wshserver_resume_test.go`

Commits, each checked against our source: `6bb1f87a1` (a lane tree whose directory a process holds moves to a fresh
path; the fork's `storageseam.go` change lives in our `treedirs.go`), `dd124e16a` (the worktree sweep drops day-old
markers no store holds), `3b528ac3d` (a retried final tree removal spares the next round's tree), `32dad1457` (plan
commands keep Git Bash's path conversion), `8fa2a92ce` (cancel at boot the dag runs a quit left unrecorded),
`af66a198a` (closing a run's agent tab fails the run: the `DeleteTab` hook in `pkg/wcore/workspace.go` and Resume
only).

Acceptance: `cleanup_test.go` for a held lane directory that moves to a fresh path and a dag that goes on;
`worktreeroot_test.go` for a day-old orphan marker dropped and a live one kept; `final_test.go` for a retried removal
that leaves the next round's tree; `plancmd_test.go` for a plan command that keeps the path conversion (Windows);
`interrupted_test.go` for a dag a quit left unrecorded cancelled at boot; `outcome_test.go` /
`wshserver_resume_test.go` for a closed agent tab failing its run and Resume of such a run.

### Task 5: Land, merge and Verify fixes
**Files:** `pkg/orchestrate/land.go`, `pkg/orchestrate/land_test.go`, `pkg/orchestrate/mergetask.go`, `pkg/orchestrate/queue.go`, `pkg/orchestrate/worktree.go`, `pkg/orchestrate/continue_test.go`, `pkg/orchestrate/verify.go`, `pkg/orchestrate/merge.go`, `pkg/orchestrate/merge_test.go`, `pkg/orchestrate/basecheck.go`, `pkg/orchestrate/plancmd.go`, `pkg/orchestrate/verifybisect_test.go`
**Files:** `pkg/jarvis/attention.go`, `pkg/jarvis/leadprompt.go`, `pkg/waveobj/wtype.go`, `frontend/types/gotypes.d.ts`, `cmd/wsh/cmd/wshcmd-jarvis.go`

Commits, each checked against our source: `c00951639` (an uncommitted fix in the landing tree no longer passes and
then vanishes), `8b58986fa` (a land held on a busy checkout claim retries by itself), `8bc284e7d` (a land clears an
untracked copy in a project that is a subfolder of its repo), `41f34bc7b` (merge --continue refuses a squash no
longer staged), `1711286f4` (a merge Verify bisect blames no lane for a failure it cannot reproduce).

Acceptance: `continue_test.go` for an uncommitted fix in the landing tree that is committed or refused, never passed
and dropped; `land_test.go` for a busy-claim hold that retries and lands, and for the subfolder project's untracked
copy cleared; `merge_test.go` for `--continue` refused when the squash is no longer staged; `verifybisect_test.go`
for a bisect that cannot reproduce the failure and blames no lane.

### Task 6: Retry and escalate guards
**Depends on:** Task 2, Task 5
**Files:** `pkg/orchestrate/mutation.go`, `pkg/orchestrate/mutation_test.go`, `pkg/orchestrate/scheduler.go`, `pkg/orchestrate/engine.go`, `pkg/orchestrate/outcome.go`, `pkg/orchestrate/outcome_test.go`, `pkg/orchestrate/retry.go`, `pkg/waveobj/wtype.go`, `frontend/types/gotypes.d.ts`

Commits, each checked against our source: `4c274c131` (retry refuses a task that landed or holds a merge),
`17da06a2c` (escalate refuses a blocked merge), `c3bb38c19` (the auto-retry bound holds when the failure kind
changes).

Acceptance: `mutation_test.go` for retry refused on a landed task and on one holding a merge, and escalate refused on
a blocked merge, each with an error naming what to do instead; `outcome_test.go` for the auto-retry bound reached
across two failure kinds.

### Task 7: CHANGELOG and orchestrator guide
**Files:** `CHANGELOG.md`, `docs/guide/orchestrator.md`

Read the commit tables Tasks 1–6 left (`git log` on this branch since the run's base). For each ported commit a user
would notice, add one line under `## Unreleased` in `CHANGELOG.md` (`Added`, `Changed` or `Fixed`, written for the
user, following the file's header). Update `docs/guide/orchestrator.md` where a ported change alters what it
describes: the final stage's rerun and Check/Verify exit 3, the machine-wide worker cap and memory hold, a task in
review freeing its slot, `dag status <task>` and the task wakes' fact lines, the plan review's new checks, the spec
moved into the run's tree, and the retry/escalate/merge-continue refusals. Read the fork's
`docs/orchestrator-guide.md` diffs in those commits for wording, but write against our guide's structure.

Acceptance: every ported, user-visible commit has a CHANGELOG line; no line for a commit marked already here or not
ours; each guide section the list above names reads true against the merged code (`Grep` the function or command it
names).
