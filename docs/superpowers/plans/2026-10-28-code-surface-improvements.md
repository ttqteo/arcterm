# Code surface improvements: blame, base diff, review comments

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `C:\Users\kael02\IdeaProjects\waveterm\docs\superpowers\specs\2026-10-28-code-surface-improvements-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/gitinfo ./pkg/wshrpc/...`
**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit && go vet ./pkg/gitinfo ./pkg/wshrpc/...`
**Final:** `node scripts/cdp/final-verify.mjs surface-smoke code-diff code-blame code-plain-dir code-review`

**Goal:** Make the Code surface the place to read what agents wrote and answer it: a blame column that leads to the landing run (A), a diff against the branch base (D), and multi-comment reviews sent to an agent as one message (B).

**Architecture:** Two new wshrpc commands (`GitBlameCommand`, `CodeReviewWriteCommand`) land first with `task generate`; commit-to-run attribution is a read-side helper in `wshserver` that fills the blame reply's run map. Frontend follows the surface's pattern: pure `foo.ts` + `foo.test.ts`, thin `.tsx`, Monaco touched only in `codeviewer.tsx`, state in module-scoped jotai atoms that survive the surface unmounting.

**Tech Stack:** Go (gitinfo, wshrpc/wshserver, wstore), React 19 + jotai + Monaco, vitest, CDP scenarios.

## Decisions beyond the design (and why)

1. **Run credit rule, measured.** On the packaged store's 137 landed runs, 134 have `Land.Commit` as a two-parent merge whose second parent is `EndCommit` (127) or descends from it (7: the branch moved after completion, e.g. a "Merge main into wave/…" fix). The other 3 have no `EndCommit`. So a landed run is credited `git rev-list M^1..M^2` (M = `Land.Commit`) exactly when `EndCommit` is in that list; the fast-forward case (`Land.Commit == EndCommit`) is credited `git rev-list --first-parent --no-merges BaseCommit..M`; anything else gets no credit. This is the spec's "exact only" rule made checkable with one git call per run. A hand merge passes the same test only when it really took in the run's tip, which is exact, so it is credited too (the spec excluded hand merges only because it assumed they could not be told apart). The spec now says this.
2. **Live run credit drops merges.** In a `wave/<runId>` worktree the spec's `<base>..HEAD` would credit main's commits that were merged into the branch. We use `git rev-list --first-parent --no-merges <run.BaseCommit>..HEAD` instead, because lane merges are squash commits on the first-parent chain. The spec now says this.
3. **No project filter on runs.** Each landed run's list is computed in `run.ProjectPath`, cached for the process (a landed run never changes, including a failed read, which is logged once and cached empty), and joined by full sha. A sha cannot collide across repos, so no path comparison is needed. The first blame after launch pays about one git call per landed run (137 today), at concurrency 8.
4. **Run level only.** Task-level credit is possible (each task's child run records its squash sha in `EndCommit`), but nothing in the spec needs it and the run opens through `openTarget` either way. Not built.
5. **Blame wire shape.** Go returns porcelain groups unmerged, plus `runs` keyed by sha. The frontend merges consecutive groups into hunks (pure, tested), as the spec's constraints ask. `gitinfo.Blame` has its own 30 s budget and the frontend passes `timeout: 35000`, because the client's RPC budget binds the server context (5 s default).
6. **Blame column is a separate React column** left of the editor, positioned from line tops that `codeviewer.tsx` publishes. Monaco decorations cannot carry clickable text, and injected text shifts code. Blame shows only in the source editor (not markdown preview, not diff). It reflects the saved file, is cached per path+modtime, and reloads when the open file's modtime changes (save, reload).
7. **Base resolution** uses the existing RPCs: `ListBranchesCommand(...).default`, then `GitDivergenceCommand({base: default, head: "HEAD"})`. Base is skipped when `ahead` is empty (merge-base == HEAD) or when there is no default branch. An RPC failure shows an error state in the base step instead of being skipped silently. Resolved on every head→base step, not cached.
8. **Keys:** `b` toggles blame (outside the editor, like `d`). `Alt+M` adds a comment and `Alt+Shift+M` opens Send review; both also work from the editor, which a comment on a selection needs. Alt+C/W/R are avoided because Monaco's find widget owns them.
9. **Review file writer is Go** (`CodeReviewWriteCommand`), because the `~` expansion, the project-name sanitizing and the 7-day prune are deterministic file IO with input validation. The frontend only builds the markdown.
10. **Review toolbar** (count, Send review, Clear) sits in the surface toolbar, shown only when the project has comments. The agent list in Send to agent is extracted into one shared picker, so the two senders do not drift apart.
11. **New code lives in `wshserver`, not new packages**, so Verify's package patterns exist at every merge (`go list` fails on a pattern for a package that does not exist yet). `wshserver` already reads runs from wstore (`sessionruns.go`).
12. **Blame in a plain directory is disabled**, like the diff toggle there: the button is disabled with the not-tracked title and `b` is a no-op. The spec now says so.
13. **Sending a review to a live agent is unit-tested, not CDP-tested.** A live agent needs an agent tab with a terminal block driven by `wsh`, and `scripts/inject-live-agents.mjs` must run inside a Wave terminal of the app it targets. Final's freshly started dev app does not give it one. `codereviewstore.test.ts` pins the file write and the one-line injection. The scenario covers the picker's no-agent path, and checks that the Send to agent popover still renders after the picker extraction.

## Global Constraints

- Colors and spacing only from `@theme` tokens in `frontend/tailwindsetup.css`, no new tokens; follow DESIGN.md.
- Pure logic in `foo.ts` with `foo.test.ts` beside it; `.tsx` stays thin. No jsdom render tests.
- Monaco access stays in `frontend/app/view/code/codeviewer.tsx`.
- Never hand-edit generated files (`frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`); run `task generate`.
- `ControllerInputCommand` payloads are exactly one line (it submits at the first newline).
- New keybindings go in `buildCodeBindings` (`frontend/app/store/keybindings/bindings.ts`) and the Code table in `docs/keyboard-shortcuts.md`.
- Opening a run goes through `openTarget(model, { kind: "run", runId })` (`frontend/app/view/jarvis/openref.ts`).
- Each new UI state gets a CDP step in `scripts/cdp/scenarios-code.mjs`; a new scenario is listed in `scripts/cdp/scenarios.mjs`.
- Only format the files you touched; never prettier `scripts/*.mjs`.

## Review Focus

1. **Unsaved edits or a fresh save while blame is on**: blame describes the saved file and reloads after save. Pinned by `blameIsCurrent` tests (Task 4).
2. **Blame on an untracked or brand-new file**: answers `untracked`, and the column shows one "not committed" entry, never an RPC error. Pinned by `TestBlameUntracked` (Task 1) and the `blameEntries` untracked test (Task 4).
3. **Base step where it cannot apply** (on the default branch, no default branch, RPC failure): skipped, or an explicit error state, never a stale HEAD diff labelled "base". Pinned by `nextDiffStep` and the `HeadText` ref-match tests (Task 3).
4. **Comments after the file's lines shifted** (an agent edited it): re-anchored to the nearest exact match of the anchor line, else kept at their stored line. Pinned by `reanchor` tests (Task 5).
5. **Send review when the file write or the clipboard fails**: comments are kept and the failure is shown; they are cleared only after a successful send or copy. Pinned by `codereviewstore.test.ts` (Task 6).

---

### Task 1: Wire GitBlameCommand and CodeReviewWriteCommand
**Depends on:** none
**Files:** `pkg/gitinfo/blame.go`, `pkg/gitinfo/blame_test.go`, `pkg/wshrpc/wshrpctypes_git.go`, `pkg/wshrpc/wshrpctypes_code.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshserver/wshserver_git.go`, `pkg/wshrpc/wshserver/wshserver_code.go`, `pkg/wshrpc/wshserver/wshserver_code_test.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

**Interfaces (produces, exact):**

```go
// pkg/wshrpc/wshrpctypes_git.go — added to GitCommands
GitBlameCommand(ctx context.Context, data CommandGitBlameData) (*CommandGitBlameRtnData, error)

type CommandGitBlameData struct {
	Cwd  string `json:"cwd"`
	Path string `json:"path"` // cwd-relative, forward slashes, like GitFileAtRefCommand
}
type GitBlameHunk struct {
	Start      int    `json:"start"` // 1-based line in the working-tree file
	Lines      int    `json:"lines"`
	Sha        string `json:"sha"` // full; all zeros = not committed
	Author     string `json:"author"`
	AuthorTime int64  `json:"authortime"` // unix seconds
	Subject    string `json:"subject"`
}
type GitBlameRun struct {
	RunId string `json:"runid"`
	Goal  string `json:"goal"`
}
type CommandGitBlameRtnData struct {
	Hunks     []GitBlameHunk         `json:"hunks"`          // porcelain groups in file order, unmerged
	Runs      map[string]GitBlameRun `json:"runs,omitempty"` // sha -> crediting run; filled by Task 2
	IsRepo    bool                   `json:"isrepo"`
	Untracked bool                   `json:"untracked,omitempty"`
}

// pkg/wshrpc/wshrpctypes_code.go — new CodeCommands interface, embedded in WshRpcInterface in wshrpctypes.go
CodeReviewWriteCommand(ctx context.Context, data CommandCodeReviewWriteData) (*CommandCodeReviewWriteRtnData, error)

type CommandCodeReviewWriteData struct {
	Project  string `json:"project"`
	Markdown string `json:"markdown"`
}
type CommandCodeReviewWriteRtnData struct {
	Path string `json:"path"` // absolute path of the written file
}
```

`gitinfo.Blame(ctx, cwd, path string) (*BlameResult, error)` in `pkg/gitinfo/blame.go` (with `BlameResult{Hunks []BlameHunk; IsRepo, Untracked bool}`, mirrored field for field by the wire type, as `FileAtRef` is). It runs `git blame --porcelain -- <path>` under its own `blameTimeout = 30 * time.Second`. When blame fails, it checks `git ls-files --error-unmatch -- <path>`: untracked → `Untracked: true`, else the error with git's stderr. A non-repo cwd → `IsRepo: false`, nil error.

`GitBlameCommand` in `wshserver_git.go` calls it and leaves `Runs` nil. `CodeReviewWriteCommand` in `wshserver_code.go` delegates to `writeReview(root, project, markdown string, now time.Time) (string, error)`, with root = `<UserHomeDir>/.arc/review`. It writes `<root>/<safe project>/<now UTC "20060102T150405.000Z">.md`, then prunes every `*.md` under `<root>/*/` older than `reviewMaxAge = 7 * 24 * time.Hour`. A prune failure is logged and does not fail the write. Validation: the project is reduced to one safe segment (characters outside `[A-Za-z0-9._-]` become `-`, leading dots are trimmed; empty after that is an error). Empty markdown is an error, and so is markdown over `reviewMaxBytes = 1 << 20`.

- [ ] **Step 1: Write failing Go tests.** `pkg/gitinfo/blame_test.go` builds a temp repo (reuse gitinfo_test.go's repo helpers):
  - `TestBlameGroups`: two commits touching different lines → hunks cover every line once, in order, with each commit's full sha, author, author time and subject.
  - `TestBlameUncommitted`: an uncommitted edited line → a hunk whose sha is 40 zeros.
  - `TestBlameUntracked`: a new untracked file → `Untracked: true`, nil error.
  - `TestBlameNotRepo`: a plain dir → `IsRepo: false`.

  `wshserver_code_test.go`:
  - `TestWriteReviewPathAndContent`: the file lands at `<root>/<project>/<stamp>.md` with the exact markdown.
  - `TestWriteReviewSanitizesProject`: `"../a b/c"` writes inside root as one segment.
  - `TestWriteReviewRejects`: empty project after sanitizing, empty markdown, and over-cap markdown are errors.
  - `TestWriteReviewPrunes`: an 8-day-old `.md` in another project dir is removed and a 6-day-old one is kept.
- [ ] **Step 2:** Run `go test ./pkg/gitinfo -run '^TestBlame'` and `go test ./pkg/wshrpc/wshserver -run '^TestWriteReview'`; expect FAIL (undefined).
- [ ] **Step 3:** Implement the types, `gitinfo.Blame`, both handlers and `writeReview`; run `task generate`.
- [ ] **Step 4:** Rerun the step 2 commands → PASS. `git diff --stat` shows `RpcApi.GitBlameCommand` and `RpcApi.CodeReviewWriteCommand` in `frontend/app/store/wshclientapi.ts`.
- [ ] **Step 5:** Commit.

### Task 2: Credit blamed commits to runs
**Depends on:** Task 1
**Files:** `pkg/wshrpc/wshserver/blameruns.go`, `pkg/wshrpc/wshserver/blameruns_test.go`, `pkg/wshrpc/wshserver/wshserver_git.go`

**Interfaces:** `runsForCommits(ctx context.Context, cwd string, shas []string) (map[string]wshrpc.GitBlameRun, error)` returns only the shas a run is credited with. `GitBlameCommand` calls it with the hunks' distinct non-zero shas and sets `Runs`. An attribution error is logged and the blame is returned without runs, because blame without a run link is still a full answer.

Rules (header decisions 1-3):
- **Landed run** (`Land.State == "landed"`, `Land.Commit` and `EndCommit` set): `landedRunCommits(ctx, run) []string` runs in `run.ProjectPath`. If `Land.Commit == EndCommit` → `git rev-list --first-parent --no-merges <BaseCommit>..<Commit>` (none if `BaseCommit` is empty). Else → `git rev-list <Commit>^1..<Commit>^2`, credited only if `EndCommit` is in the output; a failure (no second parent) → none. Cache per run id in a mutex-guarded package map, including empty results. Compute uncached runs with concurrency 8. Runs come from `wstore.DBGetAllObjsByType[*waveobj.Run]`.
- **Live run**: `gitinfo.CurrentBranch(ctx, cwd)` is `wave/<id>` and a run with that id exists with a `BaseCommit` → `git rev-list --first-parent --no-merges <BaseCommit>..HEAD` in cwd, uncached.
- Every other commit gets no entry.

- [ ] **Step 1: Write failing tests** in `blameruns_test.go`: temp repos plus runs seeded into the test store (see `sessionruns_test.go`'s `seedLeadRun`).
  - `TestRunsForCommitsNoFF`: a `--no-ff` merge of a branch with two squash-style commits, `EndCommit` = branch tip → both credited, and a base-branch commit is not.
  - `TestRunsForCommitsNoFFMovedTip`: the branch gains a commit after `EndCommit` before the merge → all branch commits credited.
  - `TestRunsForCommitsNoFFForeignMerge`: `Land.Commit` is a merge whose second side does not contain `EndCommit` → nothing credited.
  - `TestRunsForCommitsFastForward`: `Land.Commit == EndCommit` with a "Merge main into wave/x" merge on the first-parent chain → the non-merge first-parent commits are credited, and the merge and main's commits are not.
  - `TestRunsForCommitsNoEndCommit`: nothing credited.
  - `TestRunsForCommitsLiveBranch`: cwd on `wave/<id>` with a seeded unlanded run → its first-parent non-merge commits since `BaseCommit` are credited.
  - `TestRunsForCommitsCachesLanded`: the second call does not rerun git for a landed run (count through a package-level test seam).
- [ ] **Step 2:** `go test ./pkg/wshrpc/wshserver -run '^TestRunsForCommits'` → FAIL.
- [ ] **Step 3:** Implement and wire into `GitBlameCommand`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit.

### Task 3: Diff against the branch base
**Depends on:** none
**Files:** `frontend/app/view/code/codedifftarget.ts`, `frontend/app/view/code/codedifftarget.test.ts`, `frontend/app/view/code/codestore.ts`, `frontend/app/view/code/codediffview.tsx`, `frontend/app/view/code/codepathbar.tsx`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`, `scripts/cdp/scenarios-code.mjs`

