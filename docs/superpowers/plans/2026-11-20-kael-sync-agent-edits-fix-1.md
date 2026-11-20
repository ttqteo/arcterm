# Kael sync 11-19, fix round 1: Final's four failed steps, and what the tasks found

**Goal:** Final passes: `diff-log-tab` step 7 (and the crash after it) and `diff-worktrees` steps 2 and 5. Fix too,
while the round is open, what the run's tasks found in the feature it built: overlapping `GitAgentEditsCommand` calls
fail on Windows, an Agent's edits range with no files and a failed edits read show the wrong words, the What's new
picture caught a loading pane, and a chunk's Due and BaseCommit are still lost on an effort sync.

**Architecture:** five independent tasks; each names its files. Tasks 1 and 2 are scenario-or-code fixes in the Diff
surface, Task 3 is Go in the Agent's edits server handler, Task 4 is the Agent's edits empty and failure states and its
picture, Task 5 is `pkg/wavevault`.

**Tech stack:** Go, React 19 + jotai, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-11-19-kael-sync-agent-edits-and-fixes-design.md`.
**Verify:** `node scripts/verify.mjs ./pkg/agentedits ./pkg/gitinfo ./pkg/wconfig ./pkg/agentsessions ./pkg/wavevault ./pkg/wshrpc/... ./cmd/wsh/cmd`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs diff-agent-edits diff-scope diff-compare-refresh diff-comments diff-file-keys diff-file-states kael-keys diff-log-tab diff-compare diff-review-marks diff-worktrees agent-rail-file-link run-sheet-done`

