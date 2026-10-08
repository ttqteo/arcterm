# A worktree sidebar for the Diff surface

**Date:** 2026-10-08
**Status:** design, awaiting spec review
**Builds on:** the stored scope (`2026-08-06-diff-scope-model-design.md`) and the polish pass
(`2026-09-25-diff-surface-polish-design.md`). Neither is superseded; this replaces only the source picker.

## Why

The goal: make the Diff surface read like VS Code's Source Control or IntelliJ's Git tool window, and
show worktrees far more. Today a worktree is nearly invisible on the Diff surface. The only place one
appears is a faint "worktree · <parent>" caption inside the source picker's popover, and only when the
worktree happens to be registered as a project. A linked worktree nobody registered (every engine run
makes one under `.waveterm/worktrees/<runId>`) can be reached only by focusing an agent that runs in it.
Nothing shows, at a glance, which checkouts of a repo exist, which branch each holds, or which have
uncommitted work.

VS Code answers this with a **Repositories** section listing each repository and worktree with its
branch and a change badge; clicking one points the Changes view at it. That is the shape chosen here.

Everything needed already exists except one cheap backend addition: `GitListWorktreesCommand` lists a
repo's checkouts (main first, prunable ones left out) and is already used by the Code surface and the
agent rail. It does not yet report status per checkout.

## Decisions

1. **A left sidebar lists every registered project, each with its worktrees nested under it.** Main
   checkout first, then linked worktrees in `git worktree list` order. Like a VS Code multi-root
   workspace. The group holding the current source is expanded; others start collapsed.
2. **The sidebar replaces the source picker.** `sourcepicker.tsx` is deleted, and the subject row
   keeps the `Diff` title, the range strip, the compare controls and the summary. Agents become child
   rows under the worktree they run in. An agent whose working directory resolves outside every listed
   worktree, or does not resolve, sits in a trailing **Other agents** group. There is one place to pick
   a source.
3. **Each worktree row shows its branch, its uncommitted-file count, and ahead/behind against the main
   checkout's branch.** Agent and run labels on a worktree row, and last-commit time, are out of scope.
   The agent child rows exist because the picker is gone, not as row decoration.
4. **The sidebar collapses to a narrow rail.** It is open by default, about 240px, and folds to a rail
   with a button or `Shift+B`. The folded state persists across launches. History keeps its own
   collapse behaviour unchanged.
5. **A linked worktree is a new scope origin**, `{ kind: "worktree"; path; project }`, whose default
   range is working tree. A main-checkout row is the existing project origin, unchanged. An agent row
   is the existing agent origin, unchanged (session range by default).
6. **Status comes from one RPC per project, extended rather than added.** `GitListWorktreesCommand`
   gains an optional `status` flag. Without it, the existing callers get exactly what they get today.
7. **Status loads only for expanded groups**, on mount, on expand, and on `r`. A collapsed group costs
   one `git worktree list` at most, and none until it is first expanded.

## 1. Backend

### 1.1 Wire types (`pkg/wshrpc/wshrpctypes_git.go`)

```go
type CommandGitListWorktreesData struct {
    Cwd    string `json:"cwd"`
    Status bool   `json:"status,omitempty"` // also read each checkout's status (costs ~2 git calls per checkout)
}

type GitWorktree struct {
    Path    string `json:"path"`
    Branch  string `json:"branch,omitempty"`
    IsMain  bool   `json:"ismain,omitempty"`
    // set only when Status was asked for
    Head    string `json:"head,omitempty"`    // short sha; "" in an unborn repository
    Changed int    `json:"changed,omitempty"` // entries in `git status --porcelain`, untracked included
    Ahead   int    `json:"ahead,omitempty"`   // commits on this checkout's HEAD not on the main checkout's branch
    Behind  int    `json:"behind,omitempty"`
    HasBase bool   `json:"hasbase,omitempty"` // ahead/behind were computed (false for main, or when main is detached)
    Error   string `json:"error,omitempty"`   // this checkout's status read failed; the row says so
}
```

Run `task generate` afterwards.

### 1.2 `gitinfo.ListWorktrees` gains a status pass

A new `gitinfo.WorktreeStatuses(ctx, wts []Worktree) []Worktree` fills the fields. Per checkout:
`git rev-parse --short HEAD`, `git status --porcelain -z` (count of NUL-separated records, rename
records counted once), and, for a linked checkout when the main checkout has a branch,
`git rev-list --left-right --count <mainBranch>...HEAD`. Checkouts run concurrently with at most 4
in flight, each under the existing `gitTimeout`. A failure on one checkout sets its `Error` and leaves
the others intact; it never fails the call. The handler in `wshserver_git.go` calls it only when
`Status` is set.

Tests (`pkg/gitinfo`): a temp repo with a main checkout and two linked worktrees, one with two
uncommitted files and one commit ahead, one detached, plus a third whose `.git` file was overwritten to
point at a gitdir that does not exist (git still lists it, since its directory exists, but cannot read it).
Assert counts, ahead/behind, `HasBase`, and that the broken checkout reports `Error` while the others still
report.