**Interfaces (produces):**
- `codedifftarget.ts`: `type DiffStep = "off" | "head" | "base"`, `nextDiffStep(cur: DiffStep, baseUsable: boolean): DiffStep` (off→head; head→base if usable else off; base→off), and `diffTargetLabel(target: "head" | "base", base?: { branch: string; sha: string }): string`.
- `codestore.ts`: `codeDiffTargetAtom: PrimitiveAtom<"head" | "base">` (default `"head"`); `HeadText` variants gain `ref: string`, and the view renders only the variant whose `path` and `ref` both match; `loadHead(rel)` becomes `loadCommitted(rel: string, ref: string)`. Also `resolveDiffBase(): Promise<{ kind: "usable"; branch: string; sha: string } | { kind: "skip" } | { kind: "error"; message: string }>` (header decision 7), and `cycleDiff(): Promise<void>`, which drives `codeViewModeAtom` + `codeDiffTargetAtom` through `nextDiffStep`. Leaving diff returns to `"source"`, as today.
- The `d` binding calls `void cycleDiff()`, with label "Cycle the diff: HEAD, branch base, off" (same in the docs table). The path bar's Diff button enters diff on `"head"`.
- `codediffview.tsx` draws a one-line header naming the target, `data-code-diff-target="head" | "base"`, for example "Against HEAD" / "Against the merge-base with origin/main (abc1234)". A base error renders `SurfaceEmptyState` "Cannot diff against the branch base".

