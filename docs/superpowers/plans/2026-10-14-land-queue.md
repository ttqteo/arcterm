# Land queue implementation plan

**Verify:** `node scripts/verify.mjs ./pkg/orchestrate ./pkg/runqueue ./pkg/jarvis ./pkg/waveobj ./pkg/wshrpc/... ./cmd/wsh/...`

**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`

**Final:** `node scripts/cdp/final-verify.mjs land-queue surface-smoke`

**Goal:** several runs that finish close together land one after another by themselves, instead of each one after
the first being held for a human to merge `main` into its branch and press Land again; and a queued run waiting
`--after` a held run starts once that run is landed anyway.

**Why (effort `fd79f265`, 2026-10-14):** five arcterm runs finished within a few hours (dfad20dc, ffadbfbf, ee18a780,
973afb5b, 961cdb3d) and each needed one or two hand-made "Merge main into wave/<run>" commits before it landed
(4d960f3eb, 3349fdf40, feaab3280, dc53b11e6, 703d28940, 9f654ab1d, 5c2097331). The conflicting files were mostly
lines both sides only added: `CHANGELOG.md` (3), `docs/open-issues.md` (4), `scripts/cdp/scenarios.mjs` (4); the rest
were real overlaps. In the code:

- `landRun` (`pkg/orchestrate/land.go:168`) holds with "project checkout is busy" when `claimProject` finds another
  land in the checkout (`land.go:184-187`). That hold is not `Dirty`, so nothing retries it.
- `reverifyHold` (`land.go:424`, called at `land.go:180`) runs Check and Verify before the claim, so two lands at
  once are each checked against the base as it was before the other merged.
- A base that moved and conflicts holds the land; only a human merges the base into `wave/<run>`.
- A queued start (`pkg/runqueue`) whose `--after` run ended held is blocked (`pkg/runqueue/rules.go:115`), and
  `Next` skips blocked entries (`rules.go:98`). Nothing sets it waiting again when that run is later landed with Land
  again or `wsh runs land --force`.

**Decisions (the effort's Decide chunks, all accepted):**

1. One land line per project checkout (key: `filepath.Clean(run.ProjectPath)`, the same key as `claimProject`), in
   the order lands are asked for. A land whose turn has not come is `queued`, not held.
2. A real conflict with the base starts one **resolver** session (a stage session, like the final verifier) in the
   run's landing tree. One attempt per land; if it fails the land is held, and the reason names the conflicting
   files.
3. Conflicts where both sides only **added** lines, in files the project lists in a checked-in `.arc/union-merge`, are
   resolved by the engine: the base's added lines first (they landed first), then the run's. No `.gitattributes`
   `merge=union`, so a human's own merges are untouched.
4. Landing a held run later (Land again, `wsh runs land [--force]`) puts the queued starts blocked on it back to
   waiting, automatically, even when it landed past a failed final stage.

**Architecture:** `RunLand` gains two states, `queued` and `resolving`. `LandRun` takes the project's turn when the
line is free and lands at once as today; otherwise it saves `queued` and returns. A land driver, run by the watchdog
tick (every 30 s) and kicked whenever a land ends, gives the turn to the oldest `queued` land of each project. Inside
the turn the land first merges the base into `wave/<run>` in the landing tree (resolving add-only conflicts in listed
files, or handing a real conflict to a resolver), then re-runs Check and Verify on that commit, then merges into the
checkout as today. The run queue marks an entry blocked by its `--after` run with `BlockedOn`, and puts it back to
waiting once that run lands.

**Tech stack:** Go (pkg/orchestrate, pkg/runqueue, wshserver, wsh), `task generate`, React/TS pure models + vitest, the
CDP scenario harness.

Rules every task keeps (AGENTS.md): never hand-edit generated files (`task generate` writes them); comments say why,
lowercase, minimal, in the surrounding style; check only the files you touched with gofmt/prettier, never `--write`
the tree, never prettier on `scripts/*.mjs`; no raw hex in `.ts`/`.tsx`. Do **not** add new `RunStageKey` values in
`frontend/app/view/agents/runstage.ts`: run aeae1cdf (run office) reads that union; `queued` and `resolving` stay
under the existing `landing` key with their own labels.

---

### Task 1: The new land states and queue fields

**Depends on:** none

**Files:** `pkg/waveobj/wtype.go`, `pkg/orchestrate/land.go`, `pkg/runqueue/rules.go`, `pkg/runqueue/consts_test.go`, `pkg/wshrpc/wshrpctypes_runqueue.go`, `pkg/jarvis/usage.go`, `frontend/types/gotypes.d.ts`

- Modify: `pkg/waveobj/wtype.go:331-344` (`RunLand`)
- Modify: `pkg/orchestrate/land.go:28-33` (land state consts)
- Modify: `pkg/runqueue/rules.go:13-19` (spelled-out consts) and `pkg/runqueue/consts_test.go`
- Modify: `pkg/wshrpc/wshrpctypes_runqueue.go` (`RunQueueEntry`)
- Modify: `pkg/jarvis/usage.go` (a usage role for the resolver)
- Regenerate: `task generate` (writes `frontend/types/gotypes.d.ts` and the other generated files)

**Step 1:** Add to `RunLand`:

```go
	// QueuedTs is when a queued land asked for its project's turn; the line is in this order. A land that goes back
	// in line (its turn found the checkout claimed, or its resolver finished) keeps its first QueuedTs.
	QueuedTs int64 `json:"queuedts,omitempty"`
	// Resolver is the run id of the session merging the base into wave/<run> while State is resolving, and
	// ResolverTs when it started. ResolverTried stays set on every later RunLand of the run: one resolver per land.
	Resolver      string   `json:"resolver,omitempty"`
	ResolverTs    int64    `json:"resolverts,omitempty"`
	ResolverTried bool     `json:"resolvertried,omitempty"`
	Conflicts     []string `json:"conflicts,omitempty"` // the files the base merge conflicted in
	// Fixture marks a land a CDP scenario seeded to draw its state: the land driver never tends it (Task 3, Task 5).
	// Only scripts/cdp/scenarios.mjs writes it, through object.UpdateObject.
	Fixture bool `json:"fixture,omitempty"`
```

and update the `State` comment to `pending | queued | resolving | landed | held`.

**Step 2:** In `land.go` add `LandState_Queued = "queued"` and `LandState_Resolving = "resolving"`. In
`pkg/jarvis/usage.go` add `UsageRole_LandResolver = "land-resolver"` beside `UsageRole_Verifier`, with a comment in
the same style (it is a run's StageRole as well). If usage roles are listed anywhere for display (grep
`UsageRole_Verifier` in `pkg/` and `frontend/app/`), add the new one there too.

**Step 3:** In `RunQueueEntry` add, after `Reason`:

```go
	BlockedOn string `json:"blockedon,omitempty"` // the run whose outcome blocked it; set only for that kind of block
```

**Step 4:** Run `task generate`. Run `go build ./...` and the Check command. Both must pass.

**Step 5:** Run `go test ./pkg/runqueue ./pkg/waveobj` (consts_test.go must still pass). Commit.

---

### Task 2: Add-only conflict resolution

**Depends on:** none

**Files:** `pkg/orchestrate/landunion.go`, `pkg/orchestrate/landunion_test.go`, `.arc/union-merge`

- Create: `pkg/orchestrate/landunion.go`
- Create: `pkg/orchestrate/landunion_test.go`
- Create: `.arc/union-merge`

**Step 1: Write the failing tests** in `landunion_test.go` for a pure function
`resolveAddOnly(merged string) (string, bool)`. Its input is the output of
`git merge-file -p --diff3 -L run -L base -L landed <run> <base> <landed>`: conflict blocks are
`<<<<<<< run` … `||||||| base` … `=======` … `>>>>>>> landed`. Cases:

- one block whose base part is empty → the block becomes the `landed` lines then the `run` lines; returns true;
- two such blocks in one file → both replaced, the text between them kept;
- a block whose base part has a line (a real edit on either side) → returns `"", false`;
- no block at all → returned unchanged, true;
- CRLF lines keep their `\r`.

Also test `unionPaths(content string) []string`: one path per line, blank lines and `#` comments skipped, spaces
trimmed, `\` turned into `/`.

**Step 2:** Run `go test ./pkg/orchestrate -run 'TestResolveAddOnly|TestUnionPaths'` and see them fail.

**Step 3: Implement** both, plus the git half:

- `unionMergePaths(ctx, project, baseBranch string) []string`: `git show <baseBranch>:.arc/union-merge` in the project
  checkout, parsed by `unionPaths`; a missing file is an empty list.
- `resolveAddOnlyFile(ctx, tree, path string) (bool, error)`: for an unmerged path in `tree`, read stages `:1:`
  (missing when both sides added the file: use empty), `:2:` (the run, the branch checked out in the landing tree)
  and `:3:` (the base being merged in) with `git show :N:<path>`, write them to temp files, run
  `git merge-file -p --diff3 -L run -L base -L landed <2> <1> <3>` (exit code is the conflict count, not an
  error), pass its output to `resolveAddOnly`; on true write the result to the path and `git add` it.

**Step 4:** Add a temp-repo test `TestResolveAddOnlyFileInRealMerge`: a repo where `main` and a branch each append a
different line to `CHANGELOG.md` at the same spot, `git merge main` from the branch conflicts, and
`resolveAddOnlyFile` leaves `main`'s line then the branch's, staged. Use the helpers the package's existing git tests
use (grep `t.TempDir()` with `git init` in `pkg/orchestrate/*_test.go`).

**Step 5:** Create `.arc/union-merge`:

```
# files whose conflicts the land resolves when both sides only added lines: the base's lines, then the run's
CHANGELOG.md
docs/open-issues.md
scripts/cdp/scenarios.mjs
```

**Step 6:** Run the tests; they pass. Commit.

---

### Task 3: The land line

**Depends on:** Task 1

**Files:** `pkg/orchestrate/landline.go`, `pkg/orchestrate/landline_test.go`, `pkg/orchestrate/land.go`, `pkg/orchestrate/watchdog.go`, `pkg/waveobj/runevent.go`

- Create: `pkg/orchestrate/landline.go`
- Create: `pkg/orchestrate/landline_test.go`
- Modify: `pkg/orchestrate/land.go` (`LandRun`, `landRunLocked`, `landRun`, `retryDirtyLands`)
- Modify: `pkg/orchestrate/watchdog.go:75` (call the driver beside `retryDirtyLands`)

**Behaviour:**

- In-memory `landTurns` (mutex + `map[string]string` project key → run id holding the turn). `tryTakeTurn(project,
  runID) bool` never blocks; `releaseTurn(project, runID)`; key `filepath.Clean(project)`.
- `LandRun` (still under `landLocks.Lock(runID)`): after the existing early returns, it takes the turn only when the
  turn is free **and** no `queued` land of the same project is older (read `wstore.GetRunsByLandState(ctx,
  LandState_Queued)`, filter by project key). Then it lands as today and releases the turn, then kicks the driver
  (`go driveLandLine(context.Background())`). Otherwise it saves `RunLand{State: queued, QueuedTs: now, Force: force,
  ResolverTried: <previous land's>}`, appends a run event (add `RunEventKindLandQueued` beside `RunEventKindLandHeld` in
  `pkg/waveobj/runevent.go`, with `{"ahead": n}`), and returns that land with no error.
- `driveLandLine(ctx)`: guarded so only one pass runs at a time (an atomic flag; a pass that finds it set returns).
  For each project with `queued` lands, if `tryTakeTurn` succeeds for the oldest (by `QueuedTs`, then run id), and
  `landLocks.TryLock(run.ID)` succeeds (else release the turn), run the land in `goStage("land "+run.ID, …)` under
  `LandTimeout` with `context.WithoutCancel`, using `landRunLocked` with `run.Land.Force`; then unlock, release the
  turn, and drive again.
- Inside `landRun`, `claimProject` busy (`errors.Is(err, errProjectBusy)`) no longer holds: it returns a `queued`
  land, and `landRunLocked` keeps the run's original `QueuedTs` (or now, if it had none) so it stays first in line.
- `landRunLocked` carries `Force` and `ResolverTried` from the previous `run.Land` into the land it writes (today it
  carries only `Force`, and only on a hold).
- `retryDirtyLands`: when the precheck passes, instead of landing in place, write `queued` (QueuedTs now, Force and
  ResolverTried kept) and let the driver land it.
- On the first driver pass after wavesrv starts, a run whose land is `pending` with no turn held for it (the server
  died mid-land) goes back to `queued` with its `QueuedTs` set to now. Add `LandState_Pending` lands to that scan
  only on the first pass (a `sync.Once`).
- Every scan of the driver (queued, the first pass's pending, and Task 5's resolving) and `LandRun`'s older-queued
  check skip a land with `Fixture` set: a CDP scenario seeds those to draw the states, on runs that have no branch to
  land. Test it in `TestLandLineSkipsFixture`: a `queued` and a `pending` fixture land are unchanged after a drive
  (the pending one on the first pass too).
- Watchdog: call `driveLandLine(ctx)` right after `retryDirtyLands(ctx)` (`watchdog.go:75`).
- Export `LandPlace(runs []*waveobj.Run, runID string) (place int, ahead *waveobj.Run)`: 1 + the number of runs of the
  same project whose land is `queued` with an older `QueuedTs`, + 1 more if a run of the project is `pending` (in its
  turn); `ahead` is the run just before it. 0 when the run's land is not `queued`. Task 5 and Task 7 use it.

**Step 1: Write the failing tests** in `landline_test.go` (use the package's existing land test fixtures: grep
`LandRun(` in `pkg/orchestrate/*_test.go` for how a done run with a `wave/<id>` branch and a project checkout is set
up):

- `TestLandLineThreeAtOnce`: three done runs in one project, each adding a different file; call `LandRun` for all
  three from goroutines at once; drive the line until none is queued (call `driveLandLine` in a loop with a short
  wait, bounded); all three end `landed`, none `held`, and `git log --first-parent` of the base shows three merge
  commits.
- `TestLandRunQueuesBehindOlder`: with one `queued` land in the project, a fresh `LandRun` of another run returns
  `queued` even though the turn is free, and the older one lands first.
- `TestClaimBusyRequeues`: with the project claimed by `claimProject` (a task merge), a land returns `queued`, keeps
  its `QueuedTs`, and lands once the claim is released and the line is driven.
- `TestDirtyRetryQueues`: a dirty hold whose checkout is clean again becomes `queued`, then lands.
- `TestLandLineSkipsFixture` (above).
- `TestLandPlace`: pure: runs with lands `pending`, `queued`(ts 10), `queued`(ts 20) in one project and a `queued`
  in another → places 0, 2, 3 and 1 with the right `ahead`.

**Step 2:** Run `go test ./pkg/orchestrate -run 'TestLandLine|TestLandRunQueues|TestClaimBusy|TestDirtyRetry|TestLandPlace'`;
they fail.

**Step 3:** Implement. **Step 4:** They pass; then run the land tests already there
(`go test ./pkg/orchestrate -run 'Land'`) and fix what the change broke (a test that expected "project checkout is
busy" as a hold now expects `queued`). **Step 5:** Commit.

---

### Task 4: Merge the base into the run inside its turn

**Depends on:** Task 2, Task 3

**Files:** `pkg/orchestrate/land.go`, `pkg/orchestrate/land_test.go`

- Modify: `pkg/orchestrate/land.go` (`landRun`, `reverifyHold`)
- Test: `pkg/orchestrate/land_test.go` (or the file the existing reverify tests live in: grep `reverifyHold`)

**Behaviour:** in `landRun`, after the final-stage and precheck holds and before `reverifyHold`, call a new
`syncBase(ctx, run) (conflicts []string, reason string)`:

- base (`git rev-parse <BaseBranch>` in the checkout) already an ancestor of the landing tree's HEAD → nothing.
- else, in `run.LandPath` (refuse as today when `MERGE_HEAD` is there),
  `git merge --no-ff -m "Merge <base> into wave/<id> before landing" -m "Arc-Run: <id>" <BaseBranch>`.
- clean → done (the merge commit is on `wave/<id>`).
- conflicts → list them (`git diff --name-only --diff-filter=U`). Every one that is in `unionMergePaths(ctx,
  run.ProjectPath, run.BaseBranch)` goes through `resolveAddOnlyFile`. All resolved → `git commit --no-edit`, done.
  Any left → `git merge --abort` and return the full list of conflicting files.

`landRun` then: conflicts → return a land the caller turns into a resolver (Task 5) — for this task, return
`heldLand("merging <base> into wave/<id> conflicts in <files>; merge it there, then Land again")` with `Conflicts`
set. Remove the `--no-commit` merge and its deferred `merge --abort` from `reverifyHold` (the base is an ancestor now,
so it never runs), keep `baseMoved` false in that case, and keep the rest of `reverifyHold` as it is: Check and Verify
run on the new HEAD, which differs from the verified commit, so they run.

**Step 1: Write the failing tests:**

- `TestLandMergesMovedBase`: run A and run B both append a line to `CHANGELOG.md` and the project has `.arc/union-merge`
  listing it; land A; land B → B is `landed`, `CHANGELOG.md` on the base has A's line then B's, and `wave/<B>` had a
  "Merge … before landing" commit.
- `TestLandRealConflictHolds`: A and B edit the same line of a file not in the list → B is `held`, `Conflicts` names
  the file, the landing tree has no `MERGE_HEAD`, the checkout is untouched.
- `TestLandMovedBaseRechecks`: with a Verify command that fails when a marker file the base added is present, B is
  held with the Verify failure (the re-check runs on the merged commit).

**Step 2:** They fail. **Step 3:** Implement. **Step 4:** They pass, plus `go test ./pkg/orchestrate -run 'Land|Reverify'`.
**Step 5:** Commit.

---

### Task 5: A resolver session for a real conflict

**Depends on:** Task 4

**Files:** `pkg/orchestrate/landresolver.go`, `pkg/orchestrate/landresolver_test.go`, `pkg/orchestrate/land.go`, `pkg/orchestrate/landline.go`, `pkg/orchestrate/launchorigin.go`, `pkg/waveobj/runevent.go`

- Create: `pkg/orchestrate/landresolver.go`
- Create: `pkg/orchestrate/landresolver_test.go`
- Modify: `pkg/orchestrate/land.go` (`landRun`'s conflict branch), `pkg/orchestrate/landline.go` (driver)
- Modify: `pkg/orchestrate/launchorigin.go` if it maps every stage role (it maps `UsageRole_Verifier`; give the
  resolver the same opener treatment or none, following what a missing role does there)

**Behaviour:**

- On conflicts, when the run has a dag and its land has not `ResolverTried`: start a stage session with
  `spawnStageSession(ctx, ctx, g, run, StageSession{Role: jarvis.UsageRole_LandResolver, Label: "land resolver",
  Tree: run.LandPath, Prompt: landResolverPrompt(run, files)})`, and return
  `RunLand{State: resolving, Resolver: <id>, ResolverTs: now, ResolverTried: true, Conflicts: files, QueuedTs: <kept>,
  Force: <kept>}`, with a run event (`RunEventKindLandResolving`, added beside `RunEventKindLandQueued` in
  `pkg/waveobj/runevent.go`, `{"files": files, "resolver": id}`). No dag, or
  already tried, or the spawn fails → the held land of Task 4, its reason ending "; a resolver already tried" or
  "; the resolver could not start: <err>" as the case is.
- `landResolverPrompt`: you are in the landing tree of run <id> (`wave/<id>`); `git merge <BaseBranch>`; it conflicts
  in <files>; resolve each conflict keeping what both sides meant (the base's side already landed; read both sides'
  commits with `git log --oneline <merge-base>..<BaseBranch> -- <file>` and the same for HEAD); for files listed in
  `.arc/union-merge` keep both sides' added lines; run the narrowest test or typecheck that covers the files you
  touched; commit the merge with the default message plus `Arc-Run: <id>`; do not push, do not land, do not edit
  anything unrelated; then end with `wsh jarvis complete --report <file>` where the report says what each conflict
  became. If you cannot resolve it, `git merge --abort` and complete with the report saying why.
- The driver's pass also tends `resolving` lands: the resolver run `done` → if the landing tree's HEAD now has the
  base as an ancestor, the land goes back to `queued` with its kept `QueuedTs` (it lands next in its turn, and its
  Check and Verify run there); otherwise held: "the resolver ended without merging <base>: see its report".
  `stageSessionLost(ctx, g, resolverID, ResolverTs, now)` returning a reason (cancelled, blocked, exited, timed out
  after `ReviewTimeout`) → stop it as a lost stage session is stopped (`stopReviewer`), held with
  "merging <base> into wave/<id> conflicts in <files>, and the resolver <reason>; merge it there, then Land again".
- A `resolving` land does not hold the turn: the next queued land of the project goes meanwhile.
- The driver's `resolving` scan skips a land with `Fixture` set, like its other scans (Task 3); add a
  `resolving` fixture land to the tests below and check it is unchanged after a drive.

**Step 1: Write the failing tests** with the spawn and the session status faked through package vars (follow how
the verifier's tests fake `spawnWorker`/`startWorker`; grep `spawnWorker =` in `pkg/orchestrate/*_test.go`):

- conflict + dag + not tried → `resolving`, one spawn with the role and the landing tree, the prompt names the files;
- conflict + already tried → held, no spawn;
- resolver run done and the tree merged (do the merge in the test) → `queued`, then lands on the next drive;
- resolver run done but no merge → held with "ended without merging";
- resolver lost (status cancelled) → held, `stopReviewer` called.

**Step 2:** They fail. **Step 3:** Implement. **Step 4:** They pass, plus `go test ./pkg/orchestrate -run 'Land|Stage'`.
**Step 5:** Commit.

---

### Task 6: Queued starts carry on after a later land

**Depends on:** Task 1

**Files:** `pkg/runqueue/rules.go`, `pkg/runqueue/runqueue.go`, `pkg/runqueue/rules_test.go`, `pkg/runqueue/runqueue_test.go`, `pkg/wshrpc/wshserver/wshserver_runqueue.go`, `pkg/wshrpc/wshserver/wshserver_runqueue_test.go`

- Modify: `pkg/runqueue/rules.go` (`Next`), `pkg/runqueue/runqueue.go` (`SetBlocked`, `SetWaiting`)
- Modify: `pkg/wshrpc/wshserver/wshserver_runqueue.go` (`nextQueuedStart`, every `SetBlocked` call)
- Test: `pkg/runqueue/rules_test.go`, `pkg/runqueue/runqueue_test.go`, `pkg/wshrpc/wshserver/wshserver_runqueue_test.go`

**Behaviour:**

- `SetBlocked(id, reason, blockedOn string)`: sets `BlockedOn` (empty for every block that is not about the `--after`
  run's outcome: start failed, plan gone, route unavailable, the After entry removed). `SetWaiting` clears it.
- `Next` returns a third value, `unblock []string`: each blocked entry whose `BlockedOn` is a run in `runs` that is now
  landed (`Outcome` final and landed). The block it makes for an After run that ended held or cancelled carries
  `BlockedOn = e.After` (return `block` as `map[string]Block{Reason, On string}` or a second map; pick one and keep
  the callers simple).
- `nextQueuedStart`: also load the runs named by `BlockedOn`; `SetWaiting` each `unblock` id, publish, and evaluate
  again in the same pass so an unblocked entry can start now.
- `Outcome` already treats `pending` as not final; make sure `queued` and `resolving` are not final either (they are
  not `landed` or `held`, so the switch falls through — add the test).
- No `land.go` edit: a land write already pokes the queue loop, since `saveLand` writes through `wstore.UpdateRun`
  and `wstore.RunChangedHook` is `wshserver.PokeRunQueue` (`cmd/server/main-server.go:336`).

**Step 1: Write the failing tests:**

- rules: an entry blocked with `BlockedOn: "r1"` and `r1` now `landed` → in `unblock`; same with `r1` still `held` →
  not; an entry blocked with no `BlockedOn` and `After: "r1"` landed → not (a start failure must not loop);
- rules: `Outcome` of a run whose land is `queued` / `resolving` / `pending` → not final;
- wshserver: queue an entry `--after` a run; hold the run's land (non-dirty) → blocked with `BlockedOn`; then make the
  land `landed` (the test's land seam, `landRun` var, or a direct `UpdateRun`) and poke → the entry starts.

**Step 2:** They fail. **Step 3:** Implement. **Step 4:** `go test ./pkg/runqueue` and
`go test ./pkg/wshrpc/wshserver -run 'RunQueue'` pass. **Step 5:** Commit.

---

### Task 7: `wsh runs` says where a land stands

**Depends on:** Task 3, Task 6

**Files:** `cmd/wsh/cmd/wshcmd-runs.go`, `cmd/wsh/cmd/wshcmd-runs_test.go`

- Modify: `cmd/wsh/cmd/wshcmd-runs.go` (`runsLandRun`, `runsLandLines`, the `list` row's land column if it has one)
- Test: `cmd/wsh/cmd/wshcmd-runs_test.go`

**Behaviour:**

- `runsLandLines`: `queued` → `land     queued: #2 in line, behind <short id> <title>` using `orchestrate.LandPlace`
  over the channel's runs (the command already loads them in `runsFind`; pass them in); `resolving` →
  `land     resolving: a resolver is merging <base> (<files>)`; a held land with `Conflicts` adds a
  `         conflicts: <files>` line.
- `runsLandRun`: `queued` and `resolving` are accepted, exit 0. After a `landed` result, list the queued starts whose
  `After` is this run (`RunQueueListCommand`) as `         queued runs after it start when there is room: q-xxxx
  <title>, …`; none → nothing.

**Step 1:** Failing tests for `runsLandLines` (queued with place and ahead, resolving, held with conflicts) and for the
released line. **Step 2:** Fail. **Step 3:** Implement. **Step 4:** `go test ./cmd/wsh/cmd -run 'Runs'` passes.
**Step 5:** Commit.

---

### Task 8: The cockpit shows a land in line and a land being resolved

**Depends on:** Task 1

**Files:** `frontend/app/view/agents/landline.ts`, `frontend/app/view/agents/landline.test.ts`, `frontend/app/view/agents/runstage.ts`, `frontend/app/view/agents/runmodel.ts`, `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/jarvis/runsheetmodel.ts`, `frontend/app/view/jarvis/runsheet.tsx`, `scripts/cdp/scenarios.mjs`

- Create: `frontend/app/view/agents/landline.ts`, `frontend/app/view/agents/landline.test.ts`
- Modify: `frontend/app/view/agents/runstage.ts` (the `landing` label only), `frontend/app/view/agents/runmodel.ts`
  (`landView`), `frontend/app/view/jarvis/runsheetmodel.ts` and `runsheet.tsx` (the dock line near
  "Not merged back", `runsheet.tsx:1070`, `runsheetmodel.ts:157`), `frontend/app/view/agents/agenttree.tsx` (the run
  row at `agenttree.tsx:697`)
- Modify: `scripts/cdp/scenarios.mjs` (new scenario `land-queue`)

**Behaviour:**

- `landline.ts`: `landPlace(run, runs)` mirroring Go's `LandPlace` (same project path, `queued` older by `queuedts`,
  +1 for a `pending` one), returning `{ place, ahead }`.
- `runStage`: keep the `landing` key for `pending`, `queued` and `resolving`; its label is `Landing`,
  `Landing · in line` and `Landing · resolving conflicts`. `landView` gets `land queued` and `resolving` (tone
  `running`). `dagProgressLabel` takes an optional third argument, the runs of the run's project, and with it a
  queued land reads `Landing · #2 in line`. In `agenttree.tsx` the run row (`agenttree.tsx:697`) passes it the runs
  of its project (the runs its project folder already lists); the run sheet does the same.
- Run sheet dock: `queued` → "In line to land: #2, behind <title>"; `resolving` → "A resolver is merging <base> into
  wave/<id>: <files>"; held with `conflicts` lists them under the reason.
- Scenario `land-queue` in `scripts/cdp/scenarios.mjs`, built on the run fixtures of
  `docs/reference/cdp-run-fixtures.md`. The seam is the `Fixture` flag of Task 1: a land seeded with
  `fixture: true` is never tended by the land driver (Task 3, Task 5), so the states stay as written. Arrange: one
  channel on the temp dir, four `createrun` calls on it (`deferstart: true`, no dag, as `arrangeFixtureRun` does;
  record every run id in `ctx`), a roster fixture with a lead per run (`treeRailRoster`, as `arrangeFixtureRun`
  writes it), then write each run with `fstWriteRun` to `status: "done"` and a land with `fixture: true`:
  `pending`; `queued` with `queuedts` 20; `resolving` with `conflicts: ["CHANGELOG.md"]`; `held` with
  `conflicts: ["docs/open-issues.md"]` and a reason. Reload onto the roster. Steps:
  1. goto the Agent surface; shot the project's tree; assert the rows read `Landing`, `Landing · #2 in line`,
     `Landing · resolving conflicts` and `Land held`.
  2. open the queued run's sheet (`window.__openAddress("run:<id>")`); shot it; assert "In line to land: #2".
  3. open the resolving run's sheet; shot it; assert "A resolver is merging" and `CHANGELOG.md`.
  4. open the held run's sheet; shot it; assert its conflicts line names `docs/open-issues.md`.
  Teardown runs `teardownFixtureRun` for every run made (channel once). Add the scenario to `SCENARIOS`.

**Step 1:** Failing vitest for `landPlace` and for `runStage`'s labels (extend `runstage.test.ts` / `runmodel.test.ts`).
**Step 2:** `npx vitest run frontend/app/view/agents/landline.test.ts frontend/app/view/agents/runstage.test.ts`
fails. **Step 3:** Implement. **Step 4:** They pass; the Check command passes. **Step 5:** Commit. The run's Final runs the `land-queue` scenario
on the merged result, with the driver of Task 3 and Task 5 in it.

---

### Task 9: Lead prompt, docs and changelog

**Depends on:** Task 3, Task 4, Task 5, Task 6, Task 7, Task 8

**Files:** `pkg/jarvis/leadprompt.go`, `docs/guide/orchestrator.md`, `CHANGELOG.md`, `docs/orchestrator-redesign-flaws.md`

- Modify: `pkg/jarvis/leadprompt.go` (where it tells the lead its complete waits on the land, and the failed-final land
  paragraph at `leadprompt.go:106`), and its golden/test if one pins the text (grep the sentence)
- Modify: `docs/guide/orchestrator.md` (Vietnamese, like the rest of it): the land section (`orchestrator.md:449-451`)
  and the blocked-entry paragraph (`orchestrator.md:195`); the tree labels list (`orchestrator.md:279`)
- Modify: `CHANGELOG.md` (top `## Unreleased` section)
- Modify: `docs/orchestrator-redesign-flaws.md` only if an open item there is the busy-checkout or held-after-land-anyway
  problem: mark it fixed the way that file marks fixes

**Content:**

- Lead prompt: complete may report the land `queued` (behind other runs of the project) or `resolving`; that is not a
  failure, and the report says it; the land goes on after the tab closes.
- `orchestrator.md`: runs of one project land one at a time in the order they finish, a land waiting its turn reads
  `Landing · #N in line`; the land merges the base into `wave/<id>` itself and re-runs Check and Verify on it; lines
  both sides only added in the files of `.arc/union-merge` keep both (the base's first); a real conflict gets one
  resolver session, then the land is held naming the files; a queued start blocked because its `--after` run was held
  waits again once that run is landed (Land again or `wsh runs land`), so Start now is no longer needed there.
- `CHANGELOG.md`, under `### Fixed`: one line for "runs that finish together land one after another instead of each
  being held", and one for "a queued run waiting on a held run starts once you land that run anyway"; under
  `### Changed`, one line for the resolver session and `.arc/union-merge`. Written for the user, not copied from
  commit subjects.

**Step 1:** Edit. **Step 2:** `go test ./pkg/jarvis -run 'LeadPrompt'` (or whatever pins the prompt) passes.
**Step 3:** Commit.