## 2. Scope model (`diffscope.ts`, `diffsource.ts`)

- `DiffOrigin` gains `{ kind: "worktree"; path: string; project: string }`. `originKey` is
  `worktree:<normalized path>`. `originCwd` returns `path`. `defaultRangeFor` returns working.
  `availableRanges` offers working and compare, like a project.
- `focusFollowAgent` already refuses to move a non-agent origin; a worktree origin is pinned like a
  project. Unit tests extended for the new kind.
- `sourceFor` returns the new kind's identity so the sidebar can mark the current row.
- A run origin keeps working: the sidebar marks the worktree row whose path equals the run's `cwd`
  as current (by path, not by origin) and changes nothing else.

## 3. Sidebar model (new pure `worktreesidebar.ts` + test)

```ts
export type SidebarRow =
    | { kind: "group"; project: string; path: string; expanded: boolean; error?: string }
    | { kind: "worktree"; project: string; wt: GitWorktree; label: string; current: boolean }
    | { kind: "agent"; agent: { id: string; name: string; state: string }; current: boolean }
    | { kind: "other-agents" };

export function sidebarRows(input: {
    projects: FilesProject[];
    worktrees: Record<string, GitWorktree[] | undefined>; // by project name; undefined = not loaded
    agentCwds: Record<string, string | null>;            // by agent id; null = did not resolve
    agents: { id: string; name: string; state: string }[];
    expanded: Set<string>;
    current: { origin?: DiffOrigin; cwd?: string | null };
    query: string;
}): SidebarRow[];
```

Rules the tests pin down:

- An agent is placed under the deepest worktree whose path equals or contains its cwd (reuse
  `agentrailmodel.ts`'s path helpers; extract the shared part rather than copy it). Unresolved or
  outside-every-worktree agents go under Other agents, which is omitted when empty.
- A group not yet loaded shows its main checkout as one row built from the project path, so a
  collapsed project is still pickable.
- A group whose load returned no worktrees is not a repository: it shows one pickable row from the
  project path, labelled `not a repository` (picking it shows the existing not-a-repo panel).
- `label` is the branch, or `detached <head>` when there is none. A linked worktree's secondary text is
  its path relative to the main checkout (the `linkedWorktree` rule).
- The filter matches project names, branches, worktree paths and agent names; a group with any match
  stays, expanded, showing only its matches.
- `current` follows decision 5 and section 2: agent origin marks the agent row, worktree or project
  origin marks its checkout row, a run origin marks the checkout whose path equals the resolved cwd.

## 4. Store (new `worktreesidebarstore.ts` + test)

- `sidebarFoldedAtom` (persisted with `atomWithStorage`, key `cockpit.files.sidebar.folded`) and
  `sidebarExpandedAtom` (a per-session `Set<string>` of project names; the current source's group is
  added on scope change).
- `worktreesByProjectAtom` and `loadProjectWorktrees(project)`: calls
  `GitListWorktreesCommand({ cwd: project.path, status: true })` with a per-project stale token. A
  rejected call stores the error on the group row ("Couldn't read worktrees") and logs it; it is never
  swallowed silently and never blanks other groups.
- `agentCwdsAtom`: each agent's cwd resolved once through `resolveCwd(transcriptPath, blockId)` and
  cached by agent id + transcript path.
- DEV fault hook, the `__lineReviewFault` pattern: `window.__worktreeSidebarFault = "error"`, read and
  cleared where `loadProjectWorktrees` starts, makes that one load reject. It exists so the CDP scenario can
  show the group error; it is inert unless a test sets it.
- `refreshSidebar()` reloads every expanded group; the `files:refresh` binding (`r`) calls it beside
  `reloadChanges`. When the open checkout's own change list reloads, its row's count is replaced from
  `filesStateAtom` so the badge and the file list never disagree.

## 5. View (`worktreesidebarview.tsx`, `filessurface.tsx`)

Layout becomes **Sidebar | History | Files | Diff**. Colors only from `@theme` tokens; icons from
`lucide-react`; follow `DESIGN.md`.

```
WORKTREES            [filter]  «
▾ arcterm  D:\code\arcterm
   ⎇ main                     3
      ● claude · working
   ⎇ wave/bd2ad781   ↑4 ↓1   12
     .waveterm/worktrees/bd2ad781
      ● claude · idle
▸ cuscofi
OTHER AGENTS
   ● pi · waiting
```

- Group header: chevron, project name, path faint and truncated from the left (the polish spec's
  `rtl` + `<bdi>` rule). Click toggles expansion.
- Worktree row: `GitBranch` icon (main) or `FolderGit2` (linked), label, ahead/behind as `↑n ↓n`
  in `text-muted` (hidden when both are 0 or `HasBase` is false), and the changed count as a badge
  right-aligned (hidden at 0). A row with `Error` shows a warning glyph (`data-worktree-error`) with the
  error as its title. No loading placeholder: a group's badges stay hidden until its status arrives
  (a badge only ever shows a number that was read).
- A group whose load failed shows "Couldn't read worktrees" under its header (`data-worktree-group-error`),
  with the error as its title.
- Agent row: indented, `StatusDot`, name, state faint on the right, as the picker drew it.
- The current row uses `bg-surface-selected`. Click selects: worktree → worktree origin (or project
  origin for main), agent → agent origin and writes `focusIdAtom` as `pickAgent` does today.
- Folded rail: about 36px, one icon per expanded group's checkouts (`data-worktree-rail-item=<path>`)
  with a dot when changed > 0 (`data-worktree-dirty`), and the unfold button (`title="Expand worktrees"`; open state `title="Collapse worktrees"`).
- Keep the CDP hooks the scenarios use: every pickable row carries `data-files-source-option=<name>`
  (project name for a main checkout, branch for a linked worktree, agent name for an agent).
  New hooks: `data-worktree-sidebar`, `data-worktree-filter` (the filter input),
  `data-worktree-group=<project>` (the header button), `data-worktree-row=<path>`, `data-worktree-changed`,
  `data-worktree-divergence`, `data-worktree-other-agents`. `data-files-source-picker` goes away with the
  picker.
- The not-a-repo panel's "choose a source" action (`NotARepoPanel` `onChooseSource`, which clicked the
  picker) now unfolds the sidebar and focuses its filter.
