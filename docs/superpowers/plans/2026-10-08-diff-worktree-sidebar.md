# Diff worktree sidebar — implementation plan

**Spec:** `docs/superpowers/specs/2026-10-08-diff-worktree-sidebar-design.md` — read it first; every task implements a section of it.
**Verify:** `node scripts/verify.mjs ./pkg/gitinfo/... ./pkg/wshrpc/...`
**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit && go vet ./pkg/gitinfo/... ./pkg/wshrpc/...`
**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: diff-worktrees needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs diff-worktrees git-history diff-compare line-review`

Principles for every worker: simple, direct code; single source of truth; no abstraction for one caller; handle
errors at boundaries and never swallow them silently. Colors only from `@theme` tokens; no jsdom render tests
(pure `.ts` + `.test.ts`, thin `.tsx`). Never hand-edit generated files — run `task generate`.

### Task 1: Per-worktree status in GitListWorktreesCommand
**Depends on:** none
**Files:** `pkg/gitinfo/gitinfo.go`, `pkg/gitinfo/gitinfo_test.go`, `pkg/wshrpc/wshrpctypes_git.go`, `pkg/wshrpc/wshserver/wshserver_git.go`, `frontend/types/gotypes.d.ts`

Spec section 1. Add the optional `Status` flag to `CommandGitListWorktreesData` and the status fields
(`Head`, `Changed`, `Ahead`, `Behind`, `HasBase`, `Error`) to `GitWorktree`, exactly as named in the spec.
Add `gitinfo.WorktreeStatuses(ctx, []Worktree) []Worktree` (extend `gitinfo.Worktree` with the same fields):
per checkout `rev-parse --short HEAD`, `status --porcelain -z` counted as records (a rename counts once), and
for a linked checkout, when the main checkout has a branch, `rev-list --left-right --count <mainBranch>...HEAD`
(left = behind, right = ahead). At most 4 checkouts in flight; each under `gitTimeout`; a failing checkout
sets its own `Error` and the call still succeeds. The handler calls it only when `Status` is set, so existing
callers (`railstore.ts`, `codestore.ts`) see no change. Run `task generate`.

Acceptance: `go test ./pkg/gitinfo -run 'TestWorktreeStatuses'` passes, covering a temp repo with main plus
two linked worktrees — one with two uncommitted files (one untracked) and one commit ahead, one detached —
plus a third linked worktree whose `.git` file is overwritten with `gitdir: <a path that does not exist>`;
asserting `Changed`, `Ahead`/`Behind`, `HasBase` (false for main and when main is detached), `Head` non-empty,
and that the broken checkout is still listed and reports `Error` while the others still report.

### Task 2: Worktree scope origin
**Depends on:** none
**Files:** `frontend/app/view/agents/diffscope.ts`, `frontend/app/view/agents/diffscope.test.ts`, `frontend/app/view/agents/diffsource.ts`, `frontend/app/view/agents/diffsource.test.ts`, `frontend/app/view/agents/filesstore.ts`

Spec section 2. Add `{ kind: "worktree"; path: string; project: string }` to `DiffOrigin`. `originKey` →
`worktree:<normalized path>` (use `normalizeRepoPath`); `originCwd` → `path`; `defaultRangeFor` → working;
`availableRanges` offers what a project gets (working, compare). `FilesSource` gains
`{ kind: "worktree"; path: string }` and `sourceFor` returns it; `focusFollowAgent` keeps a worktree origin
pinned like a project. Fix every exhaustive switch the type checker flags (`filesstore.ts`'s cwd resolution
should need nothing beyond `originCwd`). Interface other tasks rely on: the exported `DiffOrigin` worktree
variant above and `FilesSource`'s worktree variant.

Acceptance: `npx vitest run frontend/app/view/agents/diffscope.test.ts frontend/app/view/agents/diffsource.test.ts`
passes with new cases: originKey is equal for two spellings of one Windows path; default range is working;
available ranges for a worktree origin equal a project's; focus does not move a worktree origin;
`sourceFor` returns the worktree source.

