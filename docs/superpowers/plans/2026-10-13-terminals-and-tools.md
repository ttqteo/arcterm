# Terminals and tools — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Terminals become peers of agents in one tree per project and take the centre when picked; a library of
TUI tools (lazygit, yazi, btop…) can be installed and opened in the right folder from Setup → Tools, an "Open a
tool" picker and the New dialog.

**Architecture:** A Go catalog (`pkg/arctools`) plus user tools from `tools.json` (a new `FullConfigType` map) are
reported by one wshrpc command with PATH status. A tool opens as a plain terminal (`controller: "shell"`,
`cmd:firstcommand` = the tool's command, new block meta `tool:id`) in the focused agent's folder. The Agent surface's
sidebar model merges agents and terminals per project; the grid accepts terminals as cells; picking a terminal no
longer docks it, and the dock gains a folded strip.

**Tech Stack:** Go (`pkg/arctools`, `pkg/wconfig`, `pkg/wshrpc`, `pkg/waveobj`), React 19 + jotai
(`frontend/app/view/agents`, `frontend/app/cockpit`), vitest, CDP scenarios (`scripts/cdp/scenarios.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-13-terminals-and-tools-design.md`

**Prototype:** D:\work\arcterm\.superpowers\design\terminal-tui\project\

**Verify:** `node scripts/verify.mjs ./pkg/arctools/... ./pkg/wconfig/... ./pkg/wshrpc/...`

**Final:** `node scripts/cdp/final-verify.mjs tools-tree tools-centre tools-split tools-dock-strip tools-library tools-add tools-picker tools-launcher tools-worktree-gone`

---

Ground rules for every task:

- Frontend logic goes in a pure `foo.ts` with `foo.test.ts` beside it; `.tsx` stays thin (AGENTS.md "Testable logic
  is extracted"). No jsdom tests.
- Colors only from `@theme` tokens (`frontend/tailwindsetup.css`); match the boards in the Prototype folder for sizes,
  copy and states. Read `DESIGN.md` before styling.
- Never hand-edit generated files; run `task generate` after Go type changes.
- Typecheck with `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit` (about 2 minutes, give it a longer timeout). Never `task check:ts`: in an engine
  worktree it runs `npm install`, which replaces the `node_modules` junction. Never `npx tsc` (it stack-overflows).
- Commit only the files your task lists (`git commit -- <paths>`); no `Co-Authored-By` trailer. Leave `CHANGELOG.md`
  and docs to Task 11.
- The `data-*` attributes named in each task are what Task 10's scenarios select on: use them exactly. Each UI task's
  **Shown by** line names the Task 10 scenario steps that show its views; build what those steps select.

### Task 1: Tool catalog, user tools config and status RPC (Go)

**Depends on:** none

**Files:** `pkg/arctools/catalog.go`, `pkg/arctools/catalog_test.go`, `pkg/arctools/status.go`, `pkg/arctools/status_test.go`, `pkg/wconfig/settingsconfig.go`, `pkg/waveobj/wtypemeta.go`, `pkg/wshrpc/wshrpctypes_tools.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshserver/wshserver_tools.go`, `pkg/waveobj/metaconsts.go`, `pkg/wconfig/metaconsts.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/app/store/services.ts`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`

**Step 1: The catalog type and entries.** Create `pkg/arctools/catalog.go`:

```go
// Package arctools is arcterm's library of terminal tools (TUIs): the built-in catalog, the user's own entries from
// tools.json, and whether each one's command resolves on this machine.
package arctools

type Install struct {
	Windows string `json:"windows,omitempty"` // a winget command line
	Darwin  string `json:"darwin,omitempty"`  // a brew command line
}

type Tool struct {
	Id       string  `json:"id"`
	Name     string  `json:"name"`
	Category string  `json:"category"` // "Git", "Files", "System", "Containers", "Docs and data", "Yours"
	Purpose  string  `json:"purpose"`
	Command  string  `json:"command"`        // the program, e.g. "lazygit"
	Args     string  `json:"args,omitempty"` // appended to Command as typed
	OpensIn  string  `json:"opensin"`        // "agent" (the focused agent's folder), "root" (project root), "home"
	Shows    string  `json:"shows"`          // "centre" or "panel"
	Install  Install `json:"install"`
	User     bool    `json:"user,omitempty"`
}
```

Add `func Builtin() []Tool` returning, in this order: lazygit (Git, "Git: stage single lines, commit, branch, rebase"),
gitui (Git), yazi (Files, "Files: browse, preview, rename, move"), broot (Files), btop (System, "System: CPU, memory,
processes", OpensIn "home"), lazydocker (Containers, "Docker: containers, images, logs"), k9s (Containers), glow (Docs
and data, "Markdown: read docs and plans in the terminal"), visidata (Docs and data, command `vd`). Every built-in has
OpensIn "agent" unless stated, Shows "centre", and install lines for winget and brew. Look each winget id up
(`winget search <name>` or winget-pkgs) and put the real one in; where none exists leave `Windows` empty. A comment at
the top of the list says the ids were checked on the date you checked them.

**Step 2: Write the failing tests** in `pkg/arctools/catalog_test.go`: `TestBuiltinIdsUnique` (ids unique and
non-empty), `TestBuiltinFieldsValid` (Category in the set above minus "Yours", OpensIn in agent/root/home, Shows in
centre/panel, Command non-empty), and `TestMergeUserTools`:

```go
func TestMergeUserTools(t *testing.T) {
	user := map[string]wconfig.ToolKeywords{
		"ghdash":  {Name: "PR dashboard", Command: "gh", Args: "dash", OpensIn: "root"},
		"lazygit": {Name: "lazygit", Command: "lazygit", Args: "--debug"}, // a user entry overrides a built-in by id
	}
	got := Merge(Builtin(), user)
	// built-ins keep their order; overridden lazygit keeps its slot with the user's fields and User=true
	// user-only entries follow, sorted by id, Category "Yours", Shows defaulting to "centre", OpensIn to "agent"
}
```

Fill in the assertions for each comment. Run: `go test ./pkg/arctools -run 'TestBuiltin|TestMergeUserTools'`
Expected: FAIL (Merge and wconfig.ToolKeywords undefined).

**Step 3: User tools in config.** In `pkg/wconfig/settingsconfig.go` add beside `ProjectsFile`:
`ToolsFile = "tools.json"`, a `ToolKeywords` struct (`Name`, `Command`, `Args`, `OpensIn`, `Shows`, `Purpose`,
`InstallWindows` `json:"install:windows,omitempty"`, `InstallDarwin` `json:"install:darwin,omitempty"`), and a
`Tools map[string]ToolKeywords \`json:"tools"\`` field on `FullConfigType` next to `Projects`, so `tools.json` in the
config dir is read and watched like `projects.json`. Add `SetUserTool(id string, t *ToolKeywords) error` that rewrites
`tools.json` with that entry set (nil removes it), following `SetProjectConfigValue` / `DeleteProjectConfigValue`.

**Step 4: Merge.** In `catalog.go` add `func Merge(builtin []Tool, user map[string]wconfig.ToolKeywords) []Tool`
implementing the test above; a user entry's `InstallWindows` / `InstallDarwin` become its `Install` lines (assert this
in `TestMergeUserTools` too). Run the Step 2 command. Expected: PASS.

**Step 5: Status, failing test first.** `pkg/arctools/status.go`:

```go
type ToolStatus struct {
	Tool
	Found bool   `json:"found"`
	Path  string `json:"path,omitempty"`
}

// Status resolves each tool's command with lookPath (exec.LookPath in production; a fake in tests).
func Status(tools []Tool, lookPath func(string) (string, error)) []ToolStatus
```

`status_test.go`: `TestStatusFoundAndMissing` with a fake lookPath that knows only "lazygit". Run:
`go test ./pkg/arctools -run TestStatus` → FAIL, implement, → PASS.

**Step 6: Block meta.** In `pkg/waveobj/wtypemeta.go` add, after the `cmd:*` keys,
`ToolId string \`json:"tool:id,omitempty"\`` (the library id of a terminal opened as a tool).

**Step 7: The RPC.** Create `pkg/wshrpc/wshrpctypes_tools.go` following `wshrpctypes_agentsync.go`:

```go
type ToolsCommands interface {
	ToolsStatusCommand(ctx context.Context) (*CommandToolsStatusRtnData, error)
	ToolsSetUserCommand(ctx context.Context, data CommandToolsSetUserData) error
}
type CommandToolsStatusRtnData struct {
	Tools []arctools.ToolStatus `json:"tools"`
}
type CommandToolsSetUserData struct {
	Id   string                `json:"id"`
	Tool *wconfig.ToolKeywords `json:"tool,omitempty"` // nil removes the user entry
}
```

Embed `ToolsCommands` where `AgentSyncCommands` is embedded (grep `AgentSyncCommands` in `pkg/wshrpc`). If importing
`arctools` into `wshrpc` makes a cycle, define the status struct in `wshrpc` instead and convert. Implement both in
`pkg/wshrpc/wshserver/wshserver_tools.go`: status = `arctools.Status(arctools.Merge(arctools.Builtin(),
wconfig.GetWatcher().GetFullConfig().Tools), exec.LookPath)`; set = `wconfig.SetUserTool`, rejecting an empty id or
command with an error that says which field is missing.

**Step 8: Generate and build.** Run `task generate`, then `go build ./...` and
`go test ./pkg/arctools ./pkg/wconfig -run 'TestBuiltin|TestMergeUserTools|TestStatus'`. Expected: build OK, PASS.
Check that `frontend/app/store/wshclientapi.ts` now has `ToolsStatusCommand` and `ToolsSetUserCommand` and
`frontend/types/gotypes.d.ts` has `ToolStatus`, `ToolKeywords` and `"tool:id"`.

**Step 9: Commit** the Files list with `feat(tools): a built-in tool catalog, user tools in tools.json, and a status RPC`.

### Task 2: One tree per project (pure model)

**Depends on:** Task 1

**Files:** `frontend/app/view/agents/agentsidebarmodel.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `frontend/app/view/agents/activenav.ts`, `frontend/app/view/agents/agentsviewmodel.ts`, `frontend/app/view/agents/agentsviewmodel.test.ts`, `frontend/app/view/agents/liveagents.ts`

Facts: `buildAgentTree` (`agenttreemodel.ts:205`) emits a `group` row per project then its body; `activeView`
(`agentsidebarmodel.ts:283`), `splitActive` (`:344`, lifts only `parent` rows), `terminalTree` (`:406`) and
`activeAgentIds` (`:312`) feed `agenttree.tsx` and `activenav.ts:17`. Terminals are `AgentVM` with
`kind: "terminal"` in `model.terminalsAtom`, never in `agentsAtom`. `deriveTerminalVMs` (`agentsviewmodel.ts:605`) has
`cwd` in its input but does not put it on the VM. Test fixtures in `agentsidebarmodel.test.ts`: `agent()` `:65`,
`treeOf()` `:86`, local `term(id, project)` `:732`.

**Step 1: Carry cwd and the tool id on terminal VMs.** In `deriveTerminalVMs`, set `cwd` on the VM from the row input
(the field already exists on `AgentVM`, `:99`; update its comment: background agents and terminals). Add
`toolId?: string` to `AgentVM` (a terminal opened from the tool library: block meta `tool:id`, which Task 1 added) and a
`toolId: (blockId) => string | undefined` callback to `deriveTerminalVMs` (default `() => undefined`, like its other
callbacks) that sets it. `liveTerminalsAtom` (`liveagents.ts:104`) passes a callback reading
`get(WOS.getWaveObjectAtom<Block>("block:" + blockId))?.meta?.["tool:id"]`. Test in `agentsviewmodel.test.ts` beside
the existing `deriveTerminalVMs` cases: `it("carries a terminal's cwd and tool id")`. This is what lets a tool row show
the tool's name and icon (Task 5), Library's Open now find its terminals (Task 6) and the worktree-removed card reopen
the same tool (Task 9).

**Step 2: Write the failing tests** in `agentsidebarmodel.test.ts`, a new `describe("projectTree")`:

- agents of a project come first, then a `divider` row, then that project's terminals (in `terminalTree`'s order);
  a project with no terminals has no divider; a project with only terminals has a group row and its terminals;
- terminals with no project go under a `Home` group (`project: HOME_PROJECT`), last;
- a folded project keeps its group row with `agents` and `terminals` counts and drops its body;
- with `filter` set to one project: that project's rows, no group row (as `activeView` does today);
- split placement: given grid cells all in project A (agents or terminals), one `split` row sits first in A's body and
  those ids are not repeated as rows; cells across projects give one `split` row at the very top with
  `crossProject: true`; fewer than two cells: no split row;
- `terminalPlace(cwd, root)`: `undefined` when the normalized paths are equal (case-insensitive, `\` and `/` alike,
  trailing separator ignored); else the last path segment of `cwd` (e.g. `fix-login-agent`);
- `treeNavIds(rows)`: agent and terminal ids in display order (the split's cells first, as `activeAgentIds` does).

**Step 3: Run:** `npx vitest run frontend/app/view/agents/agentsidebarmodel.test.ts -t "projectTree"` — FAIL.

**Step 4: Implement** in `agentsidebarmodel.ts`:

```ts
export const HOME_PROJECT = "~home";
export type ProjectTreeRow =
    | { kind: "group"; project: string; agents: number; terminals: number; attn: number; open: boolean }
    | { kind: "split"; project: string | null; cells: AgentVM[]; crossProject: boolean }
    | { kind: "divider"; project: string }
    | { kind: "terminal"; project: string; terminal: AgentVM; place?: string }
    | AgentTreeRow; // the agent body rows buildAgentTree already emits (parent, lead, run, worker, …)

export function projectTree(input: {
    tree: AgentTreeRow[]; // buildAgentTree output
    terminals: AgentVM[];
    cells: readonly string[]; // reconciled grid ids
    roster: AgentVM[]; // agents + terminals, to resolve cells
    filter: string; // ALL_PROJECTS or a project name
    collapsed: readonly string[];
    roots: ReadonlyMap<string, string>; // project name -> root path
}): ProjectTreeRow[];
export function terminalPlace(cwd: string | undefined, root: string | undefined): string | undefined;
export function treeNavIds(rows: ProjectTreeRow[]): string[];
```

Reuse `splitActive`'s folder bookkeeping rather than copying it; extend it so a terminal cell is lifted too. Keep
`activeView`, `terminalTree` and `splitActive` exported until Task 5 stops using them, then Task 5 deletes what is
unused. Update the file header comment (it still describes three sections).

**Step 5: Nav order.** `activenav.ts` `activeNavOrder(model)` returns `treeNavIds(projectTree(...))` built from
agents **and** `model.terminalsAtom`, so `j`/`k` and Alt+1..9 walk terminals too. Pass terminals to `eligibleIds` as
well (Task 3 makes the grid accept them).

**Step 6: Run** the Step 3 command and `npx vitest run frontend/app/view/agents/agentsidebarmodel.test.ts` — PASS.

**Step 7: Commit** with `feat(agents): one tree per project in the sidebar model, terminals included`.

### Task 3: Terminals take the centre, join the grid, and the dock folds

**Depends on:** Task 2

**Files:** `frontend/app/view/agents/gridstore.ts`, `frontend/app/view/agents/gridstore.test.ts`, `frontend/app/view/agents/terminaldock.ts`, `frontend/app/view/agents/terminaldock.test.ts`, `frontend/app/view/agents/railstore.ts`, `frontend/app/view/agents/terminaldockbar.tsx`, `frontend/app/view/agents/agentsurface.tsx`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/view/agents/terminalpanehead.ts`, `frontend/app/view/agents/terminalpanehead.test.ts`, `frontend/app/view/agents/terminalpanehead.tsx`, `frontend/app/view/agents/cockpitsurfacemodel.ts`, `frontend/app/view/agents/cockpitsurfacemodel.test.ts`, `frontend/app/view/agents/agentgridfocus.test.ts`, `frontend/app/store/keybindings/bindings.ts`

Facts: `eligibleIds(agents)` (`gridstore.ts:46`) is the only "agents only" gate, and callers pass `agentsAtom`;
`GridModel` (`:40`) has no `terminalsAtom`. `splitDock` (`terminaldock.ts:51`, rule `:55-58`) docks a focused terminal
under its host agent and the surface writes `focusIdAtom` back to the agent (`agentsurface.tsx:112, 139-151`).
`resolveShownAgent` (`cockpitsurfacemodel.ts:48`) already returns a focused terminal; it is `splitDock` running first
that swaps a focused terminal for its host agent, and the fallback with nothing in focus picks a terminal only when no
agent exists (`agentsurface.tsx:98-124`). `agentgridfocus.test.ts:80-86` asserts a focused terminal leaves the grid
untouched, the rule this task changes.
Dock state: `railstore.ts:66-78`; dock bar `terminaldockbar.tsx`; surface dock wrapper `agentsurface.tsx:571-615`.
`agentheader.tsx:251` `canSplit` excludes terminals; `:669` hides the agent header for a terminal. Ctrl+Tab's recent
list follows `focusIdAtom` (`tabswitcherstore.ts`), so a terminal must be able to hold `focusIdAtom`.

**Step 1: Failing tests.**
- `terminaldock.test.ts`: picking a terminal no longer docks it: `splitDock({focused: terminal, docked: null,
  host: agent, ...})` returns `focused: terminal`, `dockedId: null`; an explicitly docked id (`docked` set by
  "Move to the panel") stays docked under the shown agent; a docked terminal that becomes focused is undocked.
- `gridstore.test.ts`: `canOpenInSplit` / `openInSplit` / `dropAgentOnGrid` accept a terminal with a `blockId` once
  `GridModel` carries `terminalsAtom`; `eligibleIds` of agents + terminals.
- `terminalpanehead.test.ts` for a new pure `terminalPaneHead(terminal, previous, roots)` (`roots`: project name →
  root path, as Task 2's `projectTree` takes): returns `{ name, place, backTo }` where `name` is the terminal's name
  (Task 5 adds the tool's name and icon), `place` is Task 2's `terminalPlace(terminal.cwd, roots.get(terminal.project))`
  and `backTo` is the name of the previous tab from the recent list when it is an agent, else `undefined`.
- `cockpitsurfacemodel.test.ts`: `it("a focused terminal is shown while agents exist, and with nothing focused an
  agent still comes before a terminal")`; update the `resolveShownAgent` doc comment to say so.
- `agentgridfocus.test.ts`: replace "a terminal or a done worker leaves the grid untouched…" with
  `it("a terminal with a block takes a cell by the agents' rule, and a done worker leaves the grid untouched")`
  (terminal ids are now in `eligible`).

Run: `npx vitest run frontend/app/view/agents/terminaldock.test.ts frontend/app/view/agents/gridstore.test.ts frontend/app/view/agents/terminalpanehead.test.ts frontend/app/view/agents/cockpitsurfacemodel.test.ts frontend/app/view/agents/agentgridfocus.test.ts` — FAIL.

**Step 2: Implement.**
- `splitDock`: dock only `docked` (an explicit choice); a focused terminal is shown in the centre. Keep the size
  helpers as they are.
- `agentsurface.tsx`: a focused terminal is shown even when agents exist; drop the effects that write `focusIdAtom`
  back to the host agent (`:139-151`), so `focusIdAtom` keeps the terminal's id (it is how Ctrl+Tab's quick flip returns
  to the agent). Update the comments at `:98-112`.
- `GridModel` gains `terminalsAtom`; every `eligibleIds` caller you own passes agents and terminals; `liveIds` covers
  both. `agentsurface.tsx:106` passes both.
- `railstore.ts`: `terminalDockFoldedAtom` (localStorage `agent.terminalDock.folded`, default `false`) and a
  `moveToDock(model, id)` / `undock(model, id)` pair that sets `dockedTerminalAtom` and focuses the agent shown before.
- `terminaldockbar.tsx` + the surface's dock wrapper: when folded, the dock is a 32 px strip (`data-dock-strip`):
  terminal icon, name, running dot, the latest output line truncated (read the block's last line the way the
  terminal's title is derived today; if there is no cheap source, show the cwd instead and note it in the commit),
  the chord chip and an expand button. Unfolded it is today's panel plus a fold button and "Open in split"
  (`data-dock-open-split`: `undock`, then `openInSplit` beside the shown agent). Board: Compact (strip), Main (panel
  open).
- Terminal pane header (the header shown for a terminal in the centre or a cell; `agentheader.tsx` hides the agent
  header for terminals at `:669`, so render a slim one, the component in `terminalpanehead.tsx`): icon, name, branch chip from `place`, project name, the hint
  "Ctrl Tab back to <agent>" when `backTo` is set, then buttons Open beside <agent> (split, via `openInSplit`), Move
  to the panel (`moveToDock`) and Close (closes the terminal's tab, as the tree's context menu does). Attributes:
  `data-terminal-pane-head`, `data-terminal-open-split`, `data-terminal-to-dock`, `data-terminal-close`. Board:
  Compact.
- `canSplit` (`agentheader.tsx:251`) allows a terminal with a block.
- `bindings.ts`: a global `Ctrl`+`` ` `` (`Cmd`+`` ` `` on a Mac, follow the `Mod` convention in the file) labelled
  "Fold or open the terminal panel", active on the Agent surface, also from inside a terminal like the other `Mod`
  chords. Check no binding already uses it.

**Shown by:** `tools-centre` (pane head, "Ctrl Tab back to …", the quick flip back, Close), `tools-split` (Open beside
the agent, a terminal cell), `tools-dock-strip` (Move to the panel, the chord, the strip, the panel's Open in split).

**Step 3: Run** the Step 1 command — PASS. Run the typecheck (`node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`, long timeout) — exit 0.

**Step 4: Commit** with `feat(agents): a picked terminal takes the centre, terminals can be split cells, the panel folds to a strip`.

### Task 4: Tools model, store and the open/install actions

**Depends on:** Task 1

**Files:** `frontend/app/view/agents/toolsmodel.ts`, `frontend/app/view/agents/toolsmodel.test.ts`, `frontend/app/view/agents/toolsstore.ts`, `frontend/app/view/agents/launch.ts`, `frontend/app/view/agents/launch.test.ts`, `frontend/app/cockpit/cockpit-actions.ts`

Facts: a Terminal launch is `buildLaunchMeta` (`launch.ts:170`) → `{view: "term", controller: "shell", "cmd:cwd",
"cmd:firstcommand"?}`; `launchAgent(model, opts)` (`cockpit-actions.ts:37`) creates the tab, sets tab meta
`session:project`, and leaves a Terminal in the background (`:116-119`). Setup's RPC pattern:
`RpcApi.AgentSyncStatusCommand(TabRpcClient, { timeout })` (`setupstore.ts:64`).

**Step 1: Failing tests** in `toolsmodel.test.ts` for pure functions:
- `toolGroups(statuses, installing, failed)` → `{ installed, notInstalled, yours }` in catalog order; a tool with an
  install terminal running is `installing`, one whose last install failed is `failed`; user tools go to `yours`
  whether found or not, with `found: false` read as "not on PATH".
- `pickerOrder(statuses, pinned)` → pinned installed first, then other installed, then yours, then at most two not
  installed, as board Picker and Launcher show.
- `toolCwd(tool, ctx)` where `ctx = { agentCwd?, projectRoot?, home }`: `agent` → agentCwd ?? projectRoot ?? home;
  `root` → projectRoot ?? home; `home` → home.
- `toolCommandLine(tool)` → `command` plus `args` when set.
- `installCommand(tool, platform)` → the platform's line or `undefined`.
- `toolTerminalName(terminal: { name: string; toolId?: string }, tools)` → the tool's name while the terminal's name is
  still its launch (the tool's command line, or the "Terminal N" placeholder before any command), else the terminal's
  own name (a rename, or the last command once the tool has quit, spec "Tool exits"); `toolIcon(tool)` → an icon name
  per category (a terminal with no tool keeps the terminal icon).
Run `npx vitest run frontend/app/view/agents/toolsmodel.test.ts` — FAIL; implement `toolsmodel.ts`; PASS.

**Step 2: Launch meta.** `buildLaunchMeta` takes an optional `toolId`; a terminal with one gets `"tool:id"` and
`"cmd:firstcommand"` = the command line. Test in `launch.test.ts` beside the existing terminal cases (`:183-187`):
the shell controller stays, `tool:id` is set. Run `npx vitest run frontend/app/view/agents/launch.test.ts` — PASS.

**Step 3: Store and actions** in `toolsstore.ts`:
- `toolsStatusAtom`, `loadTools()` (calls `RpcApi.ToolsStatusCommand`; reload on window focus and after an install
  ends), `pinnedToolsAtom` (localStorage `tools.pinned`, default `["lazygit","yazi","btop"]`).
- `toolPickerAtom: { open: boolean; project?: string }` and `openToolPicker(model, project?)`.
- `openTool(model, tool, { project, place })`: resolves the cwd with `toolCwd` from the focused agent (its worktree
  cwd) or the project, then calls `launchAgent` with the terminal runtime, the tool's command line and `toolId`; on
  `place: "centre"` it focuses the new tab and switches to the Agent surface (as an agent launch does,
  `cockpit-actions.ts:119-123`); `"panel"` keeps the agent focused and sets `dockedTerminalAtom` (`railstore.ts:66`) to the new tab, which docks it.
- `installTool(model, tool, project)`: launches a terminal named "Install <name>" running the install line with
  `cmd:closeonexit` so it closes on exit 0 (check the key's semantics in `pkg/waveobj/wtypemeta.go` and the term
  controller; if it closes on any exit, use the key that closes only on success); tracks it in
  `installingAtom: Record<toolId, tabId>` and moves it to `failedAtom: Record<toolId, tabId>` when it exits non-zero
  (its tab stays open with the output); reloads status when it ends. `retryInstall(model, tool)` closes the failed tab
  and installs again; `showInstall(model, toolId)` focuses the installing or failed tab (Open output / Show).
- `addUserTool(id, keywords)` / `removeUserTool(id)` via `RpcApi.ToolsSetUserCommand`, then `loadTools()`.
`cockpit-actions.ts`: `LaunchAgentOpts` gains `toolId?` and `focus?: boolean` (a tool launch focuses; a plain
Terminal launch keeps today's background behaviour).

**Step 4: Check.** `npx vitest run frontend/app/view/agents/toolsmodel.test.ts frontend/app/view/agents/launch.test.ts`
and the typecheck (`node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`) — PASS / exit 0.

**Step 5: Commit** with `feat(tools): the tools model, status store, and open/install actions`.

### Task 5: The sidebar draws one tree per project; terminals in the palette

**Depends on:** Task 2, Task 3, Task 4

**Files:** `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/agents/terminalsrail.tsx`, `frontend/app/view/agents/agentsidebarmodel.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `frontend/app/view/agents/terminalpanehead.ts`, `frontend/app/view/agents/terminalpanehead.test.ts`, `frontend/app/view/agents/terminalpanehead.tsx`, `frontend/app/cockpit/command-palette.tsx`

Facts: `AgentTree` (`agenttree.tsx:2100`) renders Active (`:2171-2331`, `SplitRow` at `:2187`), `ConversationsSection`
(`:2334`) and the pinned `TerminalsSection` (`:1857-1922`, `TerminalRow` `:1816`). `terminalsrail.tsx` only holds
`showTerminalMenu`. The palette's Agents group is built from `model.agentsAtom` only
(`command-palette.tsx:468-492`).

**Step 1: Render the model.** `AgentTree` renders `projectTree(...)` (Task 2) instead of `activeView` + the separate
Terminals section: group rows (`FolderRow`, now showing `2 agents · 1 terminal` when folded, `data-project-folder`),
the agent rows as today, a 1 px divider (`data-project-divider`), terminal rows (`TerminalRow`, now
`data-tree-terminal-row`, with the name and icon from `toolTerminalName` / `toolIcon` (Task 4), the branch chip from
`place` and a where-it-shows word `split` / `panel` in `data-terminal-place`), and the split row inside its folder (or
on top when `crossProject`, `data-split-cross`, each segment naming its project). An install terminal (its tab id in
Task 4's `installingAtom` / `failedAtom`) reads `installing` with a spinner or `install failed` in the danger token, in
`data-terminal-state="installing"` / `"failed"` (Task 9 adds `"removed"`). Add a pure
`terminalRowState(tabId, installing, failed)` to `agentsidebarmodel.ts` with a test. The terminal pane head (Task 3's
`terminalPaneHead`, now also taking `tools`, Task 4's `toolsStatusAtom` value) returns `icon` too and takes `name` and
`icon` from the same two functions; extend `terminalpanehead.test.ts` with a tool terminal. Delete
`TerminalsSection` and any model export Task 2 kept only for it, with their tests. Keep the existing
`data-agent-terminal-row` attribute on terminal rows too, so older scenarios keep finding them. Conversations stays at
the bottom. Board: ProjectTree, Sidebar.

**Step 2: Terminal rows act like agent rows.** They are drag sources onto the grid (`dragSource`, now allowed for a
terminal with a `blockId`), take Alt-digit hints, and their context menu (`terminalsrail.tsx`) gains Open in split and
Move to the panel. Folder hover shows `tool` (`data-folder-tool`; opens the picker with that project: `openToolPicker` from Task 4) and
`+` (new terminal, as today).

**Step 3: Palette.** The Agents group also lists `model.terminalsAtom` (kind `"terminal"`, key `terminal:${id}`,
labelled with the terminal's name and project), opening it with `model.openTerminal(id)`. Add the palette command
"Open a tool…" (key `cmd:open-tool`) that calls `openToolPicker(model)`. Each palette row carries `data-palette-key`
with its item key, if rows have no such attribute yet.

**Shown by:** `tools-tree` (folder, divider, terminal rows, branch chip, folded counts, the folder's `tool` button, the
installing and install-failed rows), `tools-split` (the split row in its folder, the cross-project row on top),
`tools-centre` (`j`/`k` onto a terminal, the terminal in the palette, "Open a tool…").

**Step 4: Check.** `npx vitest run frontend/app/view/agents/agentsidebarmodel.test.ts frontend/app/view/agents/terminalpanehead.test.ts` and the typecheck (`node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`) — PASS / exit 0.

**Step 5: Commit** with `feat(agents): one tree per project in the sidebar; terminals in the palette`.

### Task 6: Setup → Tools

**Depends on:** Task 4

**Files:** `frontend/app/view/agents/setupstore.ts`, `frontend/app/view/agents/setupsurface.tsx`, `frontend/app/view/agents/toolslibrary.tsx`, `frontend/app/view/agents/toolslibrarymodel.ts`, `frontend/app/view/agents/toolslibrarymodel.test.ts`

Facts: `SetupTab = "instructions" | "skills"` (`setupstore.ts:25`), `TABS` (`setupsurface.tsx:83-86`), header and body
are two-way ternaries at `:793` and `:801`.

**Step 1: Failing tests** in `toolslibrarymodel.test.ts`: `libraryRows(statuses, installing, failed)` grouped by
category in the order Git, Files, System, Containers, Docs and data, Yours, each row with its status word
(`installed`, `not installed`, `installing`, `install failed`, `on PATH`, `not on PATH`); `headerSummary(...)` →
"4 installed · 9 in the library"; `validateNewTool({name, command})` → the error "Add a name" / "Add a command", else
`null`; `toolIdFrom(name)` → a lowercase slug. Run, FAIL, implement, PASS
(`npx vitest run frontend/app/view/agents/toolslibrarymodel.test.ts`).

**Step 2: The tab.** `SetupTab` gains `"tools"`; `TABS` gains `{ key: "tools", label: "Tools" }`; header and body
switch three ways. `toolslibrary.tsx` draws board Library: left list (search, groups, rows with status, "Add your
own tool"), right detail for the selected tool: purpose, primary "Open <name>" (calls `openTool` with the focused
agent), Opens in and Shows segmented controls (for a built-in they write a user override through `addUserTool`), In
Open a tool (the pinned switch), Command with the found path, Install with its command and Install / Update, and Open
now (`model.terminalsAtom` filtered by `toolId`, each with Show). No Shortcut field: per-tool shortcuts are deferred
(spec). A tool whose install failed shows `install failed` with Open output (`data-tool-open-output`, Task 4's
`showInstall`) and Try again (`data-tool-retry`, `retryInstall`); each row's status word is in `data-tools-status`. Board LibraryAdd: the add form (Name, Command
with an "on PATH" line after a status reload, Opens in, Shows, Install command) saving through `addUserTool`.
Attributes: `data-setup-tab="tools"`, `data-tools-library`, `data-tools-row="<id>"`, `data-tools-status`,
`data-tools-detail`, `data-tool-install`, `data-tool-add`, `data-tool-add-save`.

**Shown by:** `tools-library` (Setup → Tools, a selected row's detail, Install, the install-failed row with Open output
and Try again), `tools-add` (the add form, the new tool under Yours).

**Step 3: Check.** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit` — exit 0.

**Step 4: Commit** with `feat(tools): Setup → Tools, the tool library`.

### Task 7: The Open a tool picker and its entry points

**Depends on:** Task 3, Task 4, Task 5, Task 6

**Files:** `frontend/app/view/agents/toolpicker.tsx`, `frontend/app/view/agents/toolpickermodel.ts`, `frontend/app/view/agents/toolpickermodel.test.ts`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/view/agents/cockpitshell.tsx`

**Step 1: Failing tests** for `toolpickermodel.ts`: `pickerContext(focused, roots)` → the line under the search
("Opens in fix-login's worktree", "Opens in arcterm", "Opens in Home"); `pickerKey(state, key)` → move / open
(`Enter`: centre, `Shift+Enter`: panel) / install (`Ctrl+I` on a not-installed row) / close (`Esc`); filtering by a
query over name and purpose. Run `npx vitest run frontend/app/view/agents/toolpickermodel.test.ts` — FAIL, implement,
PASS.

**Step 2: The dialog.** `toolpicker.tsx` draws board Picker in the command palette's modal shell: the "Open a tool"
chip, the search box, the context line, groups Installed / Not installed / Yours with the states drawn (installing
with "Show", failed with "Open output" and "Try again", a user tool not on PATH with "Edit", which opens Setup → Tools
on that tool), and the footer hints. Render it once in the always-mounted shell (`cockpitshell.tsx`) from
`toolPickerAtom`. Attributes: `data-tool-picker`, `data-tool-picker-row="<id>"`, `data-tool-picker-show`,
`data-tool-picker-retry`, `data-tool-picker-edit`.

**Step 3: Entry points.** A `Tool` button in the agent header (`agentheader.tsx`, `data-agent-tool-button`) opens the
picker for that agent; a global binding "Open a tool" on `Ctrl`+`Shift`+`T` (`Mod` convention; check it is free) in
`bindings.ts`, usable from inside a terminal like the other `Mod` chords.

**Shown by:** `tools-picker` (Ctrl+Shift+T, the agent header's Tool button, the installing / failed / not-on-PATH rows
with Show / Try again / Edit, Enter opening a tool in the centre).

**Step 4: Check.** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit` — exit 0.

**Step 5: Commit** with `feat(tools): the Open a tool picker, from the agent header and Ctrl+Shift+T`.

### Task 8: A Tool row in the New dialog

**Depends on:** Task 4, Task 6

**Files:** `frontend/app/view/agents/launcher.ts`, `frontend/app/view/agents/launcher.test.ts`, `frontend/app/view/agents/launchermodal.tsx`, `frontend/app/view/agents/launchertoolfields.tsx`, `frontend/app/view/agents/launcherstore.ts`, `frontend/app/cockpit/app-bar.tsx`

Facts: `LauncherKind = "agent" | "run"` (`launcher.ts:12`), `startRows` (`:40-54`) numbers rows 1..n, digits are
`/^[1-9]$/` (`:277`), `launcherTitle` (`:69`), `primaryLabel` (`:73`), `FocusZone` (`:197`), `launcherKey` (`:243`);
the modal's Start column `:857-876`, lower area `:998-1018` (`AgentFields` / `RunFields`), header hints `:827-845`,
Tab walks `FOCUSABLE` in DOM order (`:662-667`).

**Step 1: Failing tests** in `launcher.test.ts`: `startRows` ends with one `tool` row (kind `"tool"`, name "Tool",
desc "lazygit, yazi, btop…") after the run rows, so earlier rows keep their digits and the count stays within 9;
`launcherTitle("tool")` is "Open a tool"; `primaryLabel` for a tool kind is `Open <tool name>`; `launcherKey` in a new
`"tools"` zone maps letters `a`–`z` to picking the nth tool and arrows to moving; the header hint for the tool kind is
"a–z tool". Run `npx vitest run frontend/app/view/agents/launcher.test.ts` — FAIL.

**Step 2: Implement.** `LauncherKind` gains `"tool"`; `startRows` appends the Tool row; the modal renders a "Tool"
label and the row after Run. With Tool picked the lower area is `launchertoolfields.tsx` (board Launcher): the Tool
list (`role="listbox"`, the third Tab stop, `data-launcher-tool-list`, rows `data-launcher-tool="<id>"`, letters
`a`…, ordered by `pickerOrder`, ending with "All tools in Setup", `data-launcher-tool-all`, which closes the dialog and
opens Setup → Tools, the tab Task 6 adds), an About card, and the
Command line showing the tool's command; no Task, Flag or worktree toggle. The footer reads "Opens in <path> · on
<branch>" and the primary button "Open <name>" calls `openTool` with the picked project (Home allowed) and `place:
"centre"`. Remember the last picked tool in `launcherstore.ts`. The app bar's `+ New` tooltip
(`app-bar.tsx:139`, "New agent or run") becomes "New agent, terminal, run or tool".

**Shown by:** `tools-launcher` (the Tool row by its digit, the tool list, letter `a`, "Open …", All tools in Setup).

**Step 3: Check.** `npx vitest run frontend/app/view/agents/launcher.test.ts` and the typecheck (`node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`) — PASS / exit 0.

**Step 4: Commit** with `feat(launcher): a Tool row that opens a tool in a project`.

### Task 9: A terminal whose worktree was removed

**Depends on:** Task 3, Task 5

**Files:** `frontend/app/view/agents/worktreegone.ts`, `frontend/app/view/agents/worktreegone.test.ts`, `frontend/app/view/agents/worktreegonecard.tsx`, `frontend/app/view/agents/agentsurface.tsx`, `frontend/app/view/agents/agenttree.tsx`

**Step 1: Failing tests** for `worktreegone.ts`: `goneTerminals(terminals, exists)` → ids whose `cwd` is not the
project root and whose folder `exists(cwd)` reports missing; `reopenTarget(terminal, roots)` → the project root to
reopen in, or home. Run `npx vitest run frontend/app/view/agents/worktreegone.test.ts` — FAIL, implement, PASS.

**Step 2: Wire it.** A small store checks each terminal's cwd with the existing file-info RPC (grep
`FileInfoCommand` in `frontend/app/store/wshclientapi.ts`) when the terminal list changes and when a run lands; the
terminal's row shows its branch chip struck through and "removed" (`data-terminal-state="removed"`); its pane shows
board WorktreeGone's card (`data-worktree-gone`) over the dimmed last screen with "Reopen in <project>"
(`data-worktree-reopen`: a new terminal in the root, running the same tool through Task 4's `openTool` when the
terminal has a `toolId`, else a plain shell, then close this one) and "Close terminal".

**Shown by:** `tools-worktree-gone` (the card, the struck-through row, Reopen).

**Step 3: Check.** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit` — exit 0.

**Step 4: Commit** with `feat(agents): a terminal whose worktree was removed offers to reopen in the project`.

### Task 10: CDP scenarios for every board

**Depends on:** Task 5, Task 6, Task 7, Task 8, Task 9

**Files:** `scripts/cdp/scenarios.mjs`

Follow the shape of `launcher-empty` (`scripts/cdp/scenarios.mjs:19105-19165`: `arrange`, `assert` with `rec(step, ok,
detail)` steps, `h.shot`, `teardown` with Esc) and register each new scenario where the others are listed. Do not
depend on lazygit or any real tool being installed: arrange writes a user tool to `tools.json` through
`ToolsSetUserCommand` (command `node`, args printing a fixed screen and waiting) and removes it in teardown. Each
scenario shoots its board and asserts the `data-*` attributes the tasks named:

User tools the scenarios write (all removed in teardown): `arc-fixture` (runs), `arc-slow-install` (command not on
PATH; `install:windows` and `install:darwin` both `node -e "setTimeout(()=>{},120000)"`), `arc-bad-install` (command not
on PATH; install lines `node -e "process.exit(1)"`) and `arc-missing` (command `arc-missing-xyz`, no install line).
Arrange starts the two installs from Setup → Tools (`data-tool-install` on each row) where a step needs them; teardown
closes their terminals.

- `tools-tree` (boards ProjectTree, Sidebar): a project folder with an agent, the divider and two terminals, one with
  a branch chip; fold it and read "1 agent · 2 terminals"; step `folder-tool`: hover the folder, `data-folder-tool`
  opens `data-tool-picker` whose context line names that project, Esc; step `row-installing`: the "Install
  arc-slow-install" row has `data-terminal-state="installing"`; step `row-failed`: the "Install arc-bad-install" row
  has `data-terminal-state="failed"`. Shoot the sidebar for each state.
- `tools-centre` (board Compact): pick the terminal row; the centre shows `data-terminal-pane-head` with "Ctrl Tab back
  to <agent>"; a quick Ctrl+Tab returns to the agent; step `jk`: from the agent, `j` lands on the terminal (its pane
  head shows) and `k` returns; step `palette`: the palette lists the terminal (`data-palette-key="terminal:<id>"`) and
  "Open a tool…" (`data-palette-key="cmd:open-tool"`), which opens `data-tool-picker`, Esc; step `close`:
  `data-terminal-close` on a second terminal opened in arrange removes its row.
- `tools-split` (board Main): Open beside the agent; two cells, one a terminal; the row reads `split` and the split
  row sits inside the project folder; step `cross-project`: a Home terminal opened in split as well moves the split row
  to the top with `data-split-cross`, each segment naming its project.
- `tools-dock-strip` (board Compact strip, Main panel): Move to the panel, fold with the chord, `data-dock-strip`
  shows, unfold; step `panel-split`: `data-dock-open-split` moves the terminal into the grid (two cells, the dock
  empty).
- `tools-library` (board Library) and `tools-add` (board LibraryAdd): Setup → Tools, select a row, add a tool, see it
  under Yours; `tools-library` step `install-failed`: the `arc-bad-install` row's `data-tools-status` reads "install
  failed" and its detail shows `data-tool-open-output` and `data-tool-retry`.
- `tools-picker` (board Picker): Ctrl+Shift+T opens `data-tool-picker`; step `states`: `arc-slow-install` shows
  `data-tool-picker-show`, `arc-bad-install` `data-tool-picker-retry`, `arc-missing` "not on PATH" with
  `data-tool-picker-edit`; step `header-button`: Esc, then `data-agent-tool-button` in the agent header opens the
  picker again; Enter opens the selected tool in the centre.
- `tools-launcher` (board Launcher): the New dialog, pick the Tool row by its digit, Tab twice to
  `data-launcher-tool-list`, letter `a`, primary reads "Open …"; step `all-tools`: `data-launcher-tool-all` closes the
  dialog and shows `data-tools-library`.
- `tools-worktree-gone` (boards WorktreeGone, Sidebar): a terminal whose cwd is a temp folder deleted in arrange shows
  `data-worktree-gone`, and its row has `data-terminal-state="removed"` with the branch chip struck through.

Also update any existing scenario that selected `data-agent-terminals` (the removed section) or relied on a terminal
docking when picked (grep the file for `data-agent-terminals`, `data-terminal-dock`, `dockedTerminal`).

**Step 1:** write the scenarios. **Step 2:** run `node scripts/cdp/final-verify.mjs tools-tree tools-centre tools-split
tools-dock-strip tools-library tools-add tools-picker tools-launcher tools-worktree-gone` — all PASS; fix the
scenario, not the app, only when the scenario is wrong. **Step 3:** commit with
`test(cdp): scenarios for terminals and tools`.

### Task 11: Docs and changelog

**Depends on:** Task 5, Task 6, Task 7, Task 8, Task 9

**Files:** `CHANGELOG.md`, `docs/guide/agent.md`, `docs/guide/settings.md`, `docs/keyboard-shortcuts.md`, `AGENTS.md`, `docs/open-issues.md`, `docs/deferred.md`

- `CHANGELOG.md` under `## Unreleased`: Added — the tool library (Setup → Tools, Open a tool, the New dialog's Tool
  row); Changed — terminals sit with their project's agents in the sidebar and open in the centre, and the terminal
  panel folds to a strip. Stage only your hunks if the file has other uncommitted changes (`git add -p`, then a bare
  `git commit`).
- `docs/guide/agent.md` (Vietnamese, like the rest of the guide): rewrite the sidebar section (one tree per project;
  the Terminals section is gone), the "Terminal ở giữa" notes for a terminal taking the centre and Ctrl+Tab back, the
  grid section (terminals can be cells), the panel and its strip; add a "Tools" section (library, picker, New dialog).
- `docs/keyboard-shortcuts.md`: `Ctrl`+`Shift`+`T` Open a tool, `Ctrl`+`` ` `` the panel, `j`/`k` include terminals, the
  New dialog's Tool row and its `a`–`z`.
- `AGENTS.md`: the grid paragraph ("only agents can be cells") and "`focusIdAtom` stays the one selected agent" now
  include terminals; the sidebar is one tree per project.
- `docs/open-issues.md`: remove "Plain terminals are reachable only by mouse"; add `- [ ]` hand-check lines under
  "0 · Waiting on a hand check" for: winget installs of two tools, a tool in a Mac build (brew), the strip's latest
  output line.
- `docs/deferred.md`: an "(arcterm) Per-tool shortcuts in the tool library" entry: the Library has no Shortcut field
  until the `Ctrl`+`G` leader-chord question in the spec is settled.

Commit with `docs: terminals and tools`.