Working rules for every task: the round-1 Final output is
`C:/Users/me/AppData/Local/dev.arc.app/data/final-shots/20173f56-cbdf-4298-bbfb-f69c93312b0f/1` (`shots.json` holds
each step's detail, `cdp-shots/` the screenshots, `waveapp.log` the app log); read your step there first. Run a
scenario against your own worktree's dev app with `ARC_FINAL_OUT=<a temp dir> node scripts/cdp/final-verify.mjs
<scenario>`. Never weaken a scenario step to make it pass: a step changes only when the behaviour it asserts was changed
on purpose by a commit you name in the report, and then it asserts the new behaviour as strictly. KISS, no abstraction
for one use, never swallow an error. Colors from `@theme` tokens only (`DESIGN.md`). Pure logic in `foo.ts` with
`foo.test.ts` beside it. Commit with the files named (`git commit -- <paths>`), no attribution trailer. No task edits
`CHANGELOG.md` or `docs/hand-checks.md`.

### Task 1: diff-log-tab step 7: the ⋯ menu's wrap switch, and the crash after it
**Depends on:** none
**Model:** sonnet

Files: `scripts/cdp/scenarios.mjs` (the `diff-log-tab` scenario, step 7 near line 6870, step 8 after it), and the
Diff pane's options code only if the bug is there (`frontend/app/view/agents/diffpane.tsx` `OptionsMenu`,
`frontend/app/view/agents/diffoptions.ts`, its test).

Round-1 Final: step 7 read `{"menu7":true,"items7":["split","whitespace","wrap","editor","code"],"on7":false,"off7":false,"closed7":true}`,
then the run stopped in step 8 with `Cannot read properties of null (reading 'getBoundingClientRect')` on
`[data-diff-panel="open"]`. Task 3 of the run measured the same failure on the base commit, so the run did not cause it.

1. Find why clicking `[data-diff-options-item="wrap"]` does not turn its `aria-checked` to `"true"`. Check, in this
   order, against the live app: is the item `disabled` (`wrapAllowed` false: no file open when the menu opens), was
   wrap already on (a stored setting from an earlier step or scenario), or does the click close the menu or re-render
   it so the query reads a stale node. Say in the report which it was, with the values you read.
2. Fix the cause where it lives: in the app if the menu or the wrap option misbehaves for a person too, else in the
   scenario's arrange (open the file first, or reset the stored wrap setting the way the teardown restores the
   others). Step 7 still asserts that wrap reads on, then off, then Escape closes the menu.
3. The crash: step 7's Escape left the Diff surface because the menu was not open to take it. Make step 8 not depend
   on step 7 passing: before step 8, check the panel is there (`[data-diff-panel="open"]`) and record a failing step 8
   with what it found instead of throwing.

Acceptance: `diff-log-tab` passes all its steps twice in a row against your worktree's app, and the report names the
cause of step 7.

### Task 2: diff-worktrees steps 2 and 5: the feature worktree's changed count and its Commit tab
**Depends on:** none
**Model:** sonnet

Files: `scripts/cdp/scenarios.mjs` (the `diff-worktrees` scenario, steps 2 and 5 near lines 8036 to 8090), and the app
code you find at fault (the worktree rows of the Diff surface's sidebar and the panel's tab choice when a scope opens).

Round-1 Final: step 2 read `{"which":"feature","changed":null,"divergence":"↑1",...}` (no `[data-worktree-changed]`
on the feature row, which has 2 uncommitted files); step 5 read `{"tab5":"log","files5":["feature.txt","notes.txt"]}`
(the files are listed but the selected panel tab is Log, where the step expects Commit).

1. Run `diff-worktrees` on the run's base, `2312bfae4` (a temp worktree: `git worktree add <dir> 2312bfae4`, then
   `task worktree:prepare` in it, and remove it with `task worktree:cleanup -- <dir>` after), and on this branch. Say
   in the report which steps fail on each. Task 3 of the run saw step 5 fail on the base; step 2 may be new. If step 2
   passes on the base, this run broke it: the likely suspect is `pkg/gitinfo` (`upstreamCounts` now returns an error
   on a git fault, and the changed count may be read through it); find the path from the row's count to git and fix
   it there.
2. Step 5: find, with `git log -S` on the tab choice, whether opening a checkout with uncommitted changes on the Log
   tab was a deliberate change. If a commit chose Log on purpose, update step 5 to assert that tab and still assert
   both files are listed on the Commit tab after clicking it, naming the commit in the report. Otherwise fix the code
   so a scope with uncommitted changes opens on Commit.

Acceptance: `diff-worktrees` passes all its steps twice in a row against your worktree's app; the report gives the base
and branch results from step 1.

### Task 3: GitAgentEditsCommand: one build per transcript at a time
**Depends on:** none
**Model:** sonnet

Files: `pkg/wshrpc/wshserver/wshserver_agentedits.go`, `pkg/wshrpc/wshserver/wshserver_agentedits_test.go`.

Task 4 of the run saw overlapping calls for one transcript (the card, the rail and the Cockpit asking at page load)
each build B and H, writing the same loose objects; on Windows one fails with `update-index ... unable to write file
.git/objects/..: Permission denied` (or a silent `exit status 1`), which the rail drew as "Not a git repository".
`readAgentEdits` has a cache but no lock around the parse and build. The frontend's `agentchanges.ts` shares a request
for the card, rail and peek, but the Diff surface's `filesstore.ts` poll does not go through it.

1. Test first: in `wshserver_agentedits_test.go`, start 8 concurrent calls for the same transcript and cwd (the
   existing test fixtures build one) and assert every call succeeds with the same `Base` and `End`, and that B and H
   were built once (count it through whatever the handler already logs or returns as `hit`; add no exported hook
   only for the test). Run it with `-race -count=5` to see it fail or race first, and say what you saw.
2. Serialize the parse and build per cache key (cwd plus transcript path): a mutex per key in a map guarded by the
   existing `sync.Mutex`, taken before the cache check, so a second caller waits and then finds the cache filled.
   Keep the cache key and eviction as they are. Different transcripts still build in parallel.

Acceptance: `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/wshrpc/wshserver -run 'AgentEdits' -race -count=3`
passes; the existing `TestGitAgentEdits*` tests are unchanged.

### Task 4: Agent's edits: the empty and failed states say what happened, and the What's new picture
**Depends on:** none
**Model:** sonnet

Files: `frontend/app/view/agents/diffempty.ts`, `diffempty.test.ts`, its caller in the diff pane (find it with grep for
`emptyDiffState`), `frontend/app/view/agents/railstore.ts` and its test, `frontend/app/view/agents/agentdetailsrail.tsx`,
`scripts/cdp/scenarios-diff-agent-edits.mjs`.

1. Empty pane: with the edits range and no files, the Diff pane reads "This commit changes no files / It may be a merge
   or an empty commit" (`diffempty.ts`, kind `nofiles`), wrong for this range (Task 3 of the run saw it in the
   `diff-agent-edits` step 4 screenshot). Give `EmptyDiffInput` what it needs to know the range is the agent's edits
   (the smallest input: a flag or the range kind) and return, for that case, the title "No edits by this agent yet"
   and the edits read's `reason` as the body when there is one. Test it in `diffempty.test.ts`; every other kind keeps
   its words. Add an assertion to `diff-agent-edits` step 4 (the no-edits agent) that the pane reads the new title.
2. Rail on a failed read: when the edits read throws, `loadRailForAgent` sets `{ ...EMPTY, cwd }` and the rail's Files
   section says "Not a git repository". Keep the failure's message in the rail state (one optional field) and draw
   "Couldn't read this agent's edits" with the message as its title, using the same muted text style; "Not a git
   repository" stays for a folder that is not one. Test the state in `railstore.test.ts`.
3. The What's new picture: in round 1, step 1's `h.whatsnewShot("agent-edits", …)` caught the diff pane still loading
   (grey skeleton bars) and the switch above the frame. Before the shot, wait until the open file's diff has drawn
   (the pane's editor holds text, the way other steps of the file check it), and frame the panel so the Agent's edits /
   Since session start switch, the caption and the three flagged rows are in it, with the diff beside them. Keep 2:1
   and under 120 KB (`whatsnewShot` does both). Do not commit the `.webp`: Final takes it.

Acceptance: `npx vitest run frontend/app/view/agents/diffempty.test.ts frontend/app/view/agents/railstore.test.ts`
passes; `diff-agent-edits` passes all its steps against your worktree's app, and you looked at the picture it wrote
and say in the report what it shows.

### Task 5: Effort sync keeps a chunk's Due and BaseCommit changed only on the older side
**Depends on:** none
**Model:** sonnet

Files: `pkg/wavevault/effortmerge.go`, `pkg/wavevault/effortmerge_test.go`.

Task 9 of the run made a chunk's Status, Stage and Owner merge per field (`pickField` in `mergeChunk`), but a chunk's
`Due` and `BaseCommit` (`pkg/waveobj/wtype.go`) still come whole from the chunk with the newer `UpdatedTs`, so an
older-side change to either is lost on sync.

1. Test first in `effortmerge_test.go`, beside the chunk cases Task 9 added: a chunk whose `Due` only the older side
   changed keeps it; the same for `BaseCommit`; both sides changed takes the newer side. Watch them fail.
2. Add `win.Due = pickField(...)` and `win.BaseCommit = pickField(...)` in `mergeChunk`, the same way as Status. Check
   whether any other field of `waveobj.EffortChunk` set by a person or an agent (not a list, which merges as a set)
   is still taken whole, and name each in the report; merge only Due and BaseCommit in this task.

Acceptance: `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/wavevault -run 'MergeEffort'` passes.