- [ ] **Step 1: Write failing tests** in `codedifftarget.test.ts`: the cycle with base usable (off→head→base→off), with base unusable (off→head→off), and the labels for both targets.
- [ ] **Step 2:** `npx vitest run frontend/app/view/code/codedifftarget.test.ts` → FAIL.
- [ ] **Step 3:** Implement the module, the store changes, the header and the binding/doc label.
- [ ] **Step 4:** Same command → PASS; `npx vitest run frontend/app/view/code` stays green.
- [ ] **Step 5: CDP.** Rework the `code-diff` scenario. Arrange: a repo on `main` with `return 3` committed and an uncommitted `return 8`. After each on-disk change below, reopen the file so the buffer matches disk: `r`, then click its Changed row. Assert, in order:
  - Diff mounts with `[data-code-diff-target="head"]` (the existing open/mount steps).
  - **Skip on the default branch:** `d` → back to the single editor, and no `[data-code-diff-target="base"]` appeared.
  - **Base:** in the repo, create and switch to a `feature` branch, commit the `return 8` edit, and write an uncommitted `return 9`; reopen. `d` → head, `d` → `[data-code-diff-target="base"]`, and the original side's text includes `return 3`. Shot `cdp-shots/code-diff-base.png`. `d` → single editor.
  - **Base error:** run `git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/gone`. DefaultBranch then answers `origin/gone`, GetDivergence's `merge-base` fails, and the RPC throws. `d`, `d` → the "Cannot diff against the branch base" empty state shows. Shot `cdp-shots/code-diff-base-error.png`.

  `d` is dispatched as the scenario does today: a `document.dispatchEvent` keydown, with focus moved to the tree first. `task verify:ui -- code-diff` passes against a running dev app.