- `Shift+B` (`files:toggle-sidebar`) folds and unfolds; add it to `bindings.ts` and
  `docs/keyboard-shortcuts.md`.

## 6. Verification

- Go: `go test ./pkg/gitinfo -run 'TestWorktreeStatuses'`.
- Vitest: `diffscope.test.ts`, `diffsource.test.ts`, `worktreesidebar.test.ts`,
  `worktreesidebarstore.test.ts`.
- CDP: `git-history`, `diff-compare` and `line-review` pick sources by clicking `data-files-source-option`
  rows directly instead of opening the picker (line-review picks its `review-writer` agent row).
  `git-history`'s not-a-repo step clicks "choose a source" and asserts the sidebar is unfolded and its
  filter focused. A new `diff-worktrees` scenario arranges a temp repo with one linked worktree holding two
  uncommitted files and one commit ahead and a second linked worktree whose `.git` file points nowhere,
  registers it as a project plus a plain non-repo directory as another, and puts two fixture agents on the
  roster: one whose transcript's cwd is the good linked worktree, one whose transcript does not exist. It
  asserts: both readable checkouts show under the project; the linked row reads `2` and `↑1`; the broken
  checkout carries the error glyph; the first agent nests under the linked row and the second sits under
  Other agents; clicking the linked row scopes the range summary to that branch and lists both files;
  clicking the nested agent scopes to the agent; clicking the group header collapses and re-expands it;
  typing `feature` in the filter leaves only the linked row; the plain directory's group reads
  `not a repository`; with `__worktreeSidebarFault = "error"` set, `r` makes a group show "Couldn't read
  worktrees"; `Shift+B` folds to the rail, where the changed checkout carries the dot, and back.
- `CHANGELOG.md`: one `Changed` line under Unreleased.

## Deviations

What the code does where it departs from the decisions above. The decisions stay as written; these entries
carry the change.

1. **The sidebar folds itself in a narrow window (departs from decision 4 and section 4).** The human chose
   this during the run, on 2026-10-09.
   - Why: at the shipped 1000x700 window, the open 240px sidebar left the diff pane about 338px wide, and
     `diff-compare` step 5 needs at least 400px.
   - What the code does: `sidebarFoldedAtom` is `boolean | null`, still persisted under
     `cockpit.files.sidebar.folded`.
     - `null` means follow the width. With no explicit choice, the sidebar shows as its rail when the whole
       Diff surface, sidebar included, is narrower than `SIDEBAR_FOLD_PX` (1000px). This uses
       `resolveSidebarFolded` in `difflayout.ts`, the same rule as the History column's `resolveCollapsed`.
     - An explicit choice always wins. A `Shift+B` press, the fold button, or "Choose a source" writes the
       choice. The automatic fold is never persisted.
     - The view and the `files:toggle-sidebar` binding read the derived `sidebarShownFoldedAtom`.
   - Consequence: at the shipped 1000x700 window, the Diff surface opens with the rail until the person
     unfolds it once. In a wider or maximized window it opens as decision 4 says.
2. **The user's collapse wins over the current source (departs from decision 1).** The group holding the
   current source is added to `sidebarExpandedAtom` when the scope changes, so it opens by itself. Its
   header can still collapse it: `expanded` is "an active query, or the user's set". Forcing that group open
   would have made the header click do nothing on the group a person is most likely to collapse. The lead
   decided this during the run.
3. **A filter reads collapsed groups (departs from decision 7).** While the filter is non-empty, every group
   not read yet is loaded with `status: true`. Without that read, branches and paths in collapsed projects
   could never match, as section 3's filter rule requires. These reads are not written to the expanded set,
   so the groups stay collapsed once the filter clears.

## Out of scope

Staging, committing or discarding from the sidebar; creating or removing worktrees; a branches tree
(the IntelliJ Branches pane); agent/run labels and last-commit time on worktree rows; unregistered
repos that only an agent points at (they appear as agents under Other agents, as today).
