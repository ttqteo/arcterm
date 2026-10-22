# Project Overview

A project's folder row in the Agent tree does one thing today: a click folds or opens it. This adds a page per project,
the **Overview**, which says at a glance what in the project waits on you and what is running, and starts new work in
it. It is deliberately small: an earlier draft with Recent, Repository, Initiatives, Ideas and Canvases blocks in two
columns was dropped as too much (the canvas below keeps only the chosen design).

Prototype: `.superpowers/design/project-overview/project/` (Main, FolderRow, QuietNarrow).

## Opening it

- A click on a folder row still only folds or opens it. The row's markup and its end (running and asking badges, the
  folded counts) do not change.
- **Right-click** on a folder row opens a context menu (`ContextMenuModel`, as an agent row's):
  1. **Open overview**
  2. Copy Absolute Path
  3. Show in Explorer ("Reveal in Finder" on a Mac)

  Items 2 and 3 are the Code tree's own (`pathMenuItems`, `frontend/app/view/code/pathmenu`), so the two menus read the
  same.
- From the keyboard: the folder row is a `<button>`, so Enter on it folds, as today. Shift+F10 (or the Menu key) on the
  focused row opens the same menu; WebView2 raises `contextmenu` for it, so no new binding is needed.
- The folder rows of the Conversations section get the same menu: they are the same project.
- **Home** has no Overview and no menu: it has no project path and only holds stray terminals.
- While a project's Overview is in the centre its folder row is the selected grey (`bg-surface-selected`). Folding the
  row does not close the Overview.

## Where it lives

A new centre mode of the Agent surface, `"project"`, beside `history`, `canvases` and `council` in
`frontend/app/view/agents/agentcenter.ts`, opened by a `showProjectOverview(project, model?)` there. Which project is a
module atom in the same place (like `councilSelAtom`). As in the other non-terminal modes, the terminal stack stays
mounted and hidden, and the details rail is not drawn (`agentsurface.tsx` draws it only in `terminal`). Choosing an agent
or terminal goes back to `terminal` through `showTerminal()`, as every route already does.

## The page

One column, `max-width` 760px, centred in the centre pane.

**Header**
- Project name (18px), the branch as a pill, the uncommitted change count with `+N −N` in the diff tokens (or
  "no uncommitted changes"), and the project path at the far end.
- Buttons: **New agent** (the one accent button), Terminal, Run, Council.
  - New agent and Run open the New launcher (`openLauncher`, `launcherstore.ts`) with this project picked.
  - Terminal is `quickTerminal(model, project, path)` (`agenttree.tsx`).
  - Council is `showCouncilSetup(path)` (`agentcenter.ts`): councils are keyed by the project's path, as the tree's
    own Council entry passes it.

**Needs you** — rows that wait on the person, each with its action:
- an agent of the project that is asking: its name, `asking` in the asking colour and its question; **Answer** selects
  the agent (`selectAgentRow`, `agenttree.tsx`), which puts its terminal back in the centre.
- the Cockpit's own Needs you items scoped to this project: a run whose land was held (Land again), a run to confirm or
  start, a review gate, a blocked task, an escalation, a due chunk. They are `useNeedsYou` (`needsyou.ts`) with the
  project in place of the app bar's filter, drawn with the strip's own rows (`needsyoustrip.tsx`), so an item reads and
  acts the same on both pages. A proposed learned rule is not one of them: it belongs to a skill or a folder, not to a
  project, so it stays on the Cockpit's strip and never shows on an Overview.

**Running** — the project's agents at work (a lead counts: its run is its agent) and its terminals running a command:
a working dot, the name, what it is doing, and how long. A click on a row selects that agent or terminal. A terminal's
name is already the command it runs, and nothing records when that command started, so its row reads `terminal` with no
age.

**Quiet** — when Needs you and Running are both empty, neither block is drawn; one line takes their place:
"Nothing needs you and nothing is running in <project>." A block that is empty while the other is not is left out.

Everything the page shows is already in the frontend: the agents and terminals per project by `projectOf`
(`agentsviewmodel.ts`), the Needs you items from the attention feed, and the branch and change count from
`GitChangesCommand` on the project path, the call the agent cards already make. No new backend command.

## Shape of the code

- `projectoverviewmodel.ts`: pure. From the roster, the terminals and the project, derives the asking rows, the Running
  rows and the quiet flag. `projectoverviewmodel.test.ts` beside it. The runs, gates and other items reach the page
  through `useNeedsYou`, whose pure `buildNeedsYouRows` (`needsyoustripmodel.ts`) does the project scoping, tested there.
- `projectoverview.tsx`: the thin page, rendered by `AgentCenterPane` for mode `project`.
- `agenttree.tsx`: `FolderRow` gets an `onContextMenu` and its selected state.
- `CHANGELOG.md`: one `Added` line with a `<!-- try: -->` id if a global binding opens it.

## Verify

- vitest for `projectoverviewmodel.ts`: asking agents land in Needs you, working ones and running terminals in
  Running, other projects' never, the quiet flag; and for `buildNeedsYouRows` under a project: a held run of the
  project is kept, another project's is not, a learned rule is not.
- A CDP scenario that right-clicks a folder row (and opens the same menu with Shift+F10), picks Open overview and shots
  the quiet page, then, with a fixture roster (an asking and a working agent) and a held-land item in the project, shots
  the Needs you and Running blocks and follows Answer back to the terminal.

## Out of scope

Recent activity, repository history, initiatives, ideas, notes, canvases, a second column, and an Overview entry in the
app bar's project switcher. Any of them can come back as a block later if the small page earns it.