- [ ] **Step 6:** Commit.

### Task 4: Blame column
**Depends on:** Task 1 (uses the generated `RpcApi.GitBlameCommand` and `CommandGitBlameRtnData`), Task 2 (its credited-row scenario step needs the live-branch run credit), Task 3 (shares codepathbar.tsx, bindings.ts, keyboard-shortcuts.md and scenarios-code.mjs)
**Files:** `frontend/app/view/code/codeblame.ts`, `frontend/app/view/code/codeblame.test.ts`, `frontend/app/view/code/codeblamestore.ts`, `frontend/app/view/code/codeblamecolumn.tsx`, `frontend/app/view/code/codeviewer.tsx`, `frontend/app/view/code/codepathbar.tsx`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`, `scripts/cdp/scenarios-code.mjs`, `scripts/cdp/scenarios.mjs`

**Interfaces (produces, Task 6 relies on the line layout):**
- `codeblame.ts`:
  - `interface BlameEntry { start: number; lines: number; sha: string; short: string; author: string; authorTime: number; subject: string; committed: boolean; run?: { runId: string; goal: string } }`
  - `blameEntries(rtn: CommandGitBlameRtnData, lineCount: number): BlameEntry[]`: merges consecutive same-sha groups; a zero sha → `committed: false`; `untracked` → one uncommitted entry over `lineCount`; `isrepo: false` → `[]`.
  - `blameClick(e: BlameEntry): { kind: "open-run"; runId: string } | { kind: "copy-sha"; sha: string } | { kind: "none" }`
  - `blameIsCurrent(state: BlameState, path: string, modtime: number): boolean`
- `codeblamestore.ts`:
  - `codeBlameOnAtom: PrimitiveAtom<boolean>`
  - `codeBlameAtom: PrimitiveAtom<BlameState>`, where `BlameState` is `idle | loading{path} | ready{path, modtime, entries} | error{path, message}`
  - `loadBlame(rel: string, modtime: number, lineCount: number): Promise<void>`: token-guarded like `loadCommitted`; skips when `blameIsCurrent`; RPC opts `{ timeout: 35000 }`.
  - `toggleBlame(): void`
- `codeviewer.tsx` exports `useEditorLineLayout(): { top(line: number): number; height(start: number, lines: number): number; version: number } | null`. It is backed by `getTopForLineNumber`, `scrollTop` and the line height, and bumps `version` on scroll, layout and content change. It is the only Monaco access, and Task 6 positions its inline input with it.
- `codeblamecolumn.tsx`: a fixed-width column left of the editor (source mode only) with one row per entry: short sha (mono), relative age (reuse `formatAge` / `formatAgeShort` in `agentsviewmodel.ts`, after checking what their argument means), and the run's goal, truncated, when credited. Uncommitted entries read "not committed". `title` = `subject — author`. A click follows `blameClick`: `openTarget(model, { kind: "run", runId })`, or copy the sha with brief copied feedback. Data attributes: `data-code-blame-column`, `data-code-blame-entry=<sha>`, `data-code-blame-run=<runId>`.
- `b` binding `code:blame` "Toggle the blame column": gated like `code:diff`, and a no-op when `codePlainAtom` is true.
- A Blame toggle button in the path bar with `data-code-blame-toggle`. In a plain directory it is disabled with the `NOT_TRACKED` title, as the Diff mode button is.
- A docs row.
- A copied row shows its feedback on the row: `data-code-blame-copied="copied" | "failed"`, cleared after the usual feedback delay. Reuse `useCopyFeedback`.

- [ ] **Step 1: Write failing tests** in `codeblame.test.ts`:
  - Adjacent same-sha groups merge into one entry, and non-adjacent ones stay separate.
  - A zero sha is uncommitted.
  - `untracked` → one entry covering `lineCount`.
  - `runs` attach to the matching entries only.
  - `isrepo: false` → no entries.
  - `blameClick` covers all three kinds (an uncommitted entry → none).
  - `blameIsCurrent` is false for another path, another modtime, or a loading/error state.
- [ ] **Step 2:** `npx vitest run frontend/app/view/code/codeblame.test.ts` → FAIL.
- [ ] **Step 3:** Implement the model, store, column, layout hook, binding, button and doc row.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: CDP.** Add a new `code-blame` scenario (export it from `scenarios-code.mjs` and list it in `scenarios.mjs`).

  Arrange:
  - A temp repo with the commit "seed the file" on `main`, registered as a project.
  - A channel on it and a deferred run: `createchannel`, then `createrun` with `deferstart: true` and a recognizable goal, as `arrangeSheetDagRun` in `scenarios-shared.mjs` does. The run's `BaseCommit` is then that commit.
  - Create and switch to the branch `wave/<runId>`, commit "run commit" touching other lines, and leave one uncommitted edited line.

  Teardown cancels the run and deletes the channel (see `teardownFixtureRun`), then removes the project and the temp dir.

  Steps:
  - Open the file, click `[data-code-blame-toggle]` → `[data-code-blame-column]` mounted, with ≥3 `[data-code-blame-entry]` rows, one of which reads "not committed". Shot `cdp-shots/code-blame.png`.
  - A committed row's `title` contains its commit subject.
  - The "run commit" row carries `[data-code-blame-run="<runId>"]` and shows the run's goal (live-branch credit from Task 2). The "seed the file" row has no `data-code-blame-run`.
  - Click the seed row → `data-code-blame-copied="copied"` appears on it.
  - Click the run row → the surface switches away from Code and the opened run is `<runId>`. Read the active run the way `openTarget` sets it, e.g. the run sheet's run id attribute or `jarvissubjectstore`'s active run. Shot `cdp-shots/code-blame-run.png`, then go back to Code.
  - Focus the tree and press `b` (a `document.dispatchEvent` keydown) → the column is gone.

  In the existing `code-plain-dir` scenario, add a step: with a file open, `[data-code-blame-toggle]` is disabled. `task verify:ui -- code-blame code-plain-dir` passes.
- [ ] **Step 6:** Commit.

### Task 5: Review comment model
**Depends on:** none
**Files:** `frontend/app/view/code/codereview.ts`, `frontend/app/view/code/codereview.test.ts`

**Interfaces (produces, pure, no jotai or RPC imports):**
- `interface ReviewComment { id: string; path: string; startLine: number; endLine: number; anchor: string; note: string }`
- `type Reviews = ReadonlyMap<string, readonly ReviewComment[]>`, keyed by the project's path.
- `addComment(r: Reviews, project: string, c: ReviewComment): Reviews`, `removeComment(r, project, id): Reviews`, `clearProject(r, project): Reviews`, `projectComments(r, project): readonly ReviewComment[]`, `fileComments(r, project, path): readonly ReviewComment[]`. All are immutable, and the empty project key is dropped.
- `selectionLines(sel: { startLine: number; endLine: number; endColumn: number }): { startLine: number; endLine: number }`: a selection ending at column 1 of a later line excludes that line.
- `reanchor(c: ReviewComment, lines: readonly string[]): { startLine: number; endLine: number }`: keeps the range when `lines[startLine-1] === anchor`; else moves it to the exact match nearest the stored line (earlier on a tie), keeping its length; no match → unchanged.
- `reviewMarkdown(projectName: string, comments: readonly ReviewComment[]): string`: a title, then one `## <path>` per file (paths sorted), and per comment (by start line) a `### <path>:L<a>-L<b>` heading (`:L<a>` when a == b), the anchored line as a blockquote, and the note.
- `reviewHandoffLine(absPath: string): string` → `review comments in <absPath> — address each one`.

