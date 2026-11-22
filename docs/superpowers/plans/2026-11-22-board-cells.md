# Board cells Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A board is a row under its agent in the Agent tree and opens as its own cell of the split, beside the agent's Chat, replacing the layer inside the agent's cell.

**Architecture:** The grid gains a third cell kind, `board:<agentId>`, that is never focused, lives only in the grid that holds its agent, and mounts only while shown. Which board it shows stays `boardSplitAtom(agentId)`, now persisted. `openBoard` keeps its signature and adds the cell; the tree model gains a `board` row.

**Tech Stack:** React 19, jotai, Tailwind 4, vitest, CDP scenarios (`scripts/cdp/`).

**Spec:** `docs/superpowers/specs/2026-11-22-board-cells-design.md`

**Verify:** `node scripts/verify.mjs ./skills/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs boards-split agent-grid surface-smoke`

## Global Constraints

- Board cell id is exactly `board:<agentId>`; one board cell per agent.
- `focusIdAtom` and a grid's `focused` never hold a board cell id.
- A board cell exists only in the grid that also holds its agent; reconcile prunes it otherwise.
- The terminal stack stays one always-rendered CSS grid; tracks `minmax(0, 1fr)`, cells `min-w-0 min-h-0`, no size animation; terminal panes are never re-parented or remounted (AGENTS.md "Load-bearing rules").
- A board cell mounts only while shown and unmounts when hidden; its React key is its id.
- `boardSplitAtom` is persisted in localStorage key `agent.boards`, keyed by agent id, with no `expanded` field; the Expand flag is separate per agent and not persisted.
- Colors only from `@theme` tokens; no raw hex. UI follows `DESIGN.md`.
- `openBoard(model, agentId, project, boardId)` keeps its signature; every current caller keeps working unchanged.

## Review Focus

- A persisted board cell whose agent ended while arcterm was closed: after launch no empty cell and no orphan `agent.boards` entry (Task 1 test `prunes a board cell whose agent left`).
- The board open in its cell is deleted (list loaded, board absent): the board entry clears and the cell goes, Chat alone (Task 2 step).
- Opening a board from Chat's card while the agent sits in a full 2x2: the last non-agent, non-focused cell gives way, the focused tab keeps its cell (Task 1 test `full grid replaces the last other cell`).
- A mouse-down or typing inside the board cell must not move `focusIdAtom`, steal keyboard focus into an xterm, or swap the header (Task 2 step, asserted in Task 4).
- Switching to another project with a board split saved: the board cell unmounts (no `.excalidraw` in the DOM) and returns with that project's split (Task 4 step).

---

### Task 1: Board cell rules, persisted board entries, openBoard adds the cell

**Depends on:** none
**Files:** `frontend/app/view/boards/boardcell.ts`, `frontend/app/view/boards/boardcell.test.ts`, `frontend/app/view/boards/boardsplitstore.ts`, `frontend/app/view/boards/boardsplitstore.test.ts`, `frontend/app/view/agents/agentgrid.ts`, `frontend/app/view/agents/agentgrid.test.ts`, `frontend/app/view/agents/gridstore.ts`, `frontend/app/view/agents/gridstore.test.ts`

**Interfaces:**
- Produces (`boards/boardcell.ts`, pure, no atoms):
  - `BOARD_CELL_PREFIX = "board:"`
  - `boardCellId(agentId: string): string`
  - `boardCellAgent(id: string): string | undefined` (undefined for any id not starting with the prefix)
  - `isBoardCell(id: string): boolean`
  - `boardCellIds(eligibleAgents: ReadonlySet<string>, open: ReadonlySet<string>): string[]` — `board:<id>` for each agent in both sets
  - `openBoardCellIn(grid: GridState, agentId: string): GridState` — the spec's "Opening" steps 3–5 on the grid on screen: no-op when the board cell is there; `addCell(grid, board, indexOf(agent), "right")` when there is room (or a fresh `[agent, board]` when the agent is not in `grid`); in a 4-cell grid the last cell in reading order that is neither the agent nor `grid.focused` is replaced in place (same placement). `focused` stays the agent.
