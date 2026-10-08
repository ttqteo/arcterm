# Worktree files in the Agent rail, dragged into the CLI

**Spec:** `docs/superpowers/specs/2026-10-08-rail-worktree-files-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/gitinfo/...`
**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`
**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: rail-worktree-files needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs rail-worktree-files agent-rail-tabs`

Frontend only: no Go, no RPC, no generated file changes. Every pure unit sits in a `foo.ts` with a `foo.test.ts`
beside it (AGENTS.md "Testable logic is extracted"); colors come from `@theme` tokens only (DESIGN.md). The Code
surface's `frontend/app/view/code/codetree.ts` and `codetreekeys.ts` are reused as they are and not edited.

### Task 1: Path drag payload and drop text (pure)
**Depends on:** none
**Files:** `frontend/app/view/agents/pathdrop.ts`, `frontend/app/view/agents/pathdrop.test.ts`

Spec decisions 7, 9 and 10, as pure functions. Exports other tasks rely on:

- `RAIL_PATHS_MIME = "application/x-arc-paths"`
- `isPathsDrag(types: readonly string[]): boolean`
- `encodePathsDrag(paths: string[]): { mime: string; data: string }[]` — the `RAIL_PATHS_MIME` JSON array and the
  `text/plain` one-per-line form
- `decodePathsDrag(data: string): string[] | null` — null for anything that is not a JSON array of non-empty strings
- `formatDroppedPaths(paths: string[], target: { agent: boolean; cwd: string | null }): string`
- `setDraggedPathsCount(n: number)` / `draggedPathsCount(): number` — a module variable (0 when no drag), set by the
  tree on `dragstart` and reset on `dragend`, so a drop target can word its hint at `dragover`, when the browser
  still hides the payload. The one impure line in the file.