- [ ] **Step 1: Write failing tests** in `codereview.test.ts`, one per function, including:
  - A note containing newlines is preserved in the markdown.
  - The handoff line never contains `\n`.
  - Re-anchoring after 3 lines were inserted above the comment.
  - A tie between two equally near matches picks the earlier one.
  - The anchor is gone → unchanged.
  - `selectionLines` with `endColumn` 1 and with a single-line selection.
  - `clearProject` leaves other projects untouched.
- [ ] **Step 2:** `npx vitest run frontend/app/view/code/codereview.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit.

### Task 6: Review comments in the Code surface
**Depends on:** Task 4, Task 5 (uses the review model in codereview.ts), Task 1 (uses the generated `RpcApi.CodeReviewWriteCommand`)
**Files:** `frontend/app/view/code/codereviewstore.ts`, `frontend/app/view/code/codereviewstore.test.ts`, `frontend/app/view/code/codereviewbar.tsx`, `frontend/app/view/code/codeagentpicker.tsx`, `frontend/app/view/code/codepathbar.tsx`, `frontend/app/view/code/codesurface.tsx`, `frontend/app/view/code/codeviewer.tsx`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`, `scripts/cdp/scenarios-code.mjs`, `scripts/cdp/scenarios.mjs`

**Interfaces:**
- `codereviewstore.ts`:
  - `codeReviewsAtom: PrimitiveAtom<Reviews>` (module-scoped; survives an unmount, not a restart).
  - `codeCommentDraftAtom: PrimitiveAtom<{ path: string; startLine: number; endLine: number; anchor: string } | null>`
  - `codeReviewSendOpenAtom: PrimitiveAtom<boolean>`
  - `startComment(): void`: from the editor selection through `selectionLines`, else the caret line; no text file open → no-op.
  - `saveComment(note: string): void`: a blank note cancels.
  - `cancelComment(): void`
  - `sendReview(target: AgentVM | null, projectName: string): Promise<{ ok: true } | { ok: false; message: string }>`. Comments of the open file are re-anchored against the buffer first. With a target: `CodeReviewWriteCommand` → `ControllerInputCommand(reviewHandoffLine(path) + "\r")`. Without one: the clipboard gets `reviewMarkdown(...)` and no file is written. Comments are cleared only on success.
  - `confirmClearReview(): void`: the same `ConfirmModal` pattern as `confirmDelete`.