### Task 3: Sidebar row model
**Depends on:** Task 1, Task 2
**Files:** `frontend/app/view/agents/worktreesidebar.ts`, `frontend/app/view/agents/worktreesidebar.test.ts`, `frontend/app/view/agents/agentrailmodel.ts`, `frontend/app/view/agents/agentrailmodel.test.ts`

Spec section 3. Pure `sidebarRows(input): SidebarRow[]` with the types the spec gives. Extract the
"deepest worktree containing this path" logic from `linkedWorktree` in `agentrailmodel.ts` into an exported
helper both use (keep `linkedWorktree`'s behaviour and tests green) rather than copying the path helpers.
Also export `worktreeLabel(wt)` (branch, or `detached <head>`) and `worktreeRelPath(wt, main)` for the view.

Acceptance: `npx vitest run frontend/app/view/agents/worktreesidebar.test.ts frontend/app/view/agents/agentrailmodel.test.ts`
passes, covering: groups in project order with main checkout first; an unloaded group yields one pickable main
row from the project path; agents nested under the deepest matching worktree (Windows backslash vs slash,
case-insensitive); unresolved/outside agents under Other agents, which is omitted when empty; filter by
project, branch, worktree path and agent name keeps matching groups expanded with only matches; `current` for
agent, project, worktree and run origins (run matched by resolved cwd); a group whose load returned no
worktrees yields one pickable `not a repository` row from the project path.

### Task 4: Sidebar store
**Depends on:** Task 1
**Files:** `frontend/app/view/agents/worktreesidebarstore.ts`, `frontend/app/view/agents/worktreesidebarstore.test.ts`

Spec section 4. `sidebarFoldedAtom` (`atomWithStorage`, key `cockpit.files.sidebar.folded`, default false),
`sidebarExpandedAtom`, `worktreesByProjectAtom` + `loadProjectWorktrees(project)` (calls
`GitListWorktreesCommand` with `status: true`, per-project stale token; a rejection is logged and stored as the
group's error, other groups untouched), `agentCwdsAtom` + `resolveAgentCwds(agents)` (via `resolveCwd`, cached
by agent id + transcript path), `refreshSidebar()` (reloads expanded groups), and a pure
`withLiveCount(worktrees, filesState)` that replaces the open checkout's `Changed` from the loaded file list,
and the DEV fault hook `window.__worktreeSidebarFault = "error"` (read and cleared where
`loadProjectWorktrees` starts, as `reviewlistview.tsx` does with `__lineReviewFault`).
Interface Task 5 relies on: those exported names.

Acceptance: `npx vitest run frontend/app/view/agents/worktreesidebarstore.test.ts` passes (mock `RpcApi` as
`githistorystore.test.ts` does), covering: a stale response for a project is dropped; a rejected call sets that
group's error and leaves another group's data; `refreshSidebar` loads only expanded groups; an agent cwd is
resolved once per transcript path; `withLiveCount` overrides only the matching path; the fault hook makes
exactly one load reject and is cleared; `sidebarFoldedAtom` persists under the key
`cockpit.files.sidebar.folded`.

### Task 5: Sidebar view replaces the source picker
**Depends on:** Task 3, Task 4
**Files:** `frontend/app/view/agents/worktreesidebarview.tsx`, `frontend/app/view/agents/filessurface.tsx`, `frontend/app/view/agents/sourcepicker.tsx`, `frontend/app/view/agents/diffsource.ts`, `frontend/app/view/agents/diffsource.test.ts`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`, `CHANGELOG.md`

Spec section 5. Build the sidebar (expanded and folded rail) as a thin view over `sidebarRows` and the store;
mount it as the leftmost column of the Diff surface and delete `sourcepicker.tsx` and its use. Clicking a main
row selects the project origin, a linked row the worktree origin, an agent row the agent origin plus
`focusIdAtom` (as `pickAgent` does today). Expanding a group loads it; the current source's group is expanded
on scope change. Add `files:toggle-sidebar` on `Shift:b`; make `files:refresh` also call `refreshSidebar()`.
Re-point `NotARepoPanel`'s `onChooseSource` (it clicked
`[data-files-source-picker]`) to unfold the sidebar and focus its filter. No loading placeholder: badges stay
hidden until a group's status arrives; a failed group shows "Couldn't read worktrees"; a row with `Error`
shows the warning glyph. Delete `filterSources`/`worktreeParent` from `diffsource.ts` (and their tests) if nothing else uses them.
Carry every data hook spec section 5 lists (`data-files-source-option`, `data-worktree-sidebar`,
`data-worktree-filter`, `data-worktree-group`, `data-worktree-group-error`, `data-worktree-row`,
`data-worktree-changed`, `data-worktree-divergence`, `data-worktree-error`, `data-worktree-other-agents`,
`data-worktree-rail-item`, `data-worktree-dirty`) and the button titles
`Collapse worktrees` / `Expand worktrees`. Add the binding to `docs/keyboard-shortcuts.md` and one `Changed`
line under the top `Unreleased` section of `CHANGELOG.md` (open one if the top section is dated).

Acceptance: Check passes; `npx vitest run frontend/app/view/agents/diffsource.test.ts` passes; the views are
proven by Task 6's scenario steps: `diff-worktrees` steps 1-11 (checkouts listed, badge and divergence, row
error glyph, agent nesting and Other agents, row click scopes, agent click scopes, group collapse/expand,
filter, not-a-repository group, group error, rail with dirty dot) and `git-history`'s not-a-repo
"choose a source" step.

### Task 6: CDP scenarios
**Files:** `scripts/cdp/scenarios.mjs`

Spec section 6. Do not run prettier on `.mjs`.

- `git-history`, `diff-compare`, `line-review`: pick a source by clicking its `data-files-source-option` row
  directly (clicking its `data-worktree-group` header first if the group is collapsed) instead of opening
  `data-files-source-picker`. In `line-review` (two sites, ~12174 and ~12641) that is the `review-writer`
  agent row and the `verify-line-review` project row. No remaining reference to `data-files-source-picker`.
- `git-history` not-a-repo step (~3186): click the panel's "choose a source" action and assert
  `[data-worktree-sidebar]` is unfolded and `document.activeElement` is `[data-worktree-filter]`.
- New `diff-worktrees` scenario (surface `files`). Arrange: a temp repo on `main` with one commit; linked
  worktree `feature` with one extra commit and two uncommitted files (one untracked); linked worktree
  `broken` whose `.git` file is then overwritten with `gitdir: <missing path>`; register the main path as a
  project and a plain temp dir as a second project; write a fixture roster (follow `lrWriteRoster` and the
  transcript writers near `writeRailLinkRepo`) with agent `wt-agent` whose transcript's cwd is the `feature`
  worktree and agent `lost-agent` whose transcriptPath does not exist. Steps, each with a screenshot:
  1. both readable checkouts are rows under the project group;
  2. the `feature` row's `data-worktree-changed` reads `2` and `data-worktree-divergence` contains `↑1`;
  3. the `broken` row carries `data-worktree-error`;
  4. `wt-agent` renders inside/after the `feature` row's nesting and `lost-agent` under
     `data-worktree-other-agents`;
  5. clicking the `feature` row makes `data-files-range-summary` name `feature` and `data-changed-file-row`
     list both files;
  6. clicking `wt-agent` scopes to it (summary changes to the agent's session range, `focusIdAtom` is
     `wt-agent`);
  7. clicking the project's `data-worktree-group` hides its rows, clicking again shows them;
  8. typing `feature` into `data-worktree-filter` leaves only the `feature` checkout row; clearing restores;
  9. the plain directory's group shows a `not a repository` row;
  10. set `window.__worktreeSidebarFault = "error"`, press `r`: a `data-worktree-group-error` reads
      "Couldn't read worktrees"; press `r` again and it clears;
  11. `Shift+B` folds to the rail, where the `feature` `data-worktree-rail-item` carries
      `data-worktree-dirty`; `Shift+B` again restores the sidebar.
  Teardown removes the projects, the roster fixture and the temp dirs.

Acceptance: `node --check scripts/cdp/scenarios.mjs` passes; the Final line runs `diff-worktrees`,
`git-history`, `diff-compare` and `line-review`.
