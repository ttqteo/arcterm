# The Diff surface as a Commit | Log tool window

**Date:** 2026-10-09
**Status:** design, agreed in brainstorming 2026-10-09; mockup next
**Builds on:** the worktree sidebar (`2026-10-08-diff-worktree-sidebar-design.md`), the stored scope
(`2026-08-06-diff-scope-model-design.md`) and the polish pass (`2026-09-25-diff-surface-polish-design.md`).
It replaces the four-column layout and the range strip. It takes on part of the deferred "repository
actions" (Spec B, `docs/deferred.md`): commit and sync. Checkout, cherry-pick and revert stay deferred.

## Why

The goal is a Diff surface that reads like IntelliJ: one tool window beside a wide editor. Today the
surface shows four columns at once (Worktrees, History, the commit and its files, the diff). At
1600px the diff gets about 830px, so long lines wrap. Several facts appear more than once: the
selected commit's hash shows in the range strip, the right-hand summary, the commit header and the
history row.

The surface is also read-only. A finished agent's work has to be committed and pushed from a
terminal, although the person is already looking at exactly those files.

## Decisions

0. **A quick look comes first.** Choosing a source, a commit, the session row or a compare range selects
   its first file and shows that diff at once. The diff pane never says "Pick a file" while the list has
   files, and moving through the list with `↑`/`↓` changes the diff without Enter. While a list loads,
   its header says it is loading and never `0 files · +0 −0`. On 2026-10-09 the surface showed commit
   `63736f8`, which has 4 files (+65 −6), as `0 FILES +0 −0` over skeleton rows beside an empty diff.
1. **Two regions:** a left panel (about 340px, resizable, folds to a rail) and the diff, which gets the rest.
2. **The panel has two tabs, Commit and Log.** Commit holds the source's uncommitted changes. Log
   holds the graph and the selected commit.
3. **The worktree sidebar folds into a source dropdown** at the top of the panel. It shows the same tree
   (project, then worktree, then agent), the same badges and the same filter.
4. **Commit picks files and leaves the shared index alone:** `git commit --only -- <paths>`. It works at
   file level only: no hunks, no Staged/Unstaged groups.
5. **Sync is Fetch, Pull and Push for the current branch against its upstream.** Pull is fast-forward
   only and Push never forces.
6. **The agent rail is unchanged.** Its View diff lands on the Log tab with the "Since session start" row selected.
7. **Removed:** the Worktrees column, the separate History column, the commit-detail column, the range
   strip (`Working tree | Since session start | Compare`), the right-hand summary
   (`310d518 · 2 files · +95 −7`), the hash chip in the commit header, and the large "Diff" title.

Out of scope: hunk selection, AI-written messages, changelists, Commit and Push, remotes other than
origin, force push, tags, merge or rebase when a branch has diverged, automatic fetch, and every action
on a commit row (checkout, cherry-pick, revert, new branch).

## 1. Layout

```
┌[arcterm · main ▾]   main → origin/main ↑2 ↓0  ⟳ ↓ ↑ ┬ docs/deferred.md  +83 −3   ↑↓  File|Review ⋯ ┐
│ [Commit]  Log                                       │                                              │
├─────────────────────────────────────────────────────┤  10 10 > Pruned 2026-10-05 ...               │
│ Commit tab: change tree + message box               │  13    +## (arcterm) Saved actions           │
│ Log tab:    graph (top) / selected commit (bottom)  │  ...                                         │
└─────────────────────────────────────────────────────┴──────────────────────────────────────────────┘
```

- **The panel's top bar** holds the source dropdown, then the sync cluster (§3).
- **The tab strip** sits under it. The Log tab carries a `Compare…` button, which opens the existing
  ref picker. Compare mode lives inside Log.
- **The Log tab** splits vertically. The graph is on top, with the "Since session start" row first when
  the source is an agent, as today. Below it is the selected commit:
  - one line, `310d518 · ttqteo · 1h`;
  - the subject;
  - the body, folded;
  - the ref chips;
  - the file tree.

  The split is draggable.
- **The diff header is one line:** path, `+83 −3`, previous and next change, `File | Review`, and a `⋯`
  menu that gathers the view options (whitespace, wrap, side-by-side).
- **Width rules:** `difflayout.ts` keeps one rule. Below `PANEL_FOLD_PX` the panel starts folded to a
  rail, and an explicit choice wins, as `resolveSidebarFolded` does today. The history-collapse
  threshold goes away with the History column.

## 2. The Commit tab

**List**

- Header: `☑ Changes (3)` (selects or clears every enabled row), the tree/flat toggle, refresh.
- **Changes** holds tracked files (M, A, D, R) and is ticked by default.
- **Unversioned (n)** is folded by default and unticked.
- A row shows a checkbox, the status letter, the bold name over a muted directory, and `+a −d` or the
  count note (`bin`, `repo`, `dirty`; `gitstatus.ts` `ChangeNote`).
- `repo` (a nested repository) and `dirty` (a submodule whose only change is inside it) rows have their
  checkbox disabled, with a tooltip. A commit here cannot carry either one.
- Clicking a row shows its diff against HEAD in the diff pane. `Space` toggles the focused row and
  `↑`/`↓` move between rows.

**Message box**

- The textarea grows from 3 to 10 lines. The draft is kept per source.
- `☐ Amend` loads HEAD's message into the box. It is enabled only while HEAD is unpushed
  (upstream ahead > 0, or no upstream). Otherwise it is disabled with the tooltip
  "already pushed: amending would need a force push".
- The button reads `Commit N files`, and `Ctrl+Enter` in the textarea does the same. It is disabled
  while the message is blank or nothing is ticked.
