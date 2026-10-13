# Terminals and tools: one tree per project, tools over their agent, a tool library

Date: 2026-10-13. Status: design agreed, not planned yet.

Prototype: `D:\work\arcterm\.superpowers\design\terminal-tui\project\` (canvas `terminal-tui`; boards Compact,
Main, ProjectTree, Library, LibraryAdd, Picker, Launcher, NewButton, Sidebar, WorktreeGone).

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
3. **A tool opens over its agent** (board Compact). It takes the agent's centre pane; the agent header's view switch,
   today Terminal | Canvas | Review, gains one entry per tool opened from that agent (Claude | lazygit). The agent keeps
   running underneath.
4. **Split and panel are on demand** (board Main). A tool or terminal can go into the grid beside the agent ("Open in
   split") or into the panel under it; the panel folds to a 32 px strip when not in use.
5. **A tool library** under Setup → Tools (boards Library, LibraryAdd), with a quick picker, "Open a tool" (board
   Picker), as the fast path.

## Model

- A terminal is a term block as today. New block meta records:
  - `project` (or Home) and `cwd` at open time; the tree groups by `project`, the branch chip shows when `cwd` is not the
    project root;
  - `tool:id` for a block started from the library (`controller: "cmd"`, as `claude-signin-modal.tsx` already starts
    a command block);
  - `tool:host`, the agent block it was opened over, when opened from an agent. This only decides where it shows; it
    is not ownership, so closing the agent leaves the tool in the project.
- No new `waveobj` type, so no migration. Meta keys are Go-side (`pkg/waveobj` metaconsts) and need `task generate`.

## Sidebar: one tree per project

- Folder order and agent rows are as today. Under a divider: terminals and tools, most recent first.
- A terminal row: icon, name (the tool's name, else the last command as today), branch chip when not at the root, and a
  short where-it-shows word: `on fix-login` (over an agent), `split`, `panel`; nothing when hidden. A running command
  keeps the pulsing dot.
- The agent row a tool is shown over names the tool at its right (`lazygit`).
- The split row (`SplitRow` in `agenttree.tsx`) moves inside its project folder when every cell is in that project. A
  split across projects keeps it at the top, each segment naming its project.
- A folded folder says what it holds: `2 agents · 1 terminal`.
- Home holds terminals and tools with no project (btop).
- The project switcher in the app bar filters as today.
- Keyboard: `j`/`k`, Ctrl+Tab and the palette's Agents group include terminals. This closes the open issue above.

States (board Sidebar): running, exited (row stays until closed so the last screen is readable), worktree removed
(branch struck through), installing, install failed.

Code: `agentsidebarmodel.ts` (buildAgentTree, `splitActive`) builds the one tree; `TerminalsSection` in
`agenttree.tsx` and `terminalsrail.tsx` fold into it. Pure model changes get tests beside them.

## Centre: a tool over its agent (default)

- `AgentView` (`agentview.ts`, today `"terminal" | "canvas" | "review"`) grows a tool entry per tool block hosted on the
  agent. The switch in `agentheader.tsx` shows `Claude` (the harness name) and each tool; the existing `Alt`+`c` chord
  cycles it from inside a terminal. A `+` in the switch opens the picker for this agent.
- The tool's block keeps its pane mounted once shown, like an agent's (`panemounts.ts`), so switching back and forth
  never replays the TUI.
- Header buttons while a tool shows: Open in split, Close tool.
- Closing the agent leaves its tools as plain rows in the project; selecting one then shows it in the centre.

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
  default "opens in" (agent's folder, project root, Home) and "shows" (over the agent, panel), and install commands per
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
for the selected tool: purpose, primary action "Open beside <agent>", then Opens in, Shows, Shortcut, "In Open a tool"
(pinned to the picker's top), Command with where it was found, Install (command and Update), and Open now (its running
blocks with Show).

### Open a tool (board Picker)

Palette-style dialog (`command-palette.tsx` shell): a line saying where it opens (agent, branch, path), groups
Installed, Not installed, Yours; `↵` opens over the focused agent, `Shift`+`↵` in the panel, `Ctrl`+`I` installs. Entry
points: the `+` in the agent header switch, a folder's `tool` button on hover, the palette ("Open a tool…") and a
global chord (proposed `Ctrl`+`Shift`+`T`, to be checked against `bindings.ts`).

### The New dialog (board Launcher)

The dialog that starts an agent, a terminal or a run (`launchermodal.tsx`, `launcher.ts`) gains a third Start group,
**Tool**, for opening a tool in a project when no agent is in focus (the picker always follows the focused agent).

- The group lists only the pinned tools ("In Open a tool" on), so the column stays short and the digits stay within
  1–9, then a "More tools…" row that opens the picker.
- A tool picked leaves only the Project column, as Terminal does today: no Task, Command, Flag or worktree toggle. Home
  is offered, as for Terminal. A card under the projects says what the tool is and that it runs in the project root;
  opening it in an agent's worktree is the agent's Tool button.
- With no agent to stand over, the tool takes the centre, as a terminal does with no agent, and sits in its project
  folder in the tree.
- The dialog's title and primary button follow the row picked: New agent / Launch agent, New terminal, New run,
  Open a tool / Open lazygit.
- The app bar's one `+ New` button (`app-bar.tsx`) stays as it is (board NewButton, A); its tooltip becomes "New
  agent, terminal, run or tool".

## Edge cases

- **Worktree removed** (board WorktreeGone): when an agent's branch lands and its worktree goes, a terminal whose `cwd`
  was in it shows a card over its last screen: "This terminal's folder was removed", Reopen in <project> (primary),
  Close terminal.
- **Tool exits:** the block stays with its last screen and an "exited" row until closed; reopening reruns the command.
- **Command missing:** a user tool not on PATH says so in the picker and library, with Edit; never a failed spawn.
- **No focused agent:** the picker opens in the project root (or Home) and Shows falls back to the centre.
- **Key collisions:** a TUI needs `Esc`, arrows and `Ctrl` keys. The app's global chords already pass through a
  focused terminal by the rules in `docs/keyboard-shortcuts.md`; no new bare key is taken while a tool has focus.

## Testing

- Pure models with tests beside them: the merged tree (grouping, divider, split placement, folded counts), the
  `AgentView` tool entries and cycling, the dock's folded state, catalog status and the picker's grouping.
- Go: the tool status command (PATH resolution, built-in plus user entries).
- CDP scenarios (`scripts/cdp/scenarios.mjs`): the project tree with a terminal and a tool, a tool over its agent and
  back via the switch, open in split, the folded panel strip, Setup → Tools, the picker, the worktree-removed card.

## Out of scope

- Talking back from a TUI to the cockpit (lazygit telling arcterm about a commit); later, through `wsh` if ever.
- A remote or community catalog; image previews in yazi (WebView2 xterm limits).

## Open questions

- `tools.json` file versus a `tools` key in settings.
- The global chords: `Ctrl`+`Shift`+`T` for the picker, `Ctrl`+`` ` `` for the panel, per-tool shortcuts as `Ctrl`+`G`
  leader chords.
- Whether the Conversations section should also fold into project folders later (not part of this change).
