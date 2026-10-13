# Terminals and tools: one tree per project, terminals as peers of agents, a tool library

Date: 2026-10-13. Status: design agreed, not planned yet.

Prototype: `D:\work\arcterm\.superpowers\design\terminal-tui\project\` (canvas `terminal-tui`; boards Compact,
Main, ProjectTree, Library, LibraryAdd, Picker, Launcher, Sidebar, WorktreeGone).

## Why

Plain terminals in the Agent surface are under-used for two reasons the user named:

- **Hard to reach.** They live only in the Terminals section pinned at the bottom of the tree: mouse only, not in the
  palette, `j`/`k` or Ctrl+Tab (`docs/open-issues.md`, "Plain terminals are reachable only by mouse").
- **Not tied to the work.** A terminal does not know which agent it serves; opening a shell or a TUI in an agent's
  worktree is manual, and in the tree a terminal sits far from the agent it is used with.

At the same time the good TUIs (lazygit, yazi, btop, lazydocker, glow…) do jobs arcterm should not rebuild in React. The
plan is to make arcterm a good host for them: a curated library you install from, opened in the right folder, shown
without crowding the agent.

Design rule from the review: **compact by default.** One pane in focus; anything more is something you ask for.

## Decisions

1. **A terminal belongs to a project, and opens in the agent's folder.** Ownership is the project (or Home), so a dev
   server outlives the agent that needed it. The working folder is taken at open time from the focused agent: its
   worktree when it has one, else the project root.
2. **One tree per project** (board ProjectTree). The sidebar's Active and Terminals sections merge: each project folder
   lists its agents, a thin divider, then its terminals and tools. Conversations stays its own section at the bottom.
3. **A terminal is a peer of an agent** (board Compact). A terminal or tool is a row at the same level as the agents in
   its project folder; picking it gives it the centre, as picking an agent does. The quick Ctrl+Tab flips back to the
   agent. No switch in the agent header, no "hosted on" link: the branch chip says which worktree it runs in.
4. **Split and panel are on demand** (board Main). A tool or terminal can go into the grid beside the agent ("Open in
   split") or into the panel under it; the panel folds to a 32 px strip when not in use.
5. **A tool library** under Setup → Tools (boards Library, LibraryAdd), with a quick picker, "Open a tool" (board
   Picker), as the fast path.

## Model

- A terminal is a term block as today. New block meta records:
  - `project` (or Home) and `cwd` at open time; the tree groups by `project`, the branch chip shows when `cwd` is not the
    project root;
  - `tool:id` for a block started from the library. A tool is a plain terminal (`controller: "shell"`) whose
    `cmd:firstcommand` is the tool's command line, as a Terminal launch with a command is today, so the shell finds the
    program and quitting the tool leaves a prompt in the same folder;
- No new `waveobj` type, so no migration. Meta keys are Go-side (`pkg/waveobj` metaconsts) and need `task generate`.

## Sidebar: one tree per project

- Folder order and agent rows are as today. Under a divider: terminals and tools, most recent first.
- A terminal row: icon, name (the tool's name, else the last command as today), branch chip when not at the root, and a
  short where-it-shows word when it is not the centre: `split`, `panel`; nothing otherwise. A running command
  keeps the pulsing dot.
- The split row (`SplitRow` in `agenttree.tsx`) moves inside its project folder when every cell is in that project. A
  split across projects keeps it at the top, each segment naming its project.
- A folded folder says what it holds: `2 agents · 1 terminal`.
- Home holds terminals and tools with no project (btop).
- The project switcher in the app bar filters as today.
- Keyboard: `j`/`k`, Ctrl+Tab and the palette's Agents group include terminals. This closes the open issue above.

States (board Sidebar): running, worktree removed
(branch struck through), installing, install failed.

Code: `agentsidebarmodel.ts` (buildAgentTree, `splitActive`) builds the one tree; `TerminalsSection` in
`agenttree.tsx` and `terminalsrail.tsx` fold into it. Pure model changes get tests beside them.

## Centre: a terminal picked takes it (default)

- Picking a terminal or tool row (tree, `j`/`k`, Ctrl+Tab, palette, the picker) shows it in the centre, as an agent
  is shown. This replaces today's rule that a terminal chosen while an agent shows docks under it
  (`terminaldock.ts` `splitDock`); the panel becomes a place you move a terminal to, not where picking sends it.
- A quick Ctrl+Tab returns to the tab shown before (the agent), so agent ↔ tool is one chord; the pane header says so
  ("Ctrl Tab back to fix-login").
- The terminal's pane keeps its mount once shown, like an agent's (`panemounts.ts`), so flipping never replays the
  TUI. `focusIdAtom` holds the picked terminal's id too: Ctrl+Tab's recent list follows it, which is how the quick flip
  returns to the agent.
- The pane header: icon, name, branch chip, project, then Open beside <agent> (split), Move to the panel, Close.
- The agent header keeps its Terminal | Canvas | Review switch unchanged.

## Split and panel (on demand)

- Terminals and tools may be grid cells: `agentgrid.ts` and `gridstore.ts` drop the "only agents can be cells" rule,
  and AGENTS.md's grid paragraph changes with them. The grid keeps its rules (one grid parent, stable keys,
  `minmax(0, 1fr)` tracks).
- The panel under the agent (`terminaldock.ts`, `DOCK_*`) stays for small shells. New: a folded state, a 32 px strip
  showing the terminal's name, running dot and its latest output line; a click or `Ctrl`+`` ` `` opens it.
