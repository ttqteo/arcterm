# Kael sync (2026-11-13), step 1: engine core, run views, RPC plumbing

**Spec:** `docs/superpowers/specs/2026-11-13-kael-sync-engine-hardening-overview-design.md` (read it whole before starting a task: groups 1, 2 and 3 are this plan; its "Out of scope" lists the hunks to drop, and its "Our code wins" section is the hard rule every task and reviewer applies)
**Verify:** `node scripts/verify.mjs ./pkg/orchestrate/... ./pkg/jarvis/... ./pkg/wshutil/... ./pkg/wshrpc/... ./pkg/web/... ./pkg/wstore/... ./pkg/waveobj/... ./pkg/gitinfo/... ./pkg/agentsessions/... ./pkg/util/jobobject/... ./cmd/wsh/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs kael1113-dag-modal kael1113-timeline kael1113-tree-lanes kael1113-final-stage dag-lifecycle dag-peek dag-observability final-stage final-rerun lead-card-merge-gate agent-tree-rail run-sheet-cards`

> **For Claude:** run this with the engine (`wsh runs start --plan <this file>`), or task by task with
> superpowers:subagent-driven-development.

**Goal:** Port the fork's engine fixes (lands, merges, recovery, plan parsing, run events), its run-view fixes (DAG
modal, timeline, tree lanes, final stage) and its RPC plumbing fixes onto `main`, without changing any behaviour of
ours.

**Architecture:** A port of behaviour from `kael/main` (`a8f0864d1`), not a cherry-pick. Wire fields land first in
one task; then four lanes run side by side: the orchestrate core (serial, they share `merge.go`, `land.go`,
`mergetask.go`, `scheduler.go`, `wshserver_dag.go`, `wshcmd-jarvisdag.go`), Jarvis and wshserver odds, RPC plumbing,
and the run views (serial, they share `daggraph.tsx`, `dagmodal.tsx`, `timelinerail.tsx`, `timelinegroups.ts`,
`runlineage.ts`).

**Tech stack:** Go (`pkg/orchestrate`, `pkg/jarvis`, `pkg/wshutil`, `pkg/wshrpc/wshserver`), React 19 + jotai
(`frontend/app/view/orchestrate`, `frontend/app/view/agents`), vitest, CDP scenarios.

---

## How every task runs

First `git fetch kael` (the hashes are on `kael/main`). Then, for each commit the task lists, oldest first:

1. Read it: `git show <hash>` (and `git show kael/main:<path>` for a file at the fork's tip).
2. Check whether ours already does it. Ours shares most of these files with the fork, but our own work since
   2026-11-06 overlaps it (for example our `0e9d917d8` already refuses a fence left open over task headings, close to
   `725085b17`). A commit or hunk ours already has is skipped.
3. Port the commit's tests first, adapted to our names: new test functions or cases only. Run them (one package with
   `-run`, or one vitest file) and see the new ones fail for the reason the commit fixes.
4. Port the code. Use `git cherry-pick -n <hash>` only when it applies cleanly; otherwise edit by hand.
5. Run the same focused tests and see them pass, with every existing test in that file still passing unchanged.
6. Commit by pathspec (`git add -- <paths>` then `git commit -m "<msg>" -- <paths>`), one commit per fork commit or a
   few small related ones, subject in our style (`fix(orchestrate): …`), naming the fork hash in the body. Every
   skipped commit or hunk, and why, goes in the body under a "Differs from plan:" paragraph.

Go tests on Windows need cgo: `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/x -run '^(TestA|TestB)$'`
(Bash). A frontend test: `npx vitest run frontend/app/view/orchestrate/<file>.test.ts`.

## Rules every task follows

- **Our code wins** (spec section). Additive only: never rewrite, rename, remove or restyle an existing behaviour,
  component, binding, wire field or test of ours. Adding test cases is fine; editing or deleting an existing case is
  not. A task reviewer treats any changed or removed behaviour of ours as a failure.
- **Checkout landing stays.** `--landing checkout` keeps working exactly as today. A fork fix written for branch-only
  landing (the fork deleted checkout landing in `c1869154c`, out of scope) is fitted so the checkout path is unchanged,
  with a test for each landing mode the fix touches.
- **No early start.** Ours never had it and the fork reverted it. Drop every hunk that touches `earlystart.go` or an
  early-lane predicate (`f1f680954` is ported for its `worktree.go` part only).
- **Only Task 1 changes wire types** (`pkg/wshrpc/wshrpctypes_*.go`, `pkg/waveobj/wtype.go`, `pkg/waveobj/runevent.go`)
  and runs `task generate`; never hand-edit a generated file. A later task that finds a wire field Task 1 missed stops
  and says so in its report rather than adding it.
