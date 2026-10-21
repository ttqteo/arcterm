# Sidebar split row — design

The Agent sidebar shows each split as one row, the way Arc's sidebar shows a split view: the cells of a project's
split leave their places in the folder and sit together in one framed row, laid out as they are on screen.

Today a split moves nothing in the tree: each cell keeps its row in its folder and wears `SplitMark`
(`agentsidebarmodel.ts` `projectTree`). That rule goes.

## What shows

- Every project with a saved split of two cells or more (`reconcileProjectGrids(...).grids`, not only the shown
  project's) gets one **split row** in its folder. A grid of one cell is no split: its row shows as usual.
- The split row sits where the topmost of its cells' rows would sit in the tree; the other cells' rows leave their
  places and join it. When none of the cells has a visible row (all folded away, e.g. workers of a folded run), it sits
  at the top of the folder's body.
- Inside the row the cells are laid out as the grid places them on screen (`placesOf`): two side by side, three as one
  tall cell and two stacked, four as 2×2. Reading order (left to right, top to bottom) is the order of the cells.
- A cell shows only what tells you which tab it is and whether it needs you: the state glyph (working, asking, idle,
  sleeping), the name, the asking or unread badge, the Alt+N digit while Alt is held, and an × on hover. It drops the
  meta line (branch, model, tokens), the subagent list, the suggested Close and a terminal's split/panel chip; the right
  panel still shows them.
- The split on screen has an accent frame and its focused cell the selected row's fill; another project's saved split
  has a plain border frame.
- A collapsed folder hides its split row with the rest of its body.

## What it does

- A click on a cell focuses it: its project's split shows with that cell focused (the existing
  `reconcileProjectGrids` path).
- × on a cell removes it from its project's split; the agent keeps running and its row goes back to its place. A split
  left with one cell dissolves into a plain row. On another project's split it changes that grid only and moves no focus.
- Right-click opens the cell's own row menu; Remove from split and End split act on the cell's project's grid.
- A cell is a drag source for the grid, as its row was.
- `j`/`k`, Alt+1..9 and the digits walk the cells in reading order at the split row's place.

## How it is built

- **Model (`agentsidebarmodel.ts`).** `projectTree` takes `splits: ReadonlyMap<string, GridState>` (grids of 2+ cells,
  by project) and the roster. A pure `foldSplits` pulls the rows whose ids are cells out of each open folder and puts
  `{ kind: "split"; project; shown; cells: { id; vm: AgentVM; place: CellPlacement }[] }` at the first pulled row's
  index (or the top of the folder's body). `vm` comes from the roster, so a cell with no visible row still has its data.
  `treeNavIds` walks `split.cells` in order.
- **Store (`gridstore.ts`).** `removeFromProjectGrid(model, project, id)` and `endProjectSplit(model, project)` edit one
  project's grid without moving focus; on the shown project they are `removeFromGrid` / `endSplit` as today.
- **View (`agenttree.tsx`).** `SplitRow` draws a small CSS grid (a card grid, as DESIGN.md allows) placing each
  `SplitCell` with `placementStyle`; `SplitCell` reuses the rows' state glyph, badges, digit hint and `dragSource`. The
  `inSplit` prop and `SplitMark` go (deleted from `terminalsrail.tsx` once nothing imports it). Colors are tokens:
  `border-accent` for the shown split, `border-border` for the others.

## Testing

- Vitest for `foldSplits` and `projectTree`: 2, 3 and 4 cells; cells with folded rows; a worker cell inside a run; a
  collapsed folder; the project filter; a one-cell grid not folded; `treeNavIds` reading order.
- Vitest for `removeFromProjectGrid` / `endProjectSplit` on a shown and a hidden project.
- CDP scenario `sidebar-split-row` (`scripts/cdp/scenarios.mjs`): seeds `agent.grids` with a 2-cell and a 3-cell split,
  shots the sidebar, asserts `[data-split-row]` rows and that the cells' own rows are gone.
- A `Changed` line in `CHANGELOG.md` and a hand check in `docs/open-issues.md`.