- `codeEditorSelection()` in `codeviewer.tsx` returns `endColumn` too, so the existing Send to agent also gets `selectionLines` trimming. `codeviewer.tsx` draws the open file's comments as gutter decorations (`linesDecorationsClassName` with a token-colored class, `hoverMessage` = note) at their `reanchor`ed lines. It also draws the inline input (`data-code-comment-input`) positioned with `useEditorLineLayout` below the draft's end line: Enter saves, Escape cancels, and both stop propagation so the global Esc does not fire.
- `codeagentpicker.tsx`: `AgentPicker({ targets, onPick, emptyLabel, onEmpty })`, extracted from `SendToAgent` in `codepathbar.tsx`, which now uses it.
- `codereviewbar.tsx`, in the surface toolbar's actions, rendered only when the project has comments: the count (`data-code-review-count`), Send review (`data-code-review-send`, a popover with `AgentPicker`, opened by the button or `codeReviewSendOpenAtom`), and Clear (`data-code-review-clear`). A send failure shows its message. `projectName` comes from `handoffProjectName`, as the path bar does it.
- Bindings: `code:comment` `Alt:m` "Comment on the selection" and `code:send-review` `Alt:Shift:m` "Send the review", both `when: (ctx) => ctx.surface === "code" && !ctx.modalOpen`, plus docs rows. If a CDP probe shows Monaco eats either key before the window sees it, pick another Alt chord and update the docs.