- **Only Task 1 edits `scripts/cdp/scenarios.mjs`.** Each view task fills only its own scenario module.
- **Only Task 16 edits** `CHANGELOG.md`, `docs/hand-checks.md`, `docs/open-issues.md`, `docs/guide/orchestrator.md`,
  `frontend/app/store/keybindings/bindings.ts` and `docs/keyboard-shortcuts.md`. A task that needs one of those changed
  lists the change in its commit body for Task 16.
- Colours only from `@theme` tokens, motion from `frontend/app/element/motiontokens.ts`, UI per `DESIGN.md`.
- The fork's scenario files (`scenarios-runs.mjs`, `scenarios-cockpit-rail.mjs`, `scenarios-agent.mjs`,
  `scenarios-palette.mjs`) do not exist in ours: their steps are the source for our task modules, adapted to our kits.
- Pure logic in a `foo.ts` with `foo.test.ts` beside it; the view stays a thin `foo.tsx`.

## Decisions this plan makes beyond the spec (and why)

1. **Wire fields first, in one task.** `ff9e86dd2`, `dcd0ea248`, `c3a7aa5fa`, `969ae84ec`, `43ba106a9`, `49c31729f`,
   `f2f866e4d` and `a61a68c95` each add Go wire fields, and each `task generate` rewrites `frontend/types/gotypes.d.ts`.
   One owner avoids generated-file collisions and lets the backend and view lanes run side by side.
2. **The orchestrate core is one serial chain (Tasks 4 → 5 → 6 → 7 → 8 → 9)**: nearly every commit in it touches one of
   `merge.go`, `land.go`, `mergetask.go`, `queue.go`, `scheduler.go`, `mutation.go`, `final.go`, `wshserver_dag.go`,
   `wshcmd-jarvisdag.go`, `leadprompt.go`. Parallel lanes there would only trade task time for merge conflicts.
3. **The run views are one serial chain (Tasks 13 → 14 → 15)** for the same reason (`daggraph.tsx`, `dagmodal.tsx`,
   `timelinerail.tsx`, `timelinegroups.ts`, `runlineage.ts`, `finalstagepane.tsx`).
4. **The frontend halves of engine commits go with the views.** `dcd0ea248`, `7378b15a4`, `c3a7aa5fa` and `a61a68c95`
   have Go and TS parts: the Go part goes in the core chain, the TS part in Task 14, built against Task 1's wire types.