- Produces (`agents/agentgrid.ts`): `reconcileProjectGrids` input gains optional `companionOf?: (id: string) => string | undefined`; a cell whose companion is not in the same grid is dropped, and a companion id is never chosen as `focused`.
- Produces (`agents/gridstore.ts`):
  - `gridEligibility(tabs: ReadonlyArray<GridTab>, openBoards: ReadonlySet<string>): { eligible: Set<string>; projectOf: Map<string, string>; companionOf: (id: string) => string | undefined }` — board ids share their agent's project; used by `currentGrids`, `currentGrid`, `treeSplits` and `fitsShownGrid` in place of the separate `eligibleIds` + `gridProjects` calls (keep both exported; the surface uses `gridEligibility` in Task 2).
  - `openBoardCell(model: GridModel, agentId: string): void` — commits `openBoardCellIn(currentGrid(model), agentId)`.
  - `removeBoardCell(model: GridModel, agentId: string): void`
- Produces (`boards/boardsplitstore.ts`):
  - `BoardSplit = { project: string; boardId: string }` (no `expanded`)
  - `boardEntriesAtom`: `atomWithStorage<Record<string, BoardSplit>>("agent.boards", {}, undefined, { getOnInit: true })`; `boardSplitAtom(agentId)` derives from it (read/write one entry, `null` clears).
  - `openBoardIdsAtom: Atom<ReadonlySet<string>>` — agent ids with an entry.
  - `boardMaxAtom = atomFamily((agentId) => atom(false))`; `setBoardMax(agentId, on)`.
  - `pruneBoardEntries(live: ReadonlySet<string>): void` — drops entries of agents not in `live` (called by Task 2 once the roster is seeded).
  - `openBoard` (same signature): existing steps 1 (openTerminal, setAgentView, setChatMode) then set the entry, then `openBoardCell(model, agentId)`. `closeBoard(agentId)` clears the entry and `boardMaxAtom`; the cell then prunes. `switchBoard` kept.
  - Removed: `splitOpens`, `splitExpanded`, `setBoardExpanded`, `treePeekAtom`, `treeFolds`' board branch (`treeFoldedAtom` stays; `treeFolds` becomes `(folded) => folded` or is removed with its caller fixed in Task 2 — keep the export compiling until Task 2 by leaving `treeFolds(split, chatShown, peek, folded)` returning `folded`).

- [ ] **Step 1: Write failing tests in `boardcell.test.ts`**

`boardCellId("a1") === "board:a1"`, `boardCellAgent("board:a1") === "a1"`, `boardCellAgent("a1") === undefined`; `boardCellIds(new Set(["a","b"]), new Set(["b","c"]))` equals `["board:b"]`. `openBoardCellIn`: from `{ids:["a"],focused:"a"}` → ids `["a","board:a"]`, focused `"a"`; from `["a","t"]` focused `"t"` → three cells with `board:a` right of `a`, focused stays `"t"` only if the caller keeps it — assert focused `"a"` (opening focuses the agent); from `["x","a","y","z"]` focused `"a"`: `full grid replaces the last other cell` → `"z"` replaced by `"board:a"` at z's placement; from `["a","b","c","board:a"]` → unchanged; agent not in grid `["x","y"]` → `{ids:["a","board:a"]}`.

- [ ] **Step 2: Write failing tests in `agentgrid.test.ts`** — `prunes a board cell whose agent left`: reconcile `{ids:["a","board:a"]}` with `eligible` lacking `"a"` and `"board:a"` → empty; with `companionOf` and a grid `["b","board:a"]` → `["b"]`; `focusId: "board:a"` never becomes `focused`.

- [ ] **Step 3: Write failing tests in `gridstore.test.ts` and `boardsplitstore.test.ts`** — `openBoard` on a lone agent leaves `agentGridAtom` `["a","board:a"]` and `boardSplitAtom("a")` `{project, boardId}`; `closeBoard("a")` then `currentGrid` → `["a"]`; `localStorage["agent.boards"]` holds the entry; `pruneBoardEntries(new Set())` empties it; a second `openBoard` of another board of the same agent keeps one board cell and switches `boardId`.

- [ ] **Step 4: Run them and see them fail**