- [ ] **Step 1: Write failing tests** in `codereviewstore.test.ts`, mocking `RpcApi` the way `frontend/app/view/agents/comparestore.test.ts` does, and `navigator.clipboard`:
  - A send to a target writes once, injects exactly one line ending in `\r` whose text is `reviewHandoffLine(<returned path>)`, and clears the project.
  - A write failure → `ok: false`; the comments are kept and nothing is injected.
  - No target → the clipboard holds the markdown, no write happens, and the project is cleared; a clipboard rejection → kept.
  - `saveComment("  ")` adds nothing.
- [ ] **Step 2:** `npx vitest run frontend/app/view/code/codereviewstore.test.ts` → FAIL.
- [ ] **Step 3:** Implement the store, picker extraction, toolbar, gutter markers, inline input and bindings.
- [ ] **Step 4:** Same command → PASS; `npx vitest run frontend/app/view/code` green.
- [ ] **Step 5: CDP.** Add a new `code-review` scenario (exported and listed). Arrange: a temp repo project with a 20-line file and no live agent. Dispatch keys as window keydown events, not `Input.dispatchKeyEvent`, which often never reaches the WebView:

  ```js
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', altKey: true, bubbles: true }))
  ```

  Steps:
  - Open the file, set the caret to line 3, dispatch `Alt+M` → `[data-code-comment-input]` is visible.
  - Type a note + Enter → one gutter marker. Repeat on line 10 → 2 markers.
  - `[data-code-review-count]` reads 2. Shot `cdp-shots/code-review.png`.
  - Escape on a third input → still 2, and the surface did not change.
  - Click `[data-code-review-clear]` → the confirm modal shows. Confirm → the count element is gone and no markers remain.
  - Add 2 comments again and dispatch `Alt+Shift+M` → the Send review popover is open and shows the no-agent copy action. Click it → the count element is gone. Shot `cdp-shots/code-review-sent.png`.
  - Open the path bar's Send to agent → its popover (now drawn by `AgentPicker`) shows the "Copy reference" action.

  Sending to a live agent is covered by `codereviewstore.test.ts` (header decision 13). `task verify:ui -- code-review` passes.
- [ ] **Step 6:** Commit.
