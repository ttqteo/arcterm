# Board cells: a board is a tree row and a cell of the split

Replaces "Where a board shows: split beside Chat" in `2026-11-19-kael-boards-design.md` (and its builder decision "The
split's widths"). Everything else in that spec (drawer, turns, forwarding, Library → Boards, storage) stands.

## Why

Today a board is a layer inside its agent's cell (`boards/boardsplit.tsx`, `boards/boardsplitstore.ts`): Chat shrinks
to a 360px column, the board takes the rest, and the Agent tree folds to a strip to make room. In a grid of several
cells the board always covers the whole cell, Chat included. A board can only be opened from the board card in Chat,
the toast, Library → Boards or `wsh ui`; the tree does not list it.

The person asked (2026-11-22) for the board to be a row in the sidebar that opens as its own cell of the split, beside
the agent's Chat, and chose this full version over only adding a tree row in front of the old layer.

## Decisions

### A board cell

- The grid (`agents/agentgrid.ts`, `agents/gridstore.ts`) gets a third kind of cell beside agents and terminals: a
  **board cell**, id `board:<agentId>` (`boards/boardcell.ts` holds the encode/parse and the rules below). One board
  cell per agent; which of the agent's boards it shows is `boardSplitAtom(agentId)` (`{ project, boardId }`), kept,
  so the header's switcher still swaps boards in the same cell.
- `boardSplitAtom` loses `expanded` and is persisted (one `atomWithStorage` map, localStorage `agent.boards`, keyed by
  agent id), so a split with a board survives a restart like any other split. An entry whose agent left the roster is
  dropped by the same reconcile that prunes the grid.
- A board cell is eligible only while its agent is eligible (live, has a block) and has a `boardSplitAtom` entry, and
  only in the grid that also holds its agent. Reconcile prunes it otherwise: removing the agent's cell (its x, End
  split, Remove from split) takes its board cell with it.
- **Focus never sits on a board cell.** `focusIdAtom` still holds only agent and terminal ids; the grid's `focused` is
  never a board id. The header, the ask bar and the rail stay the agent's (`headSubject`). Excalidraw keeps its own keys
  inside the cell (`data-owns-keys`, as now). `j`/`k`, Ctrl+Tab and `activeNavOrder` skip board rows.
- The cell is a drop target like any other (an agent dropped on its edge splits it); the board row is not draggable.
- The cell has the grid's cell bar (name, x) when the grid has several cells, which a board cell always is. Its x
  closes the board (`boardSplitAtom` entry cleared, cell removed); the agent's cell stays.
- **Mount:** a board cell mounts while it is shown and unmounts when it is not (a hidden split, another project, a
  centre mode). It holds no xterm, so the "never remount" rule of terminal panes does not apply, and an Excalidraw
  instance kept mounted off screen costs tens of MB (RAM before polish). Its React key is its id, so moving between
  places never remounts it.
- Tracks stay `minmax(0, 1fr)`: beside its agent the board gets half the grid, as any second cell.

### Opening

`openBoard(model, agentId, project, boardId)` keeps its signature and every caller (the board card in Chat, the toast,
`openref.ts` for Library and `wsh ui`, `boardapplier.ts`). What it does:

1. Focus the agent and put its cell on Chat (as now: `openTerminal`, `setAgentView(... "terminal")`,
   `setChatMode(... "chat")`).
2. Set `boardSplitAtom(agentId)` to the board.
3. If the grid on screen already holds `board:<agentId>`, done (the cell switches board).
4. Else add `board:<agentId>` right of the agent's cell (`addCell(..., "right")`). From a grid of one cell that is
   `[agent | board]`. From the agent shown alone while its project has a split kept aside, it starts a new grid,
   which replaces the split kept aside, as Open in split does today.
5. A full grid (4 cells): the board cell takes the place of the last cell in reading order that is neither the agent
   nor the focused cell. That tab keeps running and stays in the tree.

This is the one route where choosing something reshapes the split without a drop, Open in split or an x: the
exception is deliberate, since a board alone without its Chat cannot be read or asked.

### Expand

The header's Expand stays: the board cell fills the whole grid, the other cells hidden under it, still mounted (as the
dock's maximize, `terminalDockMaxAtom`, does). A per-agent flag beside the board entry; Escape is Excalidraw's, so
Expand toggles from the header only. The narrow/wide turns layout follows the cell's width (`@container`, as now): wide
enough (640px) the turns column sits right of the canvas, narrower it stacks under it. "N earlier" expands.

### The tree row

- Under each live agent that has boards (`boardsOfAgent` over `useBoardList("")`), one row right after the agent's row,
  `kind: "board"` in `agents/agentsidebarmodel.ts`: the most recently active board's name, and `+N` when the agent has
  more. The row reads as open (selected style) while its board cell is on screen.
- Click opens that board (`openBoard`), or focuses nothing new when it is already on screen. The header's switcher
  reaches the agent's other boards. Right-click: Open, Close board (when open).
- A board row is not a tab: `rowTabId` returns nothing for it, so a split row (`foldSplit`) never pulls it in and a
  board cell is not listed among a split row's cells.
- Boards of ended agents stay in Library → Boards only.

### What goes

- The layer inside the agent's cell: `BoardSplitLayer` in `agentsurface.tsx`, Chat's right inset and `covered` in
  `ChatLayer` (`chatpane.tsx`), `splitOpens` / `splitExpanded` and the `expanded` field.
- The tree's automatic fold beside a board (`treePeekAtom`, `treeFolds`' board branch in `agenttreeslot.tsx`): the tree
  now holds the board's row, so folding it would hide the row just clicked. The hand fold (`treeFoldedAtom`) stays.

## Verification

- Pure: `boardcell.test.ts` (id round trip, eligibility, prune with the agent, open into 1/2/3/4-cell grids, the
  full-grid pick, never focused), the tree model's board row tests, `boardsplitstore.test.ts` updated.
- CDP: the `boards-split` scenario (`scripts/cdp/scenarios-boards-split.mjs`) is rewritten for cells: the tree row,
  opening into `[agent | board]` (two `data-agent-cell`, the second `data-board-cell`), switching board in the cell,
  Expand and back, the cell's x leaving Chat alone, the agent's x taking the board with it, a 2x2 opening (full-grid
  pick), and the What's new picture (`h.whatsnewShot("board-cells", …)`).
- RAM: the board cell unmounts when hidden (asserted in the scenario: no `.excalidraw` in the DOM after switching to
  another agent).

## Not in this change

- Dragging a board row onto the grid, or a board cell beside an agent other than its own.
- More than one board cell per agent.
- Resizable tracks.