Run: `npx vitest run frontend/app/view/boards/boardcell.test.ts frontend/app/view/agents/agentgrid.test.ts frontend/app/view/agents/gridstore.test.ts frontend/app/view/boards/boardsplitstore.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 5: Implement the interfaces above.** Update the stale expectations in `boardsplitstore.test.ts` that assert `expanded`/`splitOpens`.

- [ ] **Step 6: Run the four test files and the whole agents suite**

Run: `npx vitest run frontend/app/view/boards frontend/app/view/agents`
Expected: PASS.

- [ ] **Step 7: Commit** — `feat(boards): a board is a grid cell of its own (board:<agent>), persisted, opened right of its agent`

### Task 2: Draw the board cell; drop the layer inside the agent's cell

**Depends on:** Task 1 (uses gridEligibility, the board cell ids and the persisted board entries)
**Files:** `frontend/app/view/agents/agentsurface.tsx`, `frontend/app/view/boards/boardsplit.tsx`, `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/agenttreeslot.tsx`, `frontend/app/view/agents/gridcellbar.tsx`, `frontend/app/view/boards/boardheader.tsx`

**Interfaces:**
- Consumes: Task 1's `gridEligibility`, `isBoardCell`, `boardCellAgent`, `boardCellId`, `boardSplitAtom`, `openBoardIdsAtom`, `boardMaxAtom`, `setBoardMax`, `closeBoard`, `pruneBoardEntries`, `removeBoardCell`.
- Produces: `BoardCell({ model, agent, multi }: { model: AgentsViewModel; agent: AgentVM; multi: boolean })` exported from `boards/boardsplit.tsx` (the body of today's `OpenSplit`, without the absolute positioning and the left inset), root carries `data-board-cell={boardId}` and `data-board-max`. `BoardSplitLayer` is deleted.

- [ ] **Step 1: In `agentsurface.tsx` compute eligibility with `gridEligibility(tabs, openBoardIds)`** and pass `companionOf` to `reconcileProjectGrids`. Call `pruneBoardEntries(new Set(agents.map(a => a.id)))` in an effect once `seeded`.

- [ ] **Step 2: Render board cells inside the same grid parent**, after the tab cells: for each `cells` entry whose id `isBoardCell`, a wrapper `key={id}` with `placementStyle(cell.placement)`, the tiled border classes the tab cells use (never `border-accent`: never focused), a `GridCellBar` for a board (Task 2 extends `gridcellbar.tsx` to take a `title` and `onRemove` without an agent's menu; the title is the board's name), then `<BoardCell>`; plus `GridDropOverlay` as tab cells have. No `onMouseDownCapture`/`onFocus` focus handler on a board cell. A board cell not in `cells` renders nothing (unmounted).

- [ ] **Step 3: Expand** — when `boardMaxAtom(agentId)` is on and its board cell is in `cells`, the board wrapper gets `gridRow: "1 / span 2"`, `gridColumn: "1 / span 2"` and the other cells get `hidden` (still mounted), as `dockMax` does. The header's Expand calls `setBoardMax`; "N earlier" in `BoardTurns` calls `setBoardMax(agentId, true)`. `BoardHeader` loses `canExpand` (always can).

- [ ] **Step 4: Board gone** — in `BoardCell`, when the project's list is loaded (`useBoardList` not null) and the board is absent, call `closeBoard(agentId)` in an effect.

- [ ] **Step 5: Remove the old layer** — delete the `BoardSplitLayer` render and import in `agentsurface.tsx`; in `ChatLayer` (`chatpane.tsx`) remove `split`, `covered`, `inert` and Chat's right inset (search `min(360px,50%)` / `boardSplitAtom` in `chatpane.tsx`); in `agenttreeslot.tsx` drop the board-aware fold (`treePeekAtom`, `besideBoard`), keeping the hand fold and its strip. Fix `refmentionstore.ts` only if Task 1's atom shape broke it (it reads `.boardId`, which stays).

- [ ] **Step 6: Typecheck and run the suites**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` then `npx vitest run frontend/app/view/boards frontend/app/view/agents`
Expected: exit 0; PASS.

- [ ] **Step 7: Live check** — start `task dev:browser` (wait for its `browser app ready:` line, with a timeout), open a board from the board card in an agent's Chat, run `node scripts/cdp-shot.mjs`, and confirm two cells with Chat filling its own. Stop the dev browser shell after. The full scenario is Task 4's.

- [ ] **Step 8: Commit** — `feat(boards): the board draws as its own cell beside Chat; Chat keeps its whole cell and the tree stays open`

### Task 3: The board row in the Agent tree

**Depends on:** Task 1 (uses openBoard, closeBoard and boardCellId)
**Files:** `frontend/app/view/agents/agentsidebarmodel.ts`, `frontend/app/view/agents/agentsidebarmodel.test.ts`, `frontend/app/view/agents/agenttree.tsx`, `frontend/app/view/agents/activenav.ts`