- When live agents run in this worktree, a muted line above the button says so ("2 agents running
  here"). It informs and never blocks.

**Write: `GitCommitCommand`** (`pkg/gitinfo`, `pkg/wshrpc/wshrpctypes_git.go`)

```go
type CommandGitCommitData struct {
    Cwd     string   `json:"cwd"`
    Message string   `json:"message"`
    Paths   []string `json:"paths"`   // cwd-relative, as GetChanges reports them; a rename lists both ends
    Amend   bool     `json:"amend,omitempty"`
}
type CommandGitCommitRtnData struct {
    Hash    string              `json:"hash,omitempty"`
    Failure *gitinfo.GitFailure `json:"failure,omitempty"`
}
```

- Untracked paths are first added with `git add -- <untracked>`. Then the command runs
  `git commit --only [--amend] -F - -- <paths>`, with the message on stdin.
- `--only` commits exactly those paths' working-tree content. Whatever another session has staged for
  other paths stays in the index and out of the commit.
- Paths are validated against the current `status` before anything runs. A path git does not list is
  refused as a `GitFailure`, never passed through.
- A hook failure, an `index.lock`, or an empty commit comes back as `GitFailure`, the same shape Fetch
  already returns.
- On success the surface clears the message, refreshes, and toasts `Committed a1b2c3d` with a link
  that opens the commit in Log.

## 3. Sync

- **Status:** `main → origin/main ↑2 ↓0`, counted against the upstream with
  `git rev-list --left-right --count @{u}...HEAD`.
  - These counts differ from the dropdown's ahead/behind, which compares against the main checkout's
    branch.
  - The read rides on `GetChanges`. `Changes` and `CommandGitChangesRtnData` gain `Upstream`,
    `UpstreamAhead` and `UpstreamBehind`, so the surface's existing poll carries them and no new timer is added.
  - With no upstream, the counts read `no upstream` and Push becomes **Publish**.
  - On a detached HEAD the cluster is disabled.
- **Fetch:** the existing `GitFetchCommand`. It runs only when clicked, and again after a Pull or Push.
- **Pull: `GitPullCommand`** runs `git pull --ff-only`.
  - A diverged branch returns a `GitFailure` whose message says the branch and its upstream have
    diverged and must be reconciled in a terminal.
  - When live agents run in that worktree, the surface confirms first: "Pull will change files in a
    worktree where 2 agents are working. Continue?"
- **Push: `GitPushCommand`** runs `git push`, or `git push -u origin <branch>` to publish.
  - It never forces.
  - A rejection says to pull first.
  - It needs no confirmation, because it does not touch the working tree.
- **Every sync command:**
  - runs with `GIT_TERMINAL_PROMPT=0`, so a missing credential fails at once instead of hanging (the
    Windows credential manager's own window still appears);
  - has its own budget: 55s for Fetch and Pull, 120s for Push (the client raises its RPC timeout to
    match, as Fetch does);
  - shows a spinner on the running button and disables the other two;
  - reports failures in the shipped `GitFailure` panel under the top bar, and success as a short toast
    ("Pulled 3 commits", "Pushed 2 commits").

## 4. Keys, state, errors

**Keys** (`buildFilesBindings`; mirror them in `docs/keyboard-shortcuts.md`):
- `Shift+C` opens the Commit tab and focuses the message.
- `Shift+H` now opens the Log tab.
- `Shift+B` now folds the whole panel.
- `Space` and `↑`/`↓` work in the Commit list.
- `Ctrl+Enter` is handled in the textarea, not as a global binding, so the existing `Mod:Enter` binding is untouched.
- `Shift+N/P`, `r`, `/` and `c` keep their meanings.
- The sync buttons have no keys.

**State.** The surface unmounts on switch, so what must survive lives in jotai atoms:
- The tick selection per source, stored as exceptions to the defaults: ticked-off tracked paths and
  ticked-on unversioned paths. A new file takes its default, and a path that left the list is pruned.
- The message draft per source.
- The active tab and the panel width.

**Default tab:**
- the rail's View diff opens Log with the session row selected;
- choosing a project or worktree opens Commit when it has changes, and Log otherwise;
- a later choice of tab is kept.

**Errors:** every write returns `GitFailure` as data. None of them clears the message or the selection.

## 5. Testing

- **Go** (`pkg/gitinfo`, temp repos plus a bare remote):
  - `--only` leaves another path's staged change in the index and out of the commit;
  - committing an untracked file;
  - a rename commits both ends;
  - amend;
  - a failing `pre-commit` hook returns `GitFailure`;
  - a path not in status is refused;
  - Pull on a diverged branch is refused;
  - a Push rejected by the remote;
  - Publish sets the upstream;
  - the upstream counts with and without an upstream.
- **Vitest**, with pure models beside their tests:
  - `commitselection.ts`: defaults, toggling, pruning, disabled notes, the button label;
  - `syncstate.ts`: button states from the upstream, a detached HEAD, busy, ahead/behind, and Amend's enablement;
  - the default-tab rule.
- **CDP:**
  - new scenarios `diff-commit-tab` and `diff-log-tab`;
  - update the Diff scenarios that address the removed columns, the range strip or the source sidebar;
  - `surface-smoke` must still pass.

## 6. Docs to update in the same change

- `CHANGELOG.md`.
- `docs/keyboard-shortcuts.md`.
- `docs/deferred.md` and `docs/open-issues.md`: narrow the Spec B entry to checkout, cherry-pick and revert.
- `docs/reference/architecture.md`, if it describes the Diff columns.
