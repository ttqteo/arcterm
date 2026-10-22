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
  2. Copy path
  3. Reveal in Explorer (`revealPath` in `frontend/tauri/api.ts`; "Reveal in Finder" on a Mac)
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
  - Council is `showCouncilSetup(project)` (`agentcenter.ts`).

**Needs you** — rows that wait on the person, each with one action:
- an agent of the project that is asking: its name, `asking` in the asking colour and its question; **Answer** focuses
  the agent (`showTerminal` + `focusIdAtom`).
- a run of the project whose land was held or that asks: its id and title, why it waits; **Land again** (`landAgain`,
  `view/jarvis/landrun.ts`) for a held land, **Open** for the rest.

**Running** — the project's agents at work, its active runs and its terminals: a working dot, the name, what it is
doing, and its tokens and age (a run: tasks done of total). A click on a row selects that agent or terminal, or opens the
run.

**Quiet** — when Needs you and Running are both empty, neither block is drawn; one line takes their place:
"Nothing needs you and nothing is running in <project>." A block that is empty while the other is not is left out.

Everything the page shows is already in the frontend: the agents and terminals per project are what `projectTree`
(`agentsidebarmodel.ts`) files under the folder, runs come from the runs store, and the change count from the git
changes the Diff surface and the cards already load. No new backend command.

## Shape of the code

- `projectoverviewmodel.ts`: pure. From the roster, the runs and the project, derives the Needs you rows, the Running
  rows and the quiet flag. `projectoverviewmodel.test.ts` beside it.
- `projectoverview.tsx`: the thin page, rendered by `AgentCenterPane` for mode `project`.
- `agenttree.tsx`: `FolderRow` gets an `onContextMenu` and its selected state.
- `CHANGELOG.md`: one `Added` line with a `<!-- try: -->` id if a global binding opens it.

## Verify

- vitest for `projectoverviewmodel.ts`: asking agents and held runs land in Needs you, working ones in Running, other
  projects' never, the quiet flag.
- A CDP scenario that right-clicks a folder row, picks Open overview and shots the page with a fixture roster
  (`npm run cockpit:fixtures`), and one for the quiet project.

## Out of scope

Recent activity, repository history, initiatives, ideas, notes, canvases, a second column, and an Overview entry in the
app bar's project switcher. Any of them can come back as a block later if the small page earns it.