**Interfaces:**
- Consumes: Task 1's `openBoard`, `closeBoard`, `boardSplitAtom`, `boardCellId`; `boardsOfAgent`, `useBoardList("")` from `boards/boardstore.ts`.
- Produces: `ProjectTreeRow` member `{ kind: "board"; project: string; agentId: string; boardProject: string; boardId: string; name: string; more: number }`; `projectTree` input gains `boards?: ReadonlyMap<string, readonly BoardInfo[]>` (by agent tab id, most recently active first).

- [ ] **Step 1: Write failing tests in `agentsidebarmodel.test.ts`** — an agent with boards `[b2 (newer), b1]` yields, right after its row, `{kind:"board", agentId, boardId:"b2", name:"<b2 name>", more:1}`; an agent with none yields no board row; `rowTabId` of a board row is undefined, so `foldSplit` with a grid `["a","board:a"]` makes no split row and keeps the board row after `a`; a lead/worker row's boards appear the same way under its row.

- [ ] **Step 2: Run and see them fail** — `npx vitest run frontend/app/view/agents/agentsidebarmodel.test.ts` → FAIL.

- [ ] **Step 3: Implement the row in `projectTree`.**

- [ ] **Step 4: Render it in `agenttree.tsx`** — indented under the agent like a run's child row, a board glyph (lucide `PenTool` or the one `chatboardcard.tsx` uses), the name truncated, `+N` muted when `more > 0`, selected style while `board:<agentId>` is a cell of the grid on screen and `boardSplitAtom(agentId)?.boardId === boardId`. Click → `openBoard(model, agentId, boardProject, boardId)`. Context menu: Open; Close board when open (`closeBoard`). `data-tree-board={boardId}` on the row.

- [ ] **Step 5: Keep it out of keyboard nav** — `activeNavOrder` (`activenav.ts`) and the tree's `j`/`k` list must skip `kind: "board"`; add a case to the existing nav-order test if one covers row kinds, else assert in Step 1's file that a board row has no nav id.

- [ ] **Step 6: Run** `npx vitest run frontend/app/view/agents` → PASS; `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` → exit 0.

- [ ] **Step 7: Commit** — `feat(agents): each live agent's latest board is a row under it in the tree; click opens it beside Chat`

### Task 4: CDP scenario, What's new, docs

**Depends on:** Task 2 (asserts the board cell it draws), Task 3 (asserts the tree row it adds)
**Files:** `scripts/cdp/scenarios-boards-split.mjs`, `CHANGELOG.md`, `docs/superpowers/specs/2026-11-19-kael-boards-design.md`

- [ ] **Step 1: Rewrite the `boards-split` scenario's steps for cells** (keep its arrange/teardown and stubbed board RPCs): (a) the tree shows `[data-tree-board="<B1>"]` with `+1` under the agent; (b) clicking it gives `[data-agent-grid-count="2"]`, one `[data-agent-terminal]` cell and one `[data-board-cell="<B1>"]`, and the Chat cell's width is about half the grid (±10%); (c) the header switcher swaps to B2 in the same cell (still 2 cells); (d) Expand: `[data-board-max="true"]` and the agent cell hidden, then back; (e) mouse-down in the canvas leaves `focusIdAtom` on the agent and the header title the agent's; (f) the board cell's x leaves one cell, Chat; (g) reopen, then the agent cell's x → no board cell; (h) a 2x2 of four agents with the board's agent focused, open from the Chat card → the last other cell is replaced; (i) focus another agent alone → no `.excalidraw` in the DOM; (j) the third board of another agent opened from this Chat card still opens in this agent's cell. Take `await h.whatsnewShot("board-cells", { selector: "[data-agent-grid]" })` after (b).

- [ ] **Step 2: Run it** — on a Mac: `task dev:browser` (wait for its `browser app ready:` line, with a timeout), then `node --experimental-websocket scripts/cdp/verify.mjs boards-split agent-grid`. Expected: PASS for both. Stop the dev browser shell after.

- [ ] **Step 3: CHANGELOG** — under `## Unreleased` → `Changed`: `A board now opens as its own pane beside the agent's Chat, and each agent's latest board is a row under it in the Agent tree. <!-- big --> <!-- shot: <the file the shot printed> -->`.

- [ ] **Step 4: Old spec** — in `2026-11-19-kael-boards-design.md` under "Where a board shows: split beside Chat", one line: superseded by `2026-11-22-board-cells-design.md`; leave the rest.

- [ ] **Step 5: Run** `npx vitest run frontend/app/cockpit/whatsnew.test.ts` (the `whatsnew.test.ts` shot check) → PASS.

- [ ] **Step 6: Commit** — `test(boards-split): the board as a cell beside Chat and a tree row; What's new picture`
