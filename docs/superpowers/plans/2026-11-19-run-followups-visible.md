# To review: what runs leave behind — implementation plan

**Spec:** `docs/superpowers/specs/2026-11-19-run-followups-visible-design.md` (read its "Builder's decisions" first: they settle every open point and every task below follows them)
**Verify:** `node scripts/verify.mjs ./pkg/jarvis ./pkg/jarvisstate ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs surface-smoke brief-run-review`
**Prototype:** D:\work\arcterm\.superpowers\design\run-review-inbox\project\B-strip-sheet.dc.html

Goal: a run's lead files each open issue as a proposed chunk; those proposals stay out of Needs you and show on the
Brief as one To review strip and sheet, grouped by run, where the person ticks items to do (one run for all of them),
keeps them for later or drops them. A one-time `wsh effort backfill-proposed` moves the backlog since 2026-11-13 in.

Architecture: Go owns the meaning of "a proposal names a run" (`jarvis.ProposalRun`), the grouping
(`jarvisstate.RunReview`, sent as `WorkState.RunReview` with the Brief's state), the run start's chunk handling
(`CommandCreateRunData.Chunks`) and the backlog pass. The frontend owns a pure model of the groups (counts, ticks, the
project rule, the goal text), a store, and the strip and sheet views. Task 1 lands every wire type and the shared helper
so the rest run side by side.

Conventions for every task: Go tests on Windows run as
`CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/x -run '^TestName$'` (Bash). Never hand-edit
generated files: change the Go types, then `task generate`. Frontend logic goes in a pure `.ts` with a `.test.ts`
beside it; views are thin. Colors from `@theme` tokens only; motion from `frontend/app/element/motiontokens.ts`. Read
`DESIGN.md` before styling. No attribution trailers in commits.

Lead's wrap-up note: when Final leaves `public/whatsnew/<version>-run-review.webp` in the run's tree, commit it and
change the CHANGELOG line's `<!-- shot: none -->` to `<!-- shot: <that file> -->` (whatsnew.test.ts must still pass).

### Task 1: Wire types and the proposal helper
**Depends on:** none
**Files:** `pkg/wshrpc/wshrpctypes_runs.go`, `pkg/wshrpc/wshrpctypes_effort.go`, `pkg/wshrpc/wshrpctypes_jarvis.go`, `frontend/types/gotypes.d.ts`, `pkg/jarvis/proposal.go`, `pkg/jarvis/proposal_test.go`, `frontend/app/view/jarvis/newrun.ts`

The interfaces every other task builds on. No behaviour changes here.

- `CommandCreateRunData` gains `Chunks []waveobj.RunEffortRef \`json:"chunks,omitempty"\`` (doc: the chunks a run
  started from To review works; applied after a successful start, see the spec's decision 4).
- `CommandEffortCreateData` gains `Proposed bool \`json:"proposed,omitempty"\`` and
  `SourceBlock string \`json:"sourceblock,omitempty"\`` (same meaning as on `CommandEffortMutateData`).
- `WorkState` gains `RunReview []RunReviewGroup \`json:"runreview,omitempty"\``, with
  `RunReviewGroup{RunId, ChannelId, Goal string; CreatedTs int64; Items []RunReviewItem}` and
  `RunReviewItem{EffortOID, EffortTitle, Project, Label string; ProposedTs int64}` (json tags lowercase, as the file's
  other types).
- `pkg/jarvis/proposal.go`: `const ProposedNote = "proposed"` and `func ProposalRun(c waveobj.EffortChunk) string`
  per decision 1 (the `Run` of the newest note whose Text is `proposed`; "" when the chunk is not `proposed` or no
  such note has a Run). Use the constant where `effortops.go` writes the note only if that file needs no other edit
  (Task 4 owns `effortops.go`; leave it alone here).
- `frontend/app/view/jarvis/newrun.ts`: `NewRunPrefill` gains `chunks?: RunEffortRef[]` (a comment: the To review
  chunks a start carries). Nothing reads it yet.
- Run `task generate`; the only generated change expected is `frontend/types/gotypes.d.ts`.

Acceptance: `go test ./pkg/jarvis -run '^TestProposalRun'` covers no note, a note without Run, two proposed notes (the
newest wins), a non-proposed chunk, and a note from the backlog shape (Run set, no Session). `task check:ts` passes.

### Task 2: Leads file proposed; Needs you skips run proposals
**Depends on:** Task 1 (uses `jarvis.ProposalRun` and the `Proposed`/`SourceBlock` fields on `CommandEffortCreateData`)
**Files:** `pkg/jarvis/leadprompt.go`, `pkg/jarvis/leadprompt_test.go`, `pkg/jarvis/attention.go`, `pkg/jarvis/attention_test.go`, `pkg/jarvis/attention_plan_test.go`, `cmd/wsh/cmd/wshcmd-effort.go`, `pkg/wshrpc/wshserver/wshserver_effort.go`, `pkg/wshrpc/wshserver/wshserver_effort_test.go`, `skills/initiatives/SKILL.md`

- Lead prompt's run-finished wrap-up (`leadprompt.go`, the "Add each open issue as a pending chunk…" sentence): a new
  issue is added with `wsh effort chunk add <effort> "<issue>" --proposed`, and the create-when-none-fits fallback is
  `wsh effort create "<title>" --chunk "<issue>" --proposed --parent <topic oid>`. Keep the rest of the rule word for
  word (initiative choice, note-the-duplicate, never a run-named initiative). Say "proposed" where it says "pending".
- `wsh effort create` gains `--proposed` ("propose the seeded chunks; they count once accepted") and sends
  `SourceBlock` (`"block:" + RpcContext.BlockId`, as `chunk add` does) with `Proposed`.
- `EffortCreateCommand`: with `Proposed`, each seeded chunk is `proposed`, and when the derived author has a Session
  (derive it exactly as `noteAuthorFor` does from SourceBlock; factor a helper both use rather than copy it) each gets
  the `proposed` note with Session and Run, as `addChunk` writes it.
- `planReviewItems`: a proposed chunk whose `jarvis.ProposalRun` is non-empty is skipped (not counted, not the
  proposer, not the since). An initiative whose proposed chunks are all run work raises nothing.
- `skills/initiatives/SKILL.md`: the `effort create` line lists `[--proposed]`.

Acceptance (focused tests; name new tests to these filters): `go test ./pkg/jarvis -run
'^(TestOrchestrationRules.*|TestPlanReview.*)$'` — a new `TestOrchestrationRulesFileIssuesProposed` shows the prompt
names `--proposed` for both `chunk add` and `effort create` (update any existing `TestOrchestrationRules*` that quotes
the old sentence); new `TestPlanReview*` cases in `attention_plan_test.go` show `planReviewItems` skips a proposal whose
note names a run (a dag child's run included: any Run value), keeps one with none, and raises nothing for an initiative
of only run proposals; the existing `TestPlanReview*` still pass.
`go test ./pkg/wshrpc/wshserver -run '^TestEffortCreate.*Proposed'` — `Proposed` makes the chunks proposed and
writes the `proposed` note with the source block's session (and run, when the tab belongs to one); without it the
chunks stay pending with no note.

### Task 3: Group run proposals for the Brief
**Depends on:** Task 1 (uses `jarvis.ProposalRun` and the `RunReviewGroup`/`RunReviewItem` types and `WorkState.RunReview`)
**Files:** `pkg/jarvisstate/runreview.go`, `pkg/jarvisstate/runreview_test.go`, `pkg/jarvisstate/fetch.go`

- Pure `func RunReview(efforts []*waveobj.Effort, runs []*waveobj.Run) []wshrpc.RunReviewGroup` per decision 2: active
  or paused initiatives only; each `proposed` chunk with a non-empty `jarvis.ProposalRun`; the run oid resolved to its
  group's run: an engine child (`TaskId`, `Review` or `StageRole` set) maps to the run with the same `DagORef` that has
  none of the three; any other run (a `ParentLeadORef` child included, which owns its own dag) is its own group; an id
  matching no run drops its items. Item `ProposedTs` is that proposed note's Ts. Groups sorted by the run's
  CreatedTs ascending; items by ProposedTs ascending, then label.
- `FetchWorkState` sets `st.RunReview = RunReview(efforts, runs)` when both the runs and efforts legs are healthy.

Acceptance: `go test ./pkg/jarvisstate -run '^TestRunReview'` — grouping by run, oldest run first; a worker's, a
reviewer's and a verifier's proposal land in their dag owner's group; a `ParentLeadORef` child is its own group; a proposal with no run and one whose run is unknown are left
out; a done or archived initiative is left out; a chunk that is no longer proposed is left out; the item carries the
initiative's title and project.

### Task 4: Start a run on ticked chunks, release them where it ends
**Depends on:** Task 1 (uses `CommandCreateRunData.Chunks`)
**Files:** `pkg/wshrpc/wshserver/wshserver_runs.go`, `pkg/wshrpc/wshserver/wshserver_runchunks.go`, `pkg/wshrpc/wshserver/wshserver_runchunks_test.go`, `pkg/jarvisstate/effortlink.go`, `pkg/jarvisstate/effortlink_test.go`

Decisions 3–6 of the spec. No change to `pkg/jarvis/effortops.go`: one batch is validated against the pre-batch effort,
so attaching a run to two chunks of one effort in one batch already passes (decision 5).

- `jarvisstate`: `AttachRunToChunks(ctx, refs []waveobj.RunEffortRef, runORef string) error` — per effort, one
  `effortstore.Update` batch: `setChunkStatus pending` for each chunk that is `proposed`, then `attachWork` for each.
  `DetachRunEverywhere(ctx, runORef string) ([]waveobj.RunEffortRef, error)` — detaches the ref from every chunk of
  every effort holding it and returns the chunks it was on.
- `CreateRunCommand`: validate each `data.Chunks` entry up front (effort exists, chunk resolves) with the same error
  codes as `EffortOID`. When `EffortOID` is empty and Chunks is not, the first chunk is set on `run.EffortRef` only:
  the `effortRef` argument handed to `startCreatedRun` / `finishStartAfterTree` stays nil, so the existing early
  goroutine attach (`startCreatedRun`'s first block) never runs for a To review chunk.
- `wshserver_runchunks.go`: `applyRunChunks(ctx, data, run)` — `AttachRunToChunks` for `data.Chunks`, synchronous, a
  failure logged and not returned. `startCreatedRun` calls it when the plan's dag was submitted, on a deferred start,
  after the first worker spawned, and also in the spawn-failure branch (the run stays persisted, blocked and
  retryable, so it holds its chunks); never on a path that cancels the run or returns before it persists.
  `releaseRunChunks(ctx, run, logPrefix)` — `DetachRunEverywhere`, then for a done run the "Run finished" note
  (`jarvisstate.NoteRunFinished`) on each chunk it was on; falls back to `run.EffortRef` alone when no workref was
  found, so a run from before this change still gets its note. Call it from `sealDoneRunEvidence` (replacing its
  `noteFinishedRunOnChunk` call), from `SealRunEvidenceCommand` (replacing its detach and note), and from both exits of
  `CancelRunCommand`: the dag owner's branch that returns after `orchestrate.Cancel` (the orchestrator path) and the
  plain branch after `UpdateRun` persists the cancel. Remove `noteFinishedRunOnChunk` if nothing calls it any more.
- Keep `startCreatedRun`'s existing single-chunk attach for a request's own `EffortOID` as it is.

Acceptance: `go test ./pkg/jarvisstate -run '^Test(AttachRunToChunks|DetachRunEverywhere)'` — proposed chunks become
pending with the run attached, two chunks of one effort and one of another; a pending chunk stays pending; a later lone
`AttachRunToChunk` of that run to a third live chunk of the first effort is refused `EC-REF-ALREADY-ATTACHED`; detach
clears every one and returns them; the existing `TestDetachRunFromChunk*` still pass. `go test ./pkg/wshrpc/wshserver
-run '^TestRunChunks'` — a deferred start with Chunks leaves them pending and attached with `run.EffortRef` the first;
a refused plan (the cancel path) leaves them proposed with no workref; `releaseRunChunks` detaches every chunk and notes
each for a done run, and only detaches for a cancelled one; `CancelRunCommand` releases the chunks of a dag-owning run
and of a plain one. Use the package's existing store test harness (see `wshserver_effortlink_test.go`). Task 8's step 8
shows the deferred start and the cancel in the running app.

### Task 5: The backlog pass
**Depends on:** Task 1
**Files:** `pkg/wshrpc/wshrpctypes_effort.go`, `pkg/jarvis/backlogproposals.go`, `pkg/jarvis/backlogproposals_test.go`, `pkg/wshrpc/wshserver/wshserver_effortbacklog.go`, `cmd/wsh/cmd/wshcmd-effortbacklog.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

Decision 8.

- Pure `jarvis.PickBacklogProposals(efforts []*waveobj.Effort, runs []*waveobj.Run, since int64) []BacklogProposal`
  (`{EffortOID, Label, RunOID string}`): pending chunk, no workrefs, written on or after `since`, label naming the
  8-character id of a top-level orchestrator run created on or after `since`; the newest such run when it names two.
  `BacklogSince` is 2026-11-13 00:00 local, as a function or var the test can pin.
- RPC `EffortBackfillProposedCommand(ctx) (*CommandEffortBackfillProposedRtnData, error)` returning `{Chunks, Efforts
  int}`, declared beside `EffortBackfillBaseCommand`; the server method lives in the new `wshserver_effortbacklog.go`:
  it loads efforts and every channel's runs, picks, and per effort applies `setChunkStatus proposed` plus a chunk note
  `proposed` through `jarvis.ApplyEffortOpsAs` with `NoteAuthor{Who: "agent", Run: "run:<oid>"}`, in one update per
  effort. Then `task generate`.
- `wsh effort backfill-proposed` in the new `wshcmd-effortbacklog.go` (its own `init()` adds it to `effortCmd`), with
  `--json`; prints "moved N chunks on M initiatives to To review".

Acceptance: `go test ./pkg/jarvis -run '^TestPickBacklogProposals'` — picks a pending chunk naming a recent
orchestrator run; skips an active, blocked or done chunk, one with a workref, one written before the cutoff, one naming a
quick run, a child run or a run older than the cutoff, and an id inside a longer hex string; the newer run takes a label
naming two. A server test (`go test ./pkg/wshrpc/wshserver -run '^TestEffortBackfillProposed'`) shows the chunk becomes
proposed with a note whose `jarvis.ProposalRun` is the run, and a second call changes nothing.

### Task 6: The launcher carries ticked chunks to CreateRun
**Depends on:** Task 1
**Files:** `frontend/app/view/jarvis/newrun.ts`, `frontend/app/view/jarvis/newrun.test.ts`, `frontend/app/view/agents/launcherstore.ts`, `frontend/app/view/agents/launcherstore.test.ts`, `frontend/app/view/agents/launchermodal.tsx`, `frontend/app/view/agents/launcherrun.ts`, `frontend/app/view/agents/launcherrun.test.ts`, `frontend/app/view/agents/runactions.ts`, `frontend/app/view/agents/runactions.test.ts`

Decision 10's plumbing, following the path `specPath` takes today.

- `prefillToLaunch` passes `chunks` through. `launcherstore` keeps a `launcherChunksAtom` set from the prefill and
  cleared by any open without a prefill (so a later New never carries them).
- `CreateRunOpts.chunks?: RunEffortRef[]`; `createRunPayload` sends `chunks` when non-empty, for every mode.
- `launchermodal.tsx` sends them on both start paths (start now, and the queue's `buildCreateRunData`), like
  `specPath`; `launcherrun.ts` maps them the same way.

Acceptance: `npx vitest run frontend/app/view/agents/runactions.test.ts frontend/app/view/jarvis/newrun.test.ts
frontend/app/view/agents/launcherstore.test.ts frontend/app/view/agents/launcherrun.test.ts` — the payload carries
`chunks` for quick and orchestrator; none when empty; a prefill's chunks reach the launch input; an open without a
prefill clears them. The scenario step "Start opens the launcher" in Task 8 shows the prefill on screen.

### Task 7: The To review strip and sheet
**Depends on:** Task 1 (uses the generated `RunReviewGroup` types on `WorkState` and `NewRunPrefill.chunks`)
**Files:** `frontend/app/view/jarvis/runreview.ts`, `frontend/app/view/jarvis/runreview.test.ts`, `frontend/app/view/jarvis/runreviewstore.ts`, `frontend/app/view/jarvis/runreviewsheet.tsx`, `frontend/app/view/jarvis/briefsurface.tsx`, `frontend/app/view/jarvis/briefnav.ts`, `frontend/app/view/jarvis/briefnav.test.ts`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`

The spec's "The To review strip and sheet (Brief)" and decisions 9–10, matching the Prototype board.

- `runreview.ts` (pure): from `WorkState.runreview`, the hidden keys (`briefUndo`'s pending set) and the ticks, derive
  the visible groups (rows hidden by a pending Later/Drop removed, and rows whose key is settled, empty groups
  removed), the strip line ("<N> things <M> runs left", singular forms), the oldest age, the footer line ("<K> marked
  to do", and with no tick "Tick what to do, then start one run with it."), the next settled set (a pure
  `pruneSettled(settled, snapshot)`: keep a settled key while the snapshot still lists its chunk), the start's prefill
  (goal lines `- <label> (<initiative title>)`, shape quick for one and orchestrator for more, the shared project
  or ""), and the refusal: items from two different non-empty projects give "Tick items from one project to start a
  run" and no prefill. Row key: `chunkKey("effort:<oid>", label)` from `briefundo.ts`.
- `runreviewstore.ts`: the sheet-open atom, the ticks atom (kept until Clear; ticks whose row is gone are not
  counted), the j/k cursor within the sheet, and the actions: Later (`setChunkStatus pending`) and Drop
  (`setChunkStatus skipped`) through `briefUndo.schedule` with the effort mutate helper in `effortstore.ts`, toast
  text naming the chunk; a commit that succeeds adds its key to a settled atom, which is pruned with `pruneSettled`
  each time a newer Brief snapshot lands (briefUndo un-hides a key as its commit returns, while the snapshot still
  holds the chunk until the next fetch, and the row must not come back); a failed commit leaves the key unsettled so
  the row reappears with briefUndo's error toast. Start opens `openLauncher(model, "run", prefill)` with `chunks` set,
  or shows the refusal line in the footer and changes nothing.
- `runreviewsheet.tsx`: the strip (top of the Brief's main column, above `WaitingStrip`; absent when nothing to
  review; enters and leaves on `springReveal`) and the sheet from the right on `springSheet` with header, groups
  (goal, short id in mono, age), rows (tick box, full label, muted initiative, Later, Drop), footer (count, Clear,
  primary "Start a run with K items", dimmed at 0) and the empty line "Nothing a run left is waiting on you." Rows and
  groups fold on `springReveal` with opacity on the Fluid ease at `durMicro`; ticking moves nothing. Hooks for the
  scenario: `data-run-review-strip`, `data-run-review-sheet`, `data-run-review-group="<runid>"`,
  `data-run-review-row="<effort oid>:<label>"`, `data-run-review-tick`, `data-run-review-later`,
  `data-run-review-drop`, `data-run-review-start`, `data-run-review-clear`, `data-run-review-empty`,
  `data-run-review-refusal`.
- `briefsurface.tsx` mounts the strip and the sheet. `briefnav.ts`: while the sheet is open, the j/k order is the
  sheet's rows only.
- `bindings.ts` (`buildJarvisBindings`): `t` tick, `l` Later, `Delete` Drop, `Esc` close, active only while the sheet
  is open; mirror them in `docs/keyboard-shortcuts.md`.

Acceptance: `npx vitest run frontend/app/view/jarvis/runreview.test.ts frontend/app/view/jarvis/briefnav.test.ts` —
grouping kept oldest first, counts and singular/plural lines, hidden rows and emptied groups removed, the empty state,
ticks of gone rows not counted, the goal text and shape, the shared-project pick, a projectless item fitting any project,
and the different-projects refusal; settled rows stay out until a snapshot without them, then the key is pruned; the
zero-tick footer line; j/k walk only the sheet's rows while it is open. The views and interactions are shown by Task 8's
scenario steps: 1 (strip), 2 (sheet with groups), 3 (tick count, Start prefill), 4 (refusal), 5 (keys j/k, t, l,
Delete, Esc), 6–7 (Later/Drop folds, group fold, rows staying gone past the undo window), 7 (empty state), 8 (no strip).

### Task 8: Scenario, CHANGELOG and hand check
**Depends on:** Task 2 (its Needs-you skip is asserted), Task 3 (the groups the Brief draws), Task 4 (step 8 starts a deferred run with chunks and cancels it), Task 5 (the scenario seeds through the backlog RPC), Task 6 (the launcher prefill it asserts), Task 7 (the views it drives)
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

- Scenario `brief-run-review` (surface `jarvis`), modelled on `brief-chunk-panel`: arrange two fixture orchestrator
  runs with `arrangeFixtureRun`-style `createrun` (`deferstart: true`, a temp project dir each), and two initiatives
  with different projects (`effortcreate` with `project` "verify-rr-a" and "verify-rr-b"). Seed pending chunks whose
  labels name a run's 8-char id: run 1 → one chunk on A; run 2 → two chunks on A and one on B (four in all). Call
  `effortbackfillproposed`, reload the Brief. Teardown deletes the initiatives, runs' channels and temp dirs it made.
  Steps, each with a screenshot under `cdp-shots/`:
  1. the strip shows "4 things 2 runs left" and `getattention` holds no plan-review item for either initiative;
  2. Review opens the sheet with two groups, oldest run first; the footer reads "Tick what to do, then start one run
     with it." and Start is dimmed;
  3. ticking one of run 2's A rows shows "1 marked to do" and enables Start; Start opens the launcher whose goal holds
     that row's label line; Esc closes it and the tick is still there; Clear empties the ticks;
  4. ticking run 2's A row and its B row, then Start, shows the refusal line (`data-run-review-refusal`, "Tick items
     from one project to start a run") and no launcher; Clear;
  5. keys: `j` and `k` move the sheet's cursor between rows (the cursor's row is marked); `t` ticks the row under it
     ("1 marked to do"); Clear; `l` on run 1's only row folds it and its group (Later); `Delete` on one of run 2's rows
     folds it (Drop); `Esc` closes the sheet and Review reopens it;
  6. Later and Drop by click on the remaining rows but one fold each row;
  7. Drop on the last row shows the empty line; after the undo window passes and the Brief has refetched, the rows
     are still gone and the chunks read `pending` (Later) and `skipped` (Drop) over `effortget`;
  8. closing the sheet leaves no strip. Then, by RPC: a third pending chunk set `proposed` on A, a `createrun` with
     `chunks: [that chunk]` and `deferstart: true` leaves it `pending` with the run in its workrefs (`effortget`);
     `cancelrun` on that run leaves it `pending` with no workref.
  Call `await h.whatsnewShot("run-review", { selector: "[data-run-review-sheet]" })` at step 2.
- `CHANGELOG.md`, Unreleased → Added: one user-facing line (what runs leave now waits under To review on the Brief,
  grouped by run, to do, keep for later or drop; ticked items start one run), ending `<!-- big --> <!-- shot: none -->`.
  `npx vitest run frontend/app/cockpit/whatsnew.test.ts` passes.
- `docs/hand-checks.md`: `- [ ] (arcterm) After installing, run \`wsh effort backfill-proposed\` once: the backlog since
  2026-11-13 moves to To review (about 56 chunks), and Needs you shows none of them.` plus one line to start a real run
  from ticked items and see the chunks pending with the run attached, then detached when it ends.

Acceptance: the scenario parses (`node -e "import('./scripts/cdp/scenarios.mjs')"` or the file's own check), its name
is in the plan's Final line, and Final runs it.