- A cell header and the panel header each carry the move to the other place (Open in split / Move to the panel).

## Tool library

### Catalog

- Built in: about 9 entries in categories, as drawn: Git (lazygit, gitui), Files (yazi, broot), System (btop),
  Containers (lazydocker, k9s), Docs and data (glow, visidata). Each entry: id, name, one-line purpose, command,
  default "opens in" (agent's folder, project root, Home) and "shows" (centre, panel), and install commands per
  OS (winget on Windows, brew on a Mac). The winget ids must be checked before shipping; the canvas ones are
  illustrations.
- The user's own tools: same fields, kept in a config file the user can edit (proposed `tools.json` in the config dir,
  watched like `settings.json`; settings key instead is an open question). Listed under Yours.
- Built-in catalog lives in Go so wavesrv can answer status; a `wshrpc` command returns, per tool, whether its command
  resolves on PATH and where. Regenerate bindings after adding it.

### Installing

- Install runs the OS command in a visible terminal of its own (row "Install glow") in the project the picker was
  opened from, or Home. On exit 0 it closes itself and the tool's status refreshes; on failure it stays with its output
  and the library shows "install failed" with Open output and Try again.
- No silent installs, no package manager of arcterm's own.

### Setup → Tools (board Library)

A third tab after Instructions and Skills. Left: search and the catalog by category, each row with its status
(installed, not installed, installing, install failed, on PATH / not on PATH for yours), and "Add your own tool". Right,
for the selected tool: purpose, primary action "Open lazygit" (in the focused agent's folder), then Opens in, Shows, Shortcut, "In Open a tool"
(pinned to the picker's top), Command with where it was found, Install (command and Update), and Open now (its running
blocks with Show).

### Open a tool (board Picker)

Palette-style dialog (`command-palette.tsx` shell): a line saying where it opens (agent, branch, path), groups
Installed, Not installed, Yours; `↵` opens it in the centre, `Shift`+`↵` in the panel, `Ctrl`+`I` installs. Entry
points: a Tool button in the agent header, a folder's `tool` button on hover, the palette ("Open a tool…") and a
global chord (proposed `Ctrl`+`Shift`+`T`, to be checked against `bindings.ts`).

### The New dialog (board Launcher)

The dialog that starts an agent, a terminal or a run (`launchermodal.tsx`, `launcher.ts`) also opens a tool in a
project, for when no agent is in focus (the picker always follows the focused agent).

- The Start column gains **one** row, Tool ("lazygit, yazi, btop…"), last, under its own Tool label after Run, so the
  other rows keep their digits (7 on a machine with Claude Code, Codex and Antigravity installed).
- With Tool picked, the lower area that holds Resume and Task for an agent holds a **Tool** list instead: the third
  `Tab` stop after Start and Project. Letters pick in it (`a`–`z`, the header hint reads "a–z tool"), installed
  tools first, then yours, then a not-installed one or two, and "All tools in Setup". Beside it, About: what the tool
  does and that it runs in the project root (an agent's worktree is the agent's Tool button).
- Command shows the tool's command; there is no Task, Flag or worktree toggle. Project and Home work as for Terminal.
- The tool takes the centre and sits in its project folder in the tree, as from anywhere else.
- The dialog's title follows the row picked (New agent, New terminal, New run, Open a tool); the primary button names
  the tool (Open lazygit).
- The app bar's one `+ New` button (`app-bar.tsx`) stays as it is; its tooltip becomes "New agent, terminal, run or
  tool".

## Edge cases

- **Worktree removed** (board WorktreeGone): when an agent's branch lands and its worktree goes, a terminal whose `cwd`
  was in it shows a card over its last screen: "This terminal's folder was removed", Reopen in <project> (primary),
  Close terminal.
- **Tool exits:** the terminal returns to its shell prompt in the same folder; the row's name becomes the last
  command, as for any terminal.
- **Command missing:** a user tool not on PATH says so in the picker and library, with Edit; never a failed spawn.
- **No focused agent:** the picker opens in the project root (or Home).
- **Key collisions:** a TUI needs `Esc`, arrows and `Ctrl` keys. The app's global chords already pass through a
  focused terminal by the rules in `docs/keyboard-shortcuts.md`; no new bare key is taken while a tool has focus.

## Testing

- Pure models with tests beside them: the merged tree (grouping, divider, split placement, folded counts), the
  picking a terminal takes the centre (no auto-dock), the dock's folded state, catalog status and the picker's grouping.
- Go: the tool status command (PATH resolution, built-in plus user entries).
- CDP scenarios (`scripts/cdp/scenarios.mjs`): the project tree with a terminal and a tool, a tool picked in the tree and
  back with a quick Ctrl+Tab, open in split, the folded panel strip, Setup → Tools, the picker, the worktree-removed card.

## Out of scope

- Talking back from a TUI to the cockpit (lazygit telling arcterm about a commit); later, through `wsh` if ever.
- A remote or community catalog; image previews in yazi (WebView2 xterm limits).

## Open questions

- `tools.json` file versus a `tools` key in settings.
- The global chords: `Ctrl`+`Shift`+`T` for the picker, `Ctrl`+`` ` `` for the panel, per-tool shortcuts as `Ctrl`+`G`
  leader chords.
- Whether the Conversations section should also fold into project folders later (not part of this change).
