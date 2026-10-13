# Code surface: browsing beyond the project registry

**Date:** 2026-09-04
**Status:** shipped (all three phases). One deviation from decision 1: there is no persisted
`CodeProject.kind`. "Plain" is `codePlainAtom` in `codestore.ts`, derived from the loaded index's
`isRepo`, so the stored selection and recents carry no second copy of a fact the index already holds.
**Design source:** none — no mockup. Extends the surface's existing project-picker popover.
**Predecessors:** `2026-08-03-code-browser-surface-design.md` (decision 2, "one `git ls-files` call is
the single source of truth", which this spec qualifies).
**Reopens:** the 08-03 out-of-scope line "Browsing non-git directories".
**Third of three.** Siblings, same date: `2026-09-04-code-git-aware-mutable-tree-design.md` (spec 1),
`2026-09-04-code-search-and-symbols-design.md` (spec 2). This one goes **last**: it changes the data
source both of the others sit on.

## Why

The picker offers exactly the projects in the config registry. Three things you routinely want to read
are not reachable through it:

**Worktrees.** `launchAgent` creates them (`gitinfo.CreateWorktree`), so an agent's work frequently
lives in a directory the registry has never heard of. The Diff surface can show that worktree's
changes; the Code surface can only be *sent* there — `openInCode` from a diff row already browses an
unregistered path, because `resolveJumpProject` falls back to the directory's basename when the
registry does not know it. So the surface can already display an unregistered repository. It just
cannot be *asked* to.

**Any other repository on disk.** A dependency you cloned to read, a sibling project, an old checkout.
Registering it in Settings to read one file is a heavy gesture with a lasting side effect.

**Directories that are not repositories at all.** A notes folder, an unpacked archive, a scratch
directory. `git ls-files` returns `isrepo: false` and the surface says "Not a git repository" — which
is accurate and useless.

The first two need no new concept: they are git repositories, and everything already works once the
path is selectable. The third needs a real second data source, and that is what makes this a spec of
its own rather than a picker tweak.

## What already exists — do not rebuild it

| Piece | Where | State |
|---|---|---|
| Browsing an unregistered path | `resolveJumpProject` in `codestore.ts` | Shipped. Names an unknown repository by its basename and browses it. This spec generalizes an existing behaviour rather than inventing one. |
| Index load and cache | `loadIndex`, `indexCache`, `refreshIndex` in `codestore.ts` | Shipped, keyed by project path, with a guard token. Gains one branch. |
| `isrepo` on the index | `CodeIndex.isRepo`, from `GitListFilesCommand` | Shipped. Today it drives an empty state; it becomes the branch condition. |
| Worktree path convention | `gitinfo.WorktreePath(repoPath, branch)`, `CreateWorktree` (`gitinfo.go:439`, `:446`) | Shipped. There is no *list* reader yet — this spec adds one. |
| Path stat | `FileInfoCommand` → `NotFound`, `IsDir`, `Path` (`~` expanded, separators normalized to `/`) | Shipped. Validates a typed path with no new backend. |
| Persisted last selection | `lastCodeProjectAtom` via `atomWithStorage("code.project.last", …, { getOnInit: true })` | Shipped. The recents list follows the same pattern and the same `getOnInit` reasoning. |
| Path helpers | `joinRepoPath`, `repoBasename`, `sameRepoPath` in `frontend/util/paths.ts` | Shipped. `sameRepoPath` is the separator-insensitive comparison every path check here uses. |
| Picker popover | The `PopoverReveal` project chip in `codesurface.tsx` | Shipped. Grows sections rather than being replaced. |
| Registry source | `projectsAtom` off `fullConfigAtom` (`projectsstore.ts`) | Shipped, unchanged. This spec adds sources beside it; it does not touch how projects are registered. |

## Resolved decisions

**1. `CodeProject` gains a `kind`, and every git-dependent feature branches on it explicitly.**

```ts
export interface CodeProject {
    name: string;
    path: string;
    kind: "git" | "plain";   // absent in stored values from before this change; treated as "git"
}
```

The alternative — inferring "is this a repo" from `codeIndexAtom.isRepo` at each call site — spreads
one fact across the tree, the search pane, the status loader and the diff toggle, and each of them
would have to handle "index not loaded yet". One field, set once when the index resolves.

**2. A `plain` root degrades visibly, never silently.** Git status, the Changed tab and the Diff view
(all from spec 1) are *disabled with a reason*, not hidden: "Not a git repository — no change
tracking." Hiding them would make the surface look different for reasons the user cannot see. Editing,
saving, the finder, the outline (spec 2), search and mutations all keep working, because none of them
needs git.

**3. The walker does not reimplement `.gitignore`.** For a `plain` root the ignore policy is a fixed
skip set — `.git`, `node_modules`, `target`, `dist`, `build`, `out`, `.venv`, `venv`,
`__pycache__`, `vendor`, `.next`, `.cache` — plus dot-directories other than the root itself.

Parsing `.gitignore` correctly means precedence rules, negation, directory-vs-file semantics, nested
files and `**` globs — a well-known package of subtle behaviour that git already implements and that we
would be reimplementing *for directories that are not git repositories*, where a `.gitignore` usually
does not exist. The skip set is stated in the UI when a `plain` root is selected, so the policy is
visible rather than mysterious.

**4. Non-git search is a Go-side scan, not a shell-out to another tool.** `ripgrep` and `grep` are not
guaranteed present on Windows, and depending on one would make search work or not by machine. A
`bufio.Scanner` over the walked file list, with the same 500-match cap and the same `GrepResult` shape
the git path returns, keeps one result type through the whole frontend. It is slower than `git grep`;
that is the honest cost of searching a directory git is not indexing.

The scan honors the same `GrepOpts` as spec 2 by compiling the query to a Go `regexp` (`regexp.QuoteMeta`
for the non-regex case, `(?i)` for case-insensitive, `\b` wrappers for whole-word — Go's RE2 supports
`\b`, unlike the git ERE constraint spec 2 works under).

**5. Worktrees are listed for the *selected* repository, not discovered globally.** `git worktree list
--porcelain` run in the current project's directory answers "what other checkouts of this repo exist",
which is the actual question. Scanning the disk for worktrees would be a background crawl for a list
that is one subprocess call away.

**6. Recents are keyed by path, capped at eight, and carry their `kind`.** Stored with
`atomWithStorage` beside `code.project.last`, with `getOnInit: true` for the same reason: without it
the stored value arrives one render late and the picker flashes empty. A recent entry whose path no
longer exists is not pruned eagerly — it is marked unavailable when selecting it fails, which avoids
statting eight paths every time the popover opens.

**7. A typed path is validated by stat before anything else happens.** `FileInfoCommand` answers
not-found and not-a-directory before an index load is attempted, so the two most likely typos produce a
precise message instead of an empty tree. `~` is expanded by the backend, so `~/src/foo` works as
typed.

**8. Nothing here changes how projects are registered.** The registry stays the curated list and stays
first in the picker. This spec adds ways to *reach* a directory, not a second registry. A path opened
ad hoc is remembered in recents and nowhere else.

**9. Symlinks are not followed during the walk.** A symlink loop would hang the walk, and the file cap
would turn an infinite loop into a merely wrong answer. `filepath.WalkDir` does not follow them by
default; this decision is recording that it stays that way.

## 1. Backend

### Worktree reader, in `pkg/gitinfo/gitinfo.go`

```go
type Worktree struct {
    Path   string
    Branch string // short name; empty when detached
    IsMain bool
    Locked bool
}

// ListWorktrees returns every checkout of the repository at cwd, main first. It returns an empty
// slice and no error when cwd is not a repository, so the caller degrades without an error surface —
// the same posture ListBranches takes.
func ListWorktrees(ctx context.Context, cwd string) ([]Worktree, error)
```

Parses `git worktree list --porcelain`: records separated by blank lines, `worktree <path>`,
`branch refs/heads/<name>`, `detached`, `locked`. The first record is the main worktree.

### Walker, in a new `pkg/gitinfo/walk.go` (or `pkg/filescan`, decided at implementation)

```go
// WalkFiles enumerates the files under root, skipping the fixed ignore set (decision 3) and not
// following symlinks. Paths are root-relative with forward slashes, sorted, capped at maxWalkFiles.
func WalkFiles(ctx context.Context, root string) (*FileList, error)
```

Returns the **existing** `FileList` shape (`Paths`, `IsRepo`, `Truncated`) with `IsRepo: false`, so the
frontend's `CodeIndex` needs no new variant. Same `maxListFiles = 20000` cap, and a depth ceiling so a
pathological tree cannot walk forever.

### Plain search, beside the walker

```go
// ScanGrep searches file contents under root using the walk above. Same result shape and same cap as
// gitinfo.Grep, so the frontend has one search result type.
func ScanGrep(ctx context.Context, root, query string, opts GrepOpts) (*GrepResult, error)
```

Skips files that fail the same binary and size gates the frontend applies when opening one — a NUL byte
in the first 8 KB, or a size over the view ceiling — so a scan cannot spend its budget inside a
compiled artifact. Honors the context deadline and returns what it has when the deadline fires, with
`Truncated: true`.

### Commands, in `pkg/wshrpc/wshrpctypes_git.go`

```go
GitListWorktreesCommand(ctx context.Context, data CommandGitListWorktreesData) (*CommandGitListWorktreesRtnData, error)
```

`GitListFilesCommand` and `GitGrepCommand` each gain an `allowplain bool` on their data: when the path
is not a repository and `allowplain` is set, the handler falls through to `WalkFiles` / `ScanGrep`
instead of returning `isrepo: false`. One command per concept, with the fallback inside the handler,
rather than four commands the frontend has to choose between.

`task generate` afterward; never hand-edit the generated TS.

## 2. Frontend

### Pure modules — each with a `.test.ts` beside it

**`coderecents.ts`**

```ts
export interface RecentProject { name: string; path: string; kind: "git" | "plain"; at: number }

// most recent first, deduped by path with sameRepoPath, capped at MAX_RECENTS
export function pushRecent(list: readonly RecentProject[], p: CodeProject): RecentProject[];
export function pruneRecent(list: readonly RecentProject[], path: string): RecentProject[];
```

**`codepathinput.ts`**

```ts
export type PathError = "empty" | "relative" | "notfound" | "notdir";
// the shape checks that need no IO; notfound/notdir come from the stat and are formatted here
export function validatePathInput(raw: string): PathError | null;
export function pathErrorMessage(e: PathError, raw: string): string;
```

Split from the stat deliberately: the shape rules are testable without a backend, and the store owns
the one RPC.

### State

```ts
// codestore.ts
export const codeRecentsAtom = atomWithStorage<RecentProject[]>("code.project.recents", [], undefined, {
    getOnInit: true,
});
export const codeWorktreesAtom: PrimitiveAtom<Worktree[]>;      // for the selected project
export const codePickerErrorAtom: PrimitiveAtom<string | null>; // typed-path validation feedback
```

`selectProject` gains three things: it records the selection into `codeRecentsAtom`, it clears
`codeWorktreesAtom` and lazily reloads it, and — the load-bearing change — `loadIndex` sets
`project.kind` from what the index returned:

```ts
const res = await RpcApi.GitListFilesCommand(TabRpcClient, { cwd: p.path, allowplain: true });
// isrepo now distinguishes the two readers rather than gating the surface
const kind = res.isrepo ? "git" : "plain";
```

`resolveJumpProject` returns `kind: "git"` for a registry hit and, for an unregistered path, the kind
the index resolves — so the existing diff-row and Radar entry points get worktree and plain-directory
support for free.

`runSearch` (spec 2) passes `allowplain: true` and needs no other change, because `ScanGrep` returns the
same shape.

### Components

**The picker** (`codesurface.tsx`) becomes a sectioned popover, sections omitted when empty:

```
┌ Projects ─────────────────────────┐
│ waveterm      C:\...\waveterm     │
│ obsidian      C:\...\Work         │
├ Worktrees ────────────────────────┤
│ feat/code-tree   C:\...\wt\code   │
├ Recent ───────────────────────────┤
│ rust-analyzer  C:\src\ra   (git)  │
│ notes          D:\notes    (plain)│
├───────────────────────────────────┤
│ [ path or paste…            ] [→] │
└───────────────────────────────────┘
```

The path input validates on submit: shape rules from `codepathinput.ts`, then one `FileInfoCommand`,
then `selectProject`. Errors render inside the popover, which stays open.

**The header subtitle** gains a "not a repository" marker for a `plain` root, next to the path that is
already shown.

**Disabled affordances** (decision 2) — for `kind === "plain"`, the Changed tab and the Diff toggle
render disabled with a title reading "Not a git repository — no change tracking", and `loadStatus` is
never called. The tree renders a one-line footer naming the skip set so the ignore policy is visible:
"Skipping node_modules, dist, target and other build directories."

### Keybindings

None new. The picker is mouse-and-type; the existing `Ctrl+P` finder, `r` refresh and tree keys work
identically on both kinds of root.

## 3. Failure modes

| Situation | What the user sees |
|---|---|
| Typed path does not exist | "No such directory: `<path>`" inside the popover, which stays open |
| Typed path is a file | "That is a file, not a directory" |
| Typed path is relative | "Enter an absolute path" — there is no cwd to resolve against |
| Typed path is a huge tree | The existing truncation line, now also reachable via the walk cap |
| Recent entry whose directory is gone | Selecting it fails with the not-found message and the entry is pruned from recents at that point (decision 6) |
| `git worktree list` fails | The Worktrees section is omitted. It is an enhancement to the picker, not a state the surface depends on |
| Repo has only the main worktree | The section is omitted rather than showing a single row duplicating the current selection |
| Plain root, user wants a diff | Diff toggle disabled with its reason |
| Plain root, search | Works, via `ScanGrep`, and is slower. The search pane's existing "Searching…" state covers it |
| Scan hits the context deadline | Results so far, with the existing truncation line |
| Stored project from before this change | No `kind` field; treated as `git`, and corrected on the next index load |

## 4. Testing

**Vitest:**

- `coderecents.test.ts` — `pushRecent` dedupes with `sameRepoPath` (so `C:\x` and `C:/x` are one
  entry), moves an existing entry to the front, caps at the maximum, and preserves `kind`;
  `pruneRecent` removes by path.
- `codepathinput.test.ts` — empty, relative, and well-formed inputs on both separator styles.
- `codestore.test.ts` (extended) — `loadIndex` sets `kind: "plain"` when the index reports
  `isrepo: false`, and `selectProject` records a recent.

**Go**, on the existing temp-directory harness:

- `ListWorktrees` — main worktree only; main plus one linked worktree with its branch; a detached
  worktree yields an empty branch; a non-repository returns an empty slice and no error.
- `WalkFiles` — nested files found; every member of the skip set excluded; a dot-directory excluded;
  a symlink to a parent directory does not recurse; the cap sets `Truncated`; paths come back sorted
  with forward slashes.
- `ScanGrep` — finds a match with a line number; respects `CaseSensitive`, `WholeWord` and `Regex`;
  skips a file containing a NUL byte; caps at 500 with `Truncated`.

```powershell
$env:CGO_CFLAGS = "-O2 -g -I$((Get-Location).Path -replace '\\','/')/pkg/jarvisembed/csrc"
go test ./pkg/gitinfo/...
```

**CDP**, in `scripts/cdp/scenarios.mjs` (hand-formatted, never Prettier'd):

- `code-plain-dir` — open the picker, type a known non-repo directory, submit, assert the tree
  populated, assert the Changed tab is disabled, open a file and assert the editor mounted.
- `code-worktrees` — with a repo selected that has a worktree, assert the Worktrees section lists it.
  Skipped when the dev machine has no worktree, rather than fabricating one.

**Typecheck** with `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`.

## 5. Suggested phasing

1. `ListWorktrees` + command + `task generate`; the picker's Worktrees section. Pure addition — nothing
   existing changes behaviour.
2. `coderecents.ts` + `codepathinput.ts` + tests; the Recent section and the path input, still
   git-only (a non-repo path keeps today's empty state).
3. `WalkFiles` + `ScanGrep` + `allowplain`; `CodeProject.kind`; the disabled affordances and the skip-set
   footer.

Phase 3 is the only one that changes existing behaviour, and it lands after the picker is already
useful.

## 6. Note on reach

This makes any directory on the machine browsable and editable from the cockpit. That is not a new
capability of the process — `FileReadCommand` and `FileWriteCommand` are already unrestricted, and
`resolveJumpProject` already browses unregistered paths — but it is the first time the *UI* offers it
as a gesture. No sandbox or allowlist is proposed here: the app runs as the user, against the user's
own machine, and every agent it launches already has the same reach.

## 7. Explicitly out of scope

Creating, removing or pruning worktrees from this surface (`launchAgent` owns worktree creation).
Remote or SSH roots — the `Remote*` file RPCs exist, but a remote root means remote git, remote walk
and remote grep, and it is a spec of its own. A directory picker dialog (the Tauri shell exposes no
file-dialog command today; typing or pasting a path is the whole gesture). Registering a browsed path
into the project registry from here. Honoring `.gitignore` in the walker (decision 3). Watching a plain
root for changes. Everything out of scope in the 08-03, 08-06 and 08-15 specs, and in specs 1 and 2,
stands.
