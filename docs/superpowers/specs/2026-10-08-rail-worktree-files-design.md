# Worktree files in the Agent rail, dragged into the CLI

Status: design, 2026-10-08.

## Goal

The Agent surface's right panel gains a **Files** tab: the agent's worktree as a file tree. Rows drag onto a terminal,
and the drop types their paths at the prompt, so pointing an agent at `src/foo.ts` is a drag instead of typing the path.

## What exists and is reused

- **The panel's tabs** — `agentrailtabs.ts` (pure: `RailTab`, `PanelState`, `visibleTabs`, `selectTab`), `agentrailstore.ts`
  (per-agent `railPanelsAtom`, `railWideWidthAtom`), `agentrailpanel.tsx` (`RailTabStrip`), rendered by
  `agentdetailsrail.tsx` (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md).
- **The agent's worktree** — `railStateAtom.cwd` (`railstore.ts`), the same cwd Files changed and Servers read.
- **A git-backed tree** — the Code surface's `GitListFilesCommand` (tracked + untracked, `.gitignore`d entries returned
  apart, a wholly ignored directory as one `dir/` entry) and `GitListIgnoredDirCommand` (one level of such a directory,
  on demand). The pure `codetree.ts` (`buildTree`, `visibleRows`, `lazyDirs`, `dirsToList`) and `codetreekeys.ts`
  (`treeKeyAction`) are used as they are. No new RPC, no Go change.
- **Drops on a terminal** — `CockpitFocusPane` (`frontend/app/cockpit/focus-pane.tsx`) already takes OS files
  (`isFileDrag`) and pastes their temp-file paths; `pasteIntoTerm` / `focusTerm` (`termpaste.ts`) paste with no Enter.

## Decisions

1. **A third tab, `tree`, labelled Files, icon `FolderTree`.** It sits between Overview and the editor-style File tab
   and is always visible while the agent has a cwd (`railState.cwd`); without one (no project, a subagent's interior, an
   ended session with no cwd) it is not shown. The key is `tree`, not `files`, because `files` already names the Files
   changed count. It is a wide tab: it takes `railWideWidthAtom`'s width and grip like File. It is never the default tab
   (`panelFor` keeps falling back to Overview); selecting it is remembered per agent in `railPanelsAtom` like any tab.
2. **Root = the agent's cwd.** The tree lists what `GitListFilesCommand({cwd})` returns: tracked and untracked files
   under the cwd, plus ignored entries dimmed; a wholly ignored directory (`node_modules/`) lists only when expanded
   (`GitListIgnoredDirCommand`). Directories first, then files, by name (`codetree.ts`). A cwd that is not a git repo
   shows "Not a git repository — the Files tab lists a git worktree." and nothing else.