Rules for `formatDroppedPaths` (spec decision 9): agent target → `@` + path relative to `target.cwd` with forward
slashes when under it, else the absolute path with forward slashes; a directory (the caller passes it with a trailing
`/` or `\`) keeps a trailing `/`; whitespace in the path → `@"…"`. Plain target → the same without `@`, double-quoted
on whitespace. Paths joined by one space, text ends with one space. Path comparison is case-insensitive on the drive
letter and treats `\` and `/` alike (reuse `isUnderRoot` / `toRel` from `@/app/cockpit/openfileroute` or
`normalizeRepoPath` from `@/util/paths`; do not write a second path normalizer).

Acceptance: `npx vitest run frontend/app/view/agents/pathdrop.test.ts` passes, covering agent vs plain, under vs
outside cwd, null cwd, Windows backslashes and `d:` vs `D:`, a directory, whitespace quoting, several paths, and
`decodePathsDrag` on `"[1]"`, `"{}"`, `"not json"`, `"[\"\"]"` (all null) and a valid array.

### Task 2: Rail tree selection model (pure)
**Depends on:** none
**Files:** `frontend/app/view/agents/railtree.ts`, `frontend/app/view/agents/railtree.test.ts`

Spec decisions 4, 5 and 7, over `TreeRow[]` from `codetree.ts`'s `visibleRows`. Exports:

- `interface RailTreeState { expanded: string[]; selected: string[]; anchor: string | null; cursor: string | null }`
  (repo-relative paths) and `EMPTY_RAIL_TREE`
- `clickRow(s: RailTreeState, rows: readonly TreeRow[], path: string, mod: "none" | "toggle" | "range"): RailTreeState`
  — plain click selects only `path`, sets anchor and cursor, and toggles `path` in `expanded` when it is a directory
  row; toggle (Ctrl/Cmd) adds or removes it, sets anchor; range (Shift) selects the visible rows between anchor and
  `path` inclusive (anchor missing from rows → behaves as plain, without the toggle)
- `toggleExpanded(s, path)`, `moveCursorTo(s, path)` (selects that row alone, for the arrow keys)
- `dragPaths(s, rows, path): string[]` — the selection in row order when `path` is selected, else `[path]`; a directory
  path ends in `/`
- `pruneExpanded(s, rows-or-tree): RailTreeState` — drops expanded and selected paths no longer in the listing

Acceptance: `npx vitest run frontend/app/view/agents/railtree.test.ts` passes, covering each click mode, a range
upward and downward, a range across a collapsed directory (its hidden children are not selected), dragging a selected
vs an unselected row, directory paths ending in `/`, and pruning.

### Task 3: The Files tab in the panel's tab model and strip
**Depends on:** none
**Files:** `frontend/app/view/agents/agentrailtabs.ts`, `frontend/app/view/agents/agentrailtabs.test.ts`, `frontend/app/view/agents/agentrailstore.ts`, `frontend/app/view/agents/agentrailpanel.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`, `scripts/cdp/scenarios.mjs`

Spec decision 1. `RailTab` becomes `"overview" | "tree" | "file"`. Signatures other tasks rely on:

- `visibleTabs(p: PanelState, hasTree: boolean): RailTab[]` — `overview`, then `tree` when `hasTree`, then `file`
  when a file is open
- `selectTab(p: PanelState, tab: RailTab, hasTree: boolean): PanelState` — refuses a tab `visibleTabs(p, hasTree)`
  does not list
- `selectRailTab(agentId: string, tab: RailTab, hasTree: boolean): void` in `agentrailstore.ts`
- `RailTabStrip({ agentId, panel, hasTree })`

`hasTree` is computed once, in `agentdetailsrail.tsx`: `railState?.cwd != null` and not in a subagent's interior. It
is passed to `RailTabStrip` and to every `selectRailTab` call there (today lines ~550, ~872, ~883); the strip passes
its prop to its own `visibleTabs` / `selectRailTab` / `nextTab` calls. `panelFor` never defaults to `tree` or `file`
(a stored default of either falls back to `overview`); a panel whose tab is `tree` while `hasTree` is false renders as
`overview` (a helper `shownTab(p, hasTree)`). `tree` is a wide tab like `file` (same width atom and grip). The strip
draws the `FolderTree` tab (`aria-label="Files"`, `title="Files"`, `data-rail-tab="tree"`) between Overview and the file
tab. For now the `tree` tab's body is empty — Task 5 fills it.

`scripts/cdp/scenarios.mjs`: the `agent-rail-tabs` fixture agent has a cwd, so it now shows three tabs. Update its
expectations: step 1's tab list becomes `['Overview*', 'Files']`, step 2's `['Overview', 'Files', 'File a.txt*']`,
step 5's ArrowRight from Overview lands on Files (then ArrowRight again on File), step 7's collapsed strip counts the
Files tab. Change only expectations that the new tab moves; nothing else in that scenario.

Acceptance: `npx vitest run frontend/app/view/agents/agentrailtabs.test.ts` passes, with new cases for the tab order
with and without a cwd, `nextTab` across three tabs, `selectTab` refusing `tree` when `hasTree` is false, `tree`
never a default, and `shownTab`. `agent-rail-tabs` (run by Final) passes with the updated expectations.

### Task 4: Drop paths on a terminal
**Depends on:** Task 1
**Files:** `frontend/app/cockpit/focus-pane.tsx`, `frontend/app/view/agents/droptarget.ts`, `frontend/app/view/agents/droptarget.test.ts`, `frontend/app/view/term/termpathlinks.ts`

Spec decisions 8–10. `CockpitFocusPane` accepts `isPathsDrag` drags beside OS files (an agent drag stays ignored): a
hint (match the existing hint's markup and tokens, keep `data-upload-drop`, add `data-paths-drop`) reading "Drop to
insert the path", or "Drop to insert the paths" when `draggedPathsCount()` (Task 1) is above 1 — browsers hide drag
data until drop, so the count comes from the in-page drag Task 5 records. On drop it decodes the payload, builds the text with `formatDroppedPaths` for this block's target, pastes
it with `pasteIntoTerm` (no Enter) and `focusTerm`. Nothing is copied, nothing goes to Uploads. A null decode →
`console.warn` + `pushToast` "Could not read the dragged paths"; a paste error → toast with its message.

`droptarget.ts` holds the pure part of resolving the target: `dropTargetFor(blockId, agents, blockCwd)` → `{ agent,
cwd }`, where `agents` is the cockpit's agent rows (`{ blockId?, cwd? }`) — an agent row with that `blockId` is an
agent and its cwd is its resolved cwd; otherwise a plain terminal with the block's `cmd:cwd` meta. The impure lookup
(which atom holds the agent rows and their resolved cwd — see `agentsviewmodel.ts`, `agentcwdresolve.ts`,
`railstore.ts`) stays in `focus-pane.tsx`.

`termpathlinks.ts`: add `cursorLine(id)` to the DEV-only `window.__arcTermPathLinks` hook — the text of the buffer
line under the cursor up to `cursorX`, untrimmed (`translateToString(false).slice(0, buffer.active.cursorX)`), or null
when the block has no terminal — so a scenario can read what a drop typed, trailing space and quotes included.

Acceptance: `npx vitest run frontend/app/view/agents/droptarget.test.ts` passes (agent block with cwd, agent with no
cwd, plain block with and without `cmd:cwd`). `rail-worktree-files` steps 12–15 (Task 6: the drop hint, drops on an
agent terminal, quoted and directory paths, a drop on a plain terminal) show it.

### Task 5: The Files tab body: listing, tree and drag
**Depends on:** Task 1, Task 2, Task 3
**Files:** `frontend/app/view/agents/railtreestore.ts`, `frontend/app/view/agents/railtreepane.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`

Spec decisions 2–7. The drag payload comes from Task 1's `encodePathsDrag`, the selection from Task 2's `railtree.ts`,
the tab from Task 3.

- `railtreestore.ts`: a module-scoped listing per cwd (a keyed record atom) holding
  `{ status: "loading" | "ready" | "error" | "notrepo"; files; ignored; truncated; error? }`, loaded with
  `RpcApi.GitListFilesCommand(TabRpcClient, { cwd })` (mirror `codestore.ts`'s timeout); ignored directories listed on
  expand with `GitListIgnoredDirCommand`, as `codestore.ts`'s `listIgnoredDirs` does. `reloadTree(cwd)` keeps the old
  rows while in flight and drops a stale reply (a newer load for that cwd won). Per-agent `RailTreeState` atoms keyed by
  agent id, pruned after each reload. Errors are stored and shown, never swallowed.
- `railtreepane.tsx`: the root element carries `data-rail-tree` and `data-rail-tree-state` = the listing's status
  (`loading` while the first load or a reload is in flight). Header with the cwd's base name (title = full cwd) and a
  Refresh button (`data-rail-tree-refresh`). Rows from `buildTree` + `visibleRows`, chevrons and `FileIcon` as
  `codetreepane.tsx` draws them, ignored rows dimmed (`data-ignored`), selected rows highlighted (tokens only);
  `role="tree"`, `aria-multiselectable`, `data-owns-keys`, `tabIndex=0`; each row `data-rail-tree-row=<path>` and
  `aria-selected`; the cursor row `data-cursor`. Keys through `treeKeyAction` (Up/Down → `moveCursorTo`, Left/Right
  collapse/expand, Enter toggles a directory or opens a file). Click / Ctrl-click / Shift-click through `clickRow`;
  double-click or Enter on a file → `openFileInPanel(model, agentId, { abs, root: cwd })`. `draggable` rows whose
  `dragstart` sets every entry of `encodePathsDrag(abs paths of dragPaths(...))`, `effectAllowed = "copy"` and
  `setDraggedPathsCount(n)`, and whose `dragend` resets it to 0; no custom drag image. States: loading, error (`data-rail-tree-error`, the error text, a Retry button
  `data-rail-tree-retry`), "Not a git repository — the Files tab lists a git worktree." (`data-rail-tree-notrepo`),
  "Showing the first N files" (`data-rail-tree-truncated`).
- Reload when the tab is shown, when the agent's `state` changes while the tab shows, and on Refresh / Retry.
- `agentdetailsrail.tsx`: render `RailTreePane` for the `tree` tab.

Acceptance: `rail-worktree-files` steps 1–11 and 16–18 (Task 6) show the loading state, the tree, expand, the three
click modes, keys, Enter and double-click, Refresh, the surface switch, error + Retry, the not-a-repo state and the
truncated notice.

### Task 6: CDP scenario and changelog
**Depends on:** Task 4, Task 5
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

Add a `rail-worktree-files` scenario to `scripts/cdp/scenarios.mjs`, modelled on `agent-rail-tabs` (its fixture,
seeded git project and `openRailTerminal` helpers). Fixtures:

- agent A: cwd = a seeded git repo with committed `src/app/main.ts`, `src/util.ts`, `README.md`, `docs/my notes.md`,
  a `.gitignore` of `build/` and an untracked `build/out.js`. Its `blockId` is a **real shell block** opened with
  `openRailTerminal` (its `cmd:cwd` then set to the repo), not a fake id, so drops reach a live xterm.
- agent B: cwd = a plain (non-git) temp directory.
- agent C: cwd = a git repo with 20,001 untracked files (written in a loop; the server caps the listing at 20,000).
- a plain terminal T (`openRailTerminal`, in no agent row), `cmd:cwd` = `~`.

What a drop typed is read with `window.__arcTermPathLinks.cursorLine(blockId)` (Task 4), never with
`uploadsTermText` (it strips whitespace). Before each drop, clear the shell's input line (Ctrl+U, or Escape for
PowerShell) and wait until `cursorLine` shows only the prompt; assert the line ends with the expected text. Steps,
each with a shot and an assertion:

1. install a MutationObserver recording every `data-rail-tree-state` value, then click agent A's Files tab → the
   record includes `loading`, and it settles on `ready`;
2. the tree lists `src`, `docs`, `README.md`, `.gitignore`, with `build` dimmed (`data-ignored`);
3. click `src` → `src/app`, `src/util.ts` show;
4. click `README.md`, Ctrl-click `src/util.ts` → exactly those two `aria-selected="true"`;
5. click `docs`, Shift-click `README.md` → the visible rows between them selected, nothing else;
6. focus the tree, ArrowDown twice → the cursor (`data-cursor`) moved two rows; ArrowLeft on the expanded `src`
   collapses it, ArrowRight expands it;
7. cursor on `README.md`, Enter → the File tab opens on `README.md`; go back to the Files tab;
8. double-click `src/util.ts` → the File tab opens on it; go back to the Files tab;
9. write `NEW.md` into the repo, click Refresh → a `NEW.md` row appears;
10. switch to another surface and back to Agent → `src` still expanded, the selection unchanged;
11. overwrite the repo's `.git/index` with garbage, click Refresh → `data-rail-tree-error` shows its text; restore the
    saved index bytes, click Retry → rows are back;
12. click `README.md`, Ctrl-click `src/util.ts`; dispatch `dragstart` on `src/util.ts`'s row with a fresh
    `DataTransfer`, then `dragenter` + `dragover` with that `DataTransfer` on agent A's `.cockpit-focus-pane` →
    `[data-paths-drop]` shows "Drop to insert the paths" (shot);
13. `drop` there → the cursor line ends with `@README.md @src/util.ts `;
14. clear the line; drag `docs/my notes.md` alone the same way → ends with `@"docs/my notes.md" `; clear; drag `src`
    alone → ends with `@src/ `;
15. show the plain terminal T and drop `README.md` on its focus pane → its cursor line ends with `README.md`'s
    absolute path (forward slashes) and a space, with no `@`;
16. switch to agent B, open its Files tab → `data-rail-tree-notrepo` shows;
17. switch to agent C, open its Files tab → `data-rail-tree-truncated` shows "Showing the first 20000 files";
18. back on agent A, the Files tab is still its selected tab.

Teardown removes the fixtures, the terminals and the temp directories. Add one line under `Added` in `CHANGELOG.md`'s
top section (open `## Unreleased` above a dated one if needed), written for the user: the Agent panel's Files tab lists
the worktree, and dragging files or folders onto a terminal types their `@` paths at the prompt.

Acceptance: `node scripts/cdp/final-verify.mjs rail-worktree-files agent-rail-tabs` passes (run by Final).