5. **`98cd26122` (drop may-be-stuck's repeated-failure scan) is skipped** unless Task 6 shows ours raises the same
   false alarm the fork removed it for; it removes a behaviour of ours (spec, "Our code wins").
6. **`06ef4d9c4` (the DAG modal takes its owner from the dag)** also trims the palette's run items and deletes cases
   from `bindings.test.ts` and `dispatcher.test.ts`. Ours has no `palette-items.ts`; Task 13 ports the owner and
   `openref` part only, and keeps every palette entry and test case of ours.
7. **`969ae84ec`'s frontend part** targets the fork's `setupskillsstore.ts`, which ours lacks: Task 10 ports the Go
   reply field and shows the reason in ours' Setup skills adopt flow only if ours has a place that reads the adopt
   reply; otherwise it names the frontend half skipped.
8. **`ed721ed5c` (chunk refs resolved against the live plan)** targets `briefinitiatives.tsx` and `briefmutations.ts`,
   which ours lacks; Task 3 ports it onto ours' equivalent in `effortstore.ts` / the Brief's initiative forms if the
   same race exists, else skips it.
9. **`04aea9b2c` (below-normal priority for workers and reviewers)** must build on Windows and macOS: its
   `jobobject_windows.go` / `jobobject_other.go` split is kept, and Task 8 checks `GOOS=darwin go build ./pkg/...`.

## Scenario modules (created empty by Task 1, filled by their task)

Each is `export default function (kits) { return [ …scenarios ]; }`, registered in `scenarios.mjs` with the existing
`KAEL_KITS`.

| Module | Task | Scenario names |
|---|---|---|
| `scripts/cdp/scenarios-kael1113-dag.mjs` | 13 | `kael1113-dag-modal` |
| `scripts/cdp/scenarios-kael1113-timeline.mjs` | 14 | `kael1113-timeline`, `kael1113-tree-lanes` |
| `scripts/cdp/scenarios-kael1113-final.mjs` | 15 | `kael1113-final-stage` |

A dag the scenarios need is seeded with the helpers `docs/reference/cdp-run-fixtures.md` names (they live in
`scenarios.mjs`), passed in through the kits.

---

### Task 1: Wire fields and scenario module stubs
**Depends on:** none
**Files:** `frontend/types/gotypes.d.ts`, `pkg/waveobj/runevent.go`, `pkg/waveobj/wtype.go`, `pkg/wshrpc/wshrpctypes_agentsync.go`, `pkg/wshrpc/wshrpctypes_dag.go`, `pkg/wshrpc/wshrpctypes_jarvis.go`, `pkg/wshrpc/wshrpctypes_runs.go`, `scripts/cdp/scenarios-kael1113-dag.mjs`, `scripts/cdp/scenarios-kael1113-final.mjs`, `scripts/cdp/scenarios-kael1113-timeline.mjs`, `scripts/cdp/scenarios.mjs`

1. From each of `ff9e86dd2`, `dcd0ea248`, `c3a7aa5fa`, `969ae84ec`, `43ba106a9`, `49c31729f`, `f2f866e4d`, `a61a68c95`,
   take only the hunks in the files above: new fields, new run event kinds, new constants. Put each on the struct the
   fork put it on; where ours already has the field (ours has `MergeGateTs` on the dag type), skip it. Every new field
   is `omitempty`, so old data still reads.
2. Do not take `98cd26122`'s or `c1869154c`'s wire removals, nor any early-start field.
3. Run `task generate`; check `git diff --stat` shows only generated files besides the Go above.
4. `go build ./...` and `task check:ts` pass.
5. Create the three scenario modules, each returning `[]`, and register them in `scenarios.mjs` beside
   `monitorTasksScenarios`, called with `KAEL_KITS`.
6. Commit (`wshrpc: Kael sync 11-13 wire fields`), the body listing every field and the commit it came from.

### Task 2: Plan and worker-report parsing
**Depends on:** none
**Files:** `pkg/jarvis/onexit.go`, `pkg/jarvis/onexit_test.go`, `pkg/jarvis/plan.go`, `pkg/jarvis/plan_model_test.go`, `pkg/jarvis/plan_test.go`, `pkg/jarvis/workerreport.go`, `pkg/jarvis/workerreport_test.go`

Commits: `dc1c00b4a` (plan fences opened on a list item), `1765e5dcb` (worker-report fences on a list item),
`0d79622ee` (refuse a Depends line after Files/Model/Chunk), `a2c52d70e` (strip a UTF-8 BOM), `19be11b27` (refuse a
heading that misses the task shape), `7e2075b98` (outcome summary valid UTF-8 at its cut), `725085b17` (refuse an
unclosed code fence), `65f44bce3` (refuse a late Depends line and a one-# task heading), `6c55c3aef` (a title that
starts with "Task <n>").

- This changes what `jarvis.PlanFormat` accepts. Refuse only what ours would already misparse: before porting each
  "refuse" commit, write its fork test case against ours unchanged and see what ours does. If ours parses that plan
  correctly today, the refusal is a behaviour change: skip it and name it.
- `0e9d917d8` (ours) already refuses a fence left open over task headings; `725085b17` adds only what that leaves.
- Every existing case in `plan_test.go` and `workerreport_test.go` passes unchanged.
- Run: `go test ./pkg/jarvis -run '^(TestParsePlan.*|TestWorkerReport.*|TestOnExit.*)$'` (adjust to the names the
  fork's tests use).

### Task 3: Jarvis: ask oref, worker tabs, prompt pruning, run lookup, chunk refs
**Depends on:** none
**Files:** `frontend/app/view/jarvis/effortcreateform.tsx`, `frontend/app/view/jarvis/effortstore.test.ts`, `frontend/app/view/jarvis/effortstore.ts`, `pkg/jarvis/attention.go`, `pkg/jarvis/attention_test.go`, `pkg/jarvis/resolve.go`, `pkg/jarvis/resolve_db_test.go`, `pkg/jarvis/runexec.go`, `pkg/jarvis/runexec_test.go`, `pkg/jarvis/watcher_test.go`, `pkg/wshrpc/wshserver/wshserver_ctx.go`, `pkg/wshrpc/wshserver/wshserver_ctx_test.go`, `pkg/wshrpc/wshserver/wshserver_effortlink_test.go`, `pkg/wshrpc/wshserver/wshserver_resmon_test.go`

Commits: `04e8340db` (a channel-less ask carries its agent's tab oref), `060b57372` (remove a run worker's tab when its
spawn fails part-way), `e71d45566` (prune prompt files older than a week), `615d7a2ca` (read a tab's run off its stamp,
not a scan of every run), `cd62634c0` (scan for a stale-stamped tab's run once per stamp), `ed721ed5c` (decision 8).

- Ours already prunes asks in `attention.go` (`attention_askprune_test.go`); `e71d45566` prunes prompt files, a
  different thing: check before skipping.
- `615d7a2ca` must return the same run for every tab ours resolves today; a test covers a tab with no stamp.

### Task 4: Git safety in merge, land and worktree
**Depends on:** none
**Files:** `pkg/orchestrate/cleanup.go`, `pkg/orchestrate/cleanup_test.go`, `pkg/orchestrate/land.go`, `pkg/orchestrate/land_test.go`, `pkg/orchestrate/merge.go`, `pkg/orchestrate/merge_test.go`, `pkg/orchestrate/mergetask.go`, `pkg/orchestrate/rewind.go`, `pkg/orchestrate/rewind_test.go`, `pkg/orchestrate/worktree.go`, `pkg/orchestrate/worktree_test.go`

Commits: `0db43e5af` (typed git answers, undo for squash and land), `b3fbcfa57` (a squash message skips commits HEAD
has), `758220f37` (a recovery patch never overwrites an earlier one), `1187414b4` (a git its context killed is no
answer), `2df05c467` (a branch probe git cannot answer is not a merged lane), `f1f680954` (`worktree.go` part only: a
restarted lane's branch git cannot see is not gone), `d6629988b` (hold the land when git cannot tell it is
mid-merge), `f1ab8a344` (log the recovery patch a skip wrote), `3299000a6` (a refused squash keeps the lead's staged
work), `76df90972` (undo a refused merge on a context that outlives it), `21e3e86e4` (a stale cleanup pass keeps the
debt a merge set).

- `0db43e5af`, `d6629988b` and `76df90972` touch the land path: each gets a test for a checkout-landing run too,
  showing it behaves as before.
- Run: `go test ./pkg/orchestrate -run '<the new test names>'`; the merge's Verify runs the package.

### Task 5: Digest, merge gate and the Verify line
**Depends on:** Task 1 (builds on its run event and dag wire fields), Task 4
**Files:** `cmd/wsh/cmd/wshcmd-jarvisdag.go`, `cmd/wsh/cmd/wshcmd-jarvisdag_test.go`, `pkg/orchestrate/continue_test.go`, `pkg/orchestrate/digest.go`, `pkg/orchestrate/digest_test.go`, `pkg/orchestrate/mergetask.go`, `pkg/orchestrate/mergetask_test.go`, `pkg/orchestrate/queue.go`, `pkg/orchestrate/verify.go`, `pkg/orchestrate/verify_test.go`

Commits: `a93cb8ca1` (digest forwarded failures, held merge gate, Verify fail line), `a19baa3ca` (a held merge gate is
never stale; only engine retries recover), `6231b6970` (finish a `merge --continue` its caller gave up on),
`e89f2ddaf` (`wsh` dag status names why a held merge tip waits).

- Ours already has a merge gate (`MergeGateTs`, `lead-card-merge-gate` scenario, `digest.go` mentions forwarded
  failures): port only what ours lacks, and keep our digest lines' wording where ours already says the same thing.
- The fork's "held merge" in `a93cb8ca1` may lean on early start's held merge: drop any hunk that does.

### Task 6: Scheduler, task states, skip and join
**Depends on:** Task 5
**Files:** `claude/arc-view-mod/testdata/plan-lead-replacement.txt`, `claude/arc-view-mod/testdata/plan-lead.txt`, `cmd/wsh/cmd/wshcmd-jarvisdag.go`, `cmd/wsh/cmd/wshcmd-jarvisdag_test.go`, `pkg/jarvis/leadprompt.go`, `pkg/orchestrate/dag.go`, `pkg/orchestrate/dag_test.go`, `pkg/orchestrate/engine.go`, `pkg/orchestrate/lane.go`, `pkg/orchestrate/leadclose.go`, `pkg/orchestrate/mutation.go`, `pkg/orchestrate/mutation_test.go`, `pkg/orchestrate/outcome.go`, `pkg/orchestrate/outcome_test.go`, `pkg/orchestrate/progress.go`, `pkg/orchestrate/progress_test.go`, `pkg/orchestrate/rewind_test.go`, `pkg/orchestrate/scheduler.go`, `pkg/orchestrate/scheduler_test.go`, `pkg/orchestrate/suspect_test.go`, `pkg/orchestrate/verify_test.go`

Commits: `f2f866e4d` (classify task states in one table in `dag.go`), `f26d786f8` (a join waits for every lane it
depends on to merge), `c245d90ed` (auto-retry cancels the failed worker's run), `b13e2eb92` (skip stops a running or
reviewing task), `98cd26122` (see decision 5: skipped unless shown needed).

- `f2f866e4d` is a refactor: the table must classify every state exactly as ours does today, including any state ours
  has and the fork does not; a test enumerates every `TaskState_*` constant against the old answers.
- `b13e2eb92` changes the lead prompt: update `claude/arc-view-mod/testdata` only by adding the new line, and run
  `npx vitest run claude/arc-view-mod` to keep the view mod's fixtures matching.

### Task 7: Run events, final stage outcome, lead relay and Rerun
**Depends on:** Task 6
**Files:** `cmd/wsh/cmd/wshcmd-jarvisdag.go`, `cmd/wsh/cmd/wshcmd-jarvisdag_test.go`, `pkg/jarvis/leadprompt.go`, `pkg/jarvis/leadprompt_test.go`, `pkg/orchestrate/actionlock_test.go`, `pkg/orchestrate/autonomous.go`, `pkg/orchestrate/circuitbreakdispatch_test.go`, `pkg/orchestrate/final.go`, `pkg/orchestrate/final_test.go`, `pkg/orchestrate/finalend_test.go`, `pkg/orchestrate/laneschedule_test.go`, `pkg/orchestrate/leadsteer_test.go`, `pkg/orchestrate/leftbehind_test.go`, `pkg/orchestrate/modelroute_test.go`, `pkg/orchestrate/mutation.go`, `pkg/orchestrate/mutation_test.go`, `pkg/orchestrate/outcome_test.go`, `pkg/orchestrate/plancmd.go`, `pkg/orchestrate/plancmd_test.go`, `pkg/orchestrate/queue.go`, `pkg/orchestrate/queue_test.go`, `pkg/orchestrate/rewind_test.go`, `pkg/wshrpc/wshserver/wshserver_dag.go`, `pkg/wshrpc/wshserver/wshserver_jarvis.go`, `pkg/wshrpc/wshserver/wshserver_jarvis_test.go`, `pkg/wstore/wstore_runevent.go`, `pkg/wstore/wstore_runevent_test.go`

Commits (Go parts; the TS parts are Task 14's): `dcd0ea248` (record the final stage's outcome as a final-ended event),
`c3a7aa5fa` (run event kinds, merge gate and Verify lines in `wsh`), `c408b2cd1` (action run events; Rerun answers the
lead), `d977d702f` (take-over answers the lead's relay of the question), `b2cc11cbf` (a stopped final stage's result
never ends its rerun), `a61a68c95` (read the whole run history, strip ANSI from the last line).

- Ours has its own final-stage rerun (`76912e3f1`: a Check or Verify exit 3 and a killed step are no verdict): keep
  that rule; `b2cc11cbf` fits around it.

### Task 8: Plan review rounds, worker priority and project, resume in a new tab
**Depends on:** Task 7, Task 2, Task 3
**Files:** `claude/arc-view-mod/testdata/lead-goal-autonomous.txt`, `claude/arc-view-mod/testdata/lead-goal.txt`, `claude/arc-view-mod/testdata/plan-reviewer-second.txt`, `claude/arc-view-mod/testdata/plan-reviewer.txt`, `pkg/agentsessions/agentsessions.go`, `pkg/agentsessions/extractsession_test.go`, `pkg/jarvis/leadprompt.go`, `pkg/jarvis/leadprompt_test.go`, `pkg/jarvis/plan.go`, `pkg/jarvis/plan_test.go`, `pkg/jarvis/runexec.go`, `pkg/jarvis/runexec_test.go`, `pkg/orchestrate/engine.go`, `pkg/orchestrate/engine_test.go`, `pkg/orchestrate/interrupted.go`, `pkg/orchestrate/interrupted_test.go`, `pkg/orchestrate/maintest_test.go`, `pkg/orchestrate/planreview.go`, `pkg/orchestrate/planreview_test.go`, `pkg/orchestrate/planreviewlens_test.go`, `pkg/orchestrate/planreviewpicks_test.go`, `pkg/orchestrate/planreviewround2_test.go`, `pkg/orchestrate/review.go`, `pkg/orchestrate/review_test.go`, `pkg/orchestrate/stagesession.go`, `pkg/orchestrate/stagesession_test.go`, `pkg/orchestrate/workerpriority_test.go`, `pkg/util/jobobject/jobobject_other.go`, `pkg/util/jobobject/jobobject_windows.go`, `pkg/util/jobobject/jobobject_windows_test.go`, `pkg/wshrpc/wshserver/wshserver_dag.go`, `pkg/wshrpc/wshserver/wshserver_landing_test.go`

Commits: `ff9e86dd2` (keep earlier plan-review rounds' reviewers on the dag), `09d6aef7c` (refuse a plan revision past
the review limit before committing), `ac548aa57` (plan review edges, caller grep, leaner launches), `04aea9b2c` (run
workers and reviewers at below-normal priority), `da342d465` (workers carry their project; usage counted once),
`c31e2dfd6` (a failed resume in a new tab stops the tab it spawned), `e1c8645bd` (… and puts the closed tab back),
`5e7ef9081` (tests keep worker spawns out of the real claude config).

- Ours runs two round-1 plan reviewers (Full review, Second): `ff9e86dd2` keeps the earlier rounds' reviewers beside
  them, it does not change round 1.
- `04aea9b2c`: also run `GOOS=darwin go build ./pkg/...` (decision 9).
- `ac548aa57`'s prompt changes update `claude/arc-view-mod/testdata` as in Task 6; `npx vitest run claude/arc-view-mod`.

### Task 9: Landing seal and dag submit
**Depends on:** Task 8, Task 4
**Files:** `pkg/gitinfo/gitinfo.go`, `pkg/jarvis/evidence.go`, `pkg/jarvis/evidence_test.go`, `pkg/orchestrate/land.go`, `pkg/orchestrate/land_test.go`, `pkg/orchestrate/snapshot.go`, `pkg/wshrpc/wshserver/wshserver_dag.go`, `pkg/wshrpc/wshserver/wshserver_landing_test.go`

Commits: `c1998c0d0` (seal a branch run's uncommitted work from its landing tree), `9814ea56c` (seal a landed run from
its merge, not its missing tree), `49c31729f` (seal from the branch tip its land recorded), `9f09d083f` (decide a dag
submit before touching the landing tree).

- All four were written after the fork removed checkout landing. Each gets tests for both landing modes; a
  checkout-landing run seals and submits exactly as it does today.
- `9814ea56c` adds a helper to `gitinfo.go`: add it, change no existing function there.

### Task 10: wshserver: run log, lead land reply, profile check, adopt reason
**Depends on:** Task 1 (builds on its runs and agentsync reply fields)
**Files:** `cmd/wsh/cmd/wshcmd-agentsync.go`, `cmd/wsh/cmd/wshcmd-jarvis.go`, `pkg/wshrpc/wshserver/wshserver_agentsync.go`, `pkg/wshrpc/wshserver/wshserver_agentsync_test.go`, `pkg/wshrpc/wshserver/wshserver_childrun_test.go`, `pkg/wshrpc/wshserver/wshserver_leadcomplete_test.go`, `pkg/wshrpc/wshserver/wshserver_reviewer_settings_test.go`, `pkg/wshrpc/wshserver/wshserver_runs.go`, `pkg/wshrpc/wshserver/wshserver_runsettings.go`

Commits: `c37355faa` (record child-created on the parent run's log), `43ba106a9` (carry a lead's land past a failed
complete in its reply), `6b693bb55` (validate the global profile's width and worker route), `969ae84ec` (carry a
failed adopt's reason in the reply; decision 7).

- `6b693bb55` validates settings ours accepts today: refuse only values ours cannot run with (a width or route ours
  would fail on later); a saved profile that works today still saves.

### Task 11: wshutil routing and connection teardown
**Depends on:** none
**Files:** `pkg/web/ws.go`, `pkg/wshutil/wshrouter.go`, `pkg/wshutil/wshrouter_rpcmap_test.go`, `pkg/wshutil/wshrpc.go`, `pkg/wshutil/wshrpc_cancel_test.go`, `pkg/wshutil/wshrpc_sendcommand_test.go`, `pkg/wshutil/wshutil.go`, `pkg/wshutil/wshutil_conn_test.go`

Commits: `77e8981e2`, `19ec190db`, `bd59fc337`, `cceba5f02`, `f238499ca`, `e0af2c88f`, `a7a346710`, `e7978e227`,
`13d7f66d8`, `1b6048399`, `1d67a3d29` (fail or move a gone link's in-flight requests, drop routing entries on cancel
and timeout, error on an unencodable response, close the error channel cleanly).

- This is the spine every process talks through. Port in the fork's order, running
  `go test ./pkg/wshutil ./pkg/web -race` (with the cgo env above) after each commit, not only at the end.
- `a7a346710` removes a per-link reap from `ws.go` because `UnregisterLink` now does it: remove it only after the
  `UnregisterLink` change from `77e8981e2` is in and tested.

### Task 12: Transcript tailer and ask wait
**Depends on:** none
**Files:** `pkg/wshrpc/wshserver/transcript.go`, `pkg/wshrpc/wshserver/transcript_test.go`, `pkg/wshrpc/wshserver/wshserver_ask.go`, `pkg/wshrpc/wshserver/wshserver_ask_test.go`

Commits: `3855fa5fe` (advance the transcript tailer by the bytes it read), `7e19941e8` (read transcript tails and
heads without the whole file), `e26c57a74` (end an ask wait by claiming its own ask, not the block's).

- Ours streams Claude's reply into Chat from the transcript (`05485e953`): after porting, run the Chat streaming
  tests (`npx vitest run frontend/app/view/agents -t stream`) and the Go transcript tests.

### Task 13: DAG modal and graph
**Depends on:** Task 1
**Files:** `cmd/wsh/cmd/wshcmd-ui.go`, `frontend/app/cockpit/actions/run.test.ts`, `frontend/app/cockpit/actions/run.ts`, `frontend/app/view/agents/routepicker.tsx`, `frontend/app/view/agents/runrailsections.tsx`, `frontend/app/view/jarvis/address.test.ts`, `frontend/app/view/jarvis/address.ts`, `frontend/app/view/jarvis/briefrunsheet.tsx`, `frontend/app/view/jarvis/briefsheet.tsx`, `frontend/app/view/jarvis/openref.test.ts`, `frontend/app/view/jarvis/openref.ts`, `frontend/app/view/jarvis/peekstore.ts`, `frontend/app/view/jarvis/petview.tsx`, `frontend/app/view/jarvis/runsheet.tsx`, `frontend/app/view/orchestrate/dagcanvas.test.ts`, `frontend/app/view/orchestrate/dagcanvas.ts`, `frontend/app/view/orchestrate/daggraph-header.tsx`, `frontend/app/view/orchestrate/daggraph.tsx`, `frontend/app/view/orchestrate/dagmodal.tsx`, `frontend/app/view/orchestrate/dagmodalstate.test.ts`, `frontend/app/view/orchestrate/dagmodalstate.ts`, `frontend/app/view/orchestrate/dagnodes.tsx`, `frontend/app/view/orchestrate/dagstore.test.ts`, `frontend/app/view/orchestrate/dagstore.ts`, `frontend/app/view/orchestrate/taskcorrelate.test.ts`, `frontend/app/view/orchestrate/taskcorrelate.ts`, `frontend/app/view/orchestrate/taskroute.test.ts`, `frontend/app/view/orchestrate/taskroute.ts`, `frontend/app/view/orchestrate/timelinerail.tsx`, `scripts/cdp/scenarios-kael1113-dag.mjs`, `skills/cockpit/SKILL.md`

Commits: `7477f4a27` (ended and plan-review dags state what is true on the graph), `072d27962` (graph keys yield to
modals, refit on resize, stage line wraps), `06ef4d9c4` (the DAG modal takes its owner from the dag; decision 6),
`aca599018` (Adjust run settings from the DAG modal header), `c3d092f4f` (Cancel in the header while the dag is
blocked), `8c544f72c` (the graph's arrows stay out of a route picker), `7c9976ed1` and `92b5b04fa` (a modal above the
DAG modal owns Escape and Tab), `c4f14e608` (clear a timeline hover when the rail unmounts).

- Every existing DAG and Jarvis binding stays; the key fixes only stand a DAG key down while a modal above it has focus.
- `06ef4d9c4` edits `skills/cockpit/SKILL.md` (ours' source; never the copy under `cmd/wsh/cmd/claude-mod`).
- Scenario `kael1113-dag-modal`: seed an ended dag and a blocked dag; open the DAG modal on each; shot and assert the
  graph states the ended state, the header shows Cancel on the blocked one, Adjust opens the run settings; open the
  route picker above the modal and assert Tab and Escape reach the picker, not the graph.

### Task 14: Timeline, run events and tree lanes
**Depends on:** Task 13
**Files:** `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/agents/agenttreemodel.test.ts`, `frontend/app/view/agents/agenttreemodel.ts`, `frontend/app/view/agents/cockpitevents.test.ts`, `frontend/app/view/agents/cockpitevents.ts`, `frontend/app/view/agents/cockpiteventsrail.tsx`, `frontend/app/view/agents/endedtranscript.tsx`, `frontend/app/view/agents/runeventstore.ts`, `frontend/app/view/agents/runlineage.test.ts`, `frontend/app/view/agents/runlineage.ts`, `frontend/app/view/agents/runlineagestore.ts`, `frontend/app/view/agents/runrail.test.ts`, `frontend/app/view/agents/runrail.ts`, `frontend/app/view/agents/runrailsections.tsx`, `frontend/app/view/agents/runtimeline.test.ts`, `frontend/app/view/agents/runtimeline.ts`, `frontend/app/view/orchestrate/dagdigest.test.ts`, `frontend/app/view/orchestrate/dagdigest.ts`, `frontend/app/view/orchestrate/dagmodal.tsx`, `frontend/app/view/orchestrate/dagnodes.tsx`, `frontend/app/view/orchestrate/taskroute.test.ts`, `frontend/app/view/orchestrate/taskroute.ts`, `frontend/app/view/orchestrate/timelinegroups.test.ts`, `frontend/app/view/orchestrate/timelinegroups.ts`, `frontend/app/view/orchestrate/timelinerail.tsx`, `scripts/cdp/scenarios-kael1113-timeline.mjs`

Commits: `652fa1a3d` (ended runs, drawer strip, row targets and event counts), `8d14dca57` (timeline groups keyed by
their first event, in arrival order), `a728ee85d` (the open Lifecycle drawer leaves the graph the larger share),
`9d633e0a0` (failed tones and merge gate rows in the tree and rail lanes), `5459268f8` (a failed digest refresh is
stale and retried), and the TS parts of `dcd0ea248`, `7378b15a4`, `c3a7aa5fa` and `a61a68c95` (decision 4).

- The fork's `peeklifecycle.ts` does not exist in ours: put its pure part beside our timeline model if ours has no
  equivalent, with its test.
- `1feb637d5` (drop the lane label) is not in this plan; keep ours' lane label.
- Scenarios: `kael1113-timeline` (seed a run with final-ended, action and forwarded-failure events; open the timeline;
  assert groups in arrival order, the event counts, the Lifecycle drawer leaving the graph the larger share);
  `kael1113-tree-lanes` (seed a run with a failed task and a held merge gate; assert the failed tone and the merge gate
  row in the Agent tree and the rail lanes).

### Task 15: Final stage and peeks
**Depends on:** Task 14
**Files:** `frontend/app/view/agents/finalstage.test.ts`, `frontend/app/view/agents/finalstage.ts`, `frontend/app/view/agents/finalstagepane.tsx`, `frontend/app/view/agents/finalstagerail.tsx`, `frontend/app/view/agents/finalstageviews.tsx`, `frontend/app/view/agents/route.ts`, `frontend/app/view/agents/routepicker.test.ts`, `frontend/app/view/agents/routepicker.tsx`, `frontend/app/view/agents/runcompletion.test.ts`, `frontend/app/view/agents/runcompletion.ts`, `frontend/app/view/agents/runlineage.test.ts`, `frontend/app/view/agents/runlineage.ts`, `frontend/app/view/agents/runlineagestore.ts`, `frontend/app/view/jarvis/finalshotsmodel.test.ts`, `frontend/app/view/jarvis/finalshotsmodel.ts`, `frontend/app/view/jarvis/finalshotsviewer.tsx`, `frontend/app/view/jarvis/runsheet.tsx`, `frontend/app/view/jarvis/runsheetmodel.test.ts`, `frontend/app/view/jarvis/runsheetmodel.ts`, `frontend/app/view/orchestrate/dagfinalpeek.tsx`, `frontend/app/view/orchestrate/dagpeek.test.ts`, `frontend/app/view/orchestrate/dagpeek.ts`, `frontend/app/view/orchestrate/dagtaskpeek.tsx`, `frontend/app/view/orchestrate/recoverysummary.test.ts`, `frontend/app/view/orchestrate/recoverysummary.ts`, `frontend/app/view/orchestrate/timelinegroups.test.ts`, `frontend/app/view/orchestrate/timelinegroups.ts`, `scripts/cdp/scenarios-kael1113-final.mjs`

Commits: `362ec28e7` (cancelled Final node, earlier-round details, empty shots), `cff274e28` (sub-second steps read
<1s; the Verifier step opens…), `9f9b2f3e9` (runs rows, DAG peek and stage pane read the merge gate; the fork's "Hub
rows" are Jarvis's Runs), `1c535bc98` (task peek review note, worked time, clean Verify tail), `932d4fa34` (recovery
line counts only the engine's retries).

- Ours' final stage has its own rerun and exit-3 handling: the views keep showing them as now.
- Scenario `kael1113-final-stage`: seed a run whose Final was cancelled after an earlier failed round, with a step under
  a second and no shots; assert the cancelled node, the earlier round's details, "<1s", the empty-shots state, and the
  merge gate line in the Runs row and the DAG peek.

### Task 16: Changelog, hand checks and the orchestrator guide
**Depends on:** Task 9 (reads the engine chain's commit notes), Task 2 (reads its refusals), Task 3 (reads its commit notes), Task 10 (reads its commit notes), Task 11 (reads its commit notes), Task 12 (reads its commit notes), Task 15 (reads the view chain's commit notes)
**Files:** `CHANGELOG.md`, `docs/hand-checks.md`, `docs/guide/orchestrator.md`, `docs/open-issues.md`

1. Read every task's commit bodies ("Differs from plan" and any change listed for this task).
2. `CHANGELOG.md`, under the top `Unreleased` section: one line each for what a user notices (the DAG modal's ended and
   blocked states and Cancel, Adjust from the header, timeline order and counts, failed tones and merge gate rows in
   the tree, the final stage's cancelled node and "<1s", plans refused with a clear reason, workers at below-normal
   priority). Internals stay out.
3. `docs/guide/orchestrator.md`: what changed for someone running the engine (plan parsing refusals that were taken,
   the merge gate and Verify lines in `wsh runs show` / dag status, skip stopping a running task, lower worker
   priority). Take the fork's `docs/orchestrator-guide.md` hunks from these commits where they describe something
   ported; checkout landing stays documented.
4. `docs/hand-checks.md`: a `- [ ] (arcterm) Kael sync 11-13: …` line for each thing no scenario proves: a real run
   whose land is refused mid-merge and undone, a resume that fails in a new tab, worker priority seen in Task Manager
   or Activity Monitor, an RPC client dropped mid-call (Task 11).
5. `docs/open-issues.md`: one line per skipped commit the owner should decide (at least `98cd26122` and any refusal
   Task 2 skipped), titled "(arcterm) …".
6. Commit by pathspec (`docs: Kael sync 11-13 step 1 changelog, guide and hand checks`).