3. **Loading and refresh.** The listing loads the first time the tab shows for a cwd and is cached per cwd in a
   module-scoped atom family (the rail unmounts with the surface). It reloads when the tab is shown again, when the
   agent's state changes (a turn ending may have created files), and from a Refresh button in the tab's header. A load
   in flight keeps the old rows. A failure shows the error text and a Retry button in place of the rows — never an empty
   tree. A truncated listing (the server's cap) says "Showing the first N files".
4. **Per-agent tree state** — expanded directories, the selection and its anchor, the keyboard cursor — lives in a
   jotai atom keyed by agent id, so switching surfaces or agents and coming back keeps it. Expanded paths that no longer
   exist after a reload are dropped.
5. **Mouse.** Click a row: it becomes the only selection and the anchor; a directory also toggles open. Ctrl/Cmd-click
   adds or removes a row from the selection. Shift-click selects the visible rows from the anchor to it. Double-click a
   file opens it in the File tab (`openFileInPanel`, `root` = cwd), exactly as a Files changed row does.
6. **Keyboard.** The tree is one focus owner (`role="tree"`, `data-owns-keys`, `aria-multiselectable`), driven by
   `treeKeyAction`: Up/Down move the cursor and select that row alone, Left/Right collapse/expand, Enter toggles a
   directory or opens a file in the File tab. No new keybinding enters `bindings.ts`.
7. **Drag.** Files and directories both drag. Dragging a selected row drags the whole selection (in row order);
   dragging an unselected row drags that row alone and leaves the selection as it was. The drag carries
   `application/x-arc-paths`: a JSON array of absolute paths (cwd joined with the repo-relative path, a directory
   ending in `/`, so the drop can tell it is one), plus `text/plain` with the same paths one per line, for drops outside
   arcterm. `effectAllowed` is `copy`. The drag image is the browser's default row ghost; there is no count badge.
8. **Drop on a terminal.** `CockpitFocusPane` accepts `application/x-arc-paths` beside OS files: a drop hint reading
   "Drop to insert the path" (plural for several), then on drop it pastes one text, with no Enter, and focuses the
   terminal. Nothing is copied and nothing is recorded in Uploads: the files are already on disk. An agent drag
   (`AGENT_DRAG_MIME`) is still left alone.
9. **What the drop types**, from `formatDroppedPaths(paths, target)`, where target is the dropped-on block's
   `{ agent: boolean, cwd: string | null }`:
   - On an **agent** terminal, a path under the target's cwd becomes `@<relative path>` with forward slashes, a
     directory ending in `/` (`@src/app/`); a path outside the cwd, or with no cwd known, stays absolute with `@`
     (`@D:/other/x.ts`). A path containing whitespace is wrapped in double quotes after the `@` (`@"docs/my notes.md"`).
   - On a **plain** terminal (a shell), no `@`: the relative path when under its cwd, else absolute, double-quoted when
     it contains whitespace.
   - Several paths are joined by single spaces, and the text ends with one space so typing can continue.
   The target is read from the cockpit's agent list by block id (an agent row whose `blockId` matches is an agent; its
   cwd is its resolved cwd), falling back to the block's `cmd:cwd` meta for a plain terminal. The relative path is taken
   against the **target's** cwd, so dropping one agent's file on another agent's terminal still names it correctly.
10. **Errors at the boundary.** A malformed `application/x-arc-paths` payload (not a JSON array of strings) is ignored
    with a `console.warn` and a toast "Could not read the dragged paths"; a paste that fails toasts its error. Nothing
    is swallowed.
11. **Out of scope (YAGNI):** creating, renaming or deleting files from the rail (the Code surface does that); a
    filter box; git status glyphs on rows; non-git directories; drops onto the composer or answer bar.

## Units

| Unit | Kind | Owns |
|---|---|---|
| `frontend/app/view/agents/pathdrop.ts` (+ test) | pure | `RAIL_PATHS_MIME`, `encodePathsDrag`, `decodePathsDrag`, `isPathsDrag(types)`, `formatDroppedPaths` |
| `frontend/app/view/agents/railtree.ts` (+ test) | pure | `RailTreeState` (expanded, selected, anchor, cursor), `clickRow` (plain/ctrl/shift), `dragPaths`, `pruneExpanded` |
| `frontend/app/view/agents/railtreestore.ts` | glue | per-cwd listing atoms, load/reload/lazy ignored dirs, per-agent `RailTreeState` atoms |
| `frontend/app/view/agents/railtreepane.tsx` | view | the tab body: header (root name, Refresh), rows, states (loading, error, not a repo, truncated) |
| `agentrailtabs.ts`, `agentrailpanel.tsx`, `agentdetailsrail.tsx` | edit | the `tree` tab in the model, the strip and the body |
| `frontend/app/cockpit/focus-pane.tsx` | edit | accepting the paths drag |

## Testing

- Vitest: `pathdrop.test.ts` (agent vs plain, relative vs outside cwd, Windows backslashes and drive-letter case,
  directories, whitespace quoting, several paths, malformed payloads); `railtree.test.ts` (click / ctrl / shift
  selection over visible rows, dragging a selected vs an unselected row, pruning vanished expanded dirs);
  `agentrailtabs.test.ts` (the `tree` tab's visibility with and without a cwd, tab order, never a default).
- CDP: a `rail-worktree-files` scenario on a fixture agent backed by a real shell block, whose cwd is a seeded git
  repo. It shoots and asserts every view and interaction above: loading, the tree, expand, click / Ctrl / Shift
  selection, the arrow keys and Enter, Refresh, error + Retry, the truncated notice, the not-a-repo state, the tree
  kept across a surface switch, the drop hint, and drops on an agent terminal (`@` paths) and on a plain terminal (no
  `@`), read from the xterm buffer's cursor line. `agent-rail-tabs` is updated for the third tab.
