# Independent board cells: a board is a peer cell that reads one chat, and moves between chats

Amends `2026-11-22-board-cells-design.md` ("A board cell", "Opening", "Expand", and the first two items of "Not in this
change"). The tree row, the mount rule and what went stand.

## Why

The person (2026-11-22) wanted a board to work on its own: split like `agent | agent`, always tied to one chat, but able
to move to another chat, and its turns column folded out of the way when the canvas needs the room. A board cell that
dies with its agent's cell, one per agent, could do neither.

## Approaches

- **Peer cell keyed by the board, tie in wavesrv (picked).** The cell is `board:<project>/<boardId>`; which chat it
  reads stays the board's tie (`talk.agent`, `BoardInfo.agenttabid`), which `BoardTakeOverCommand` already moves. One
  source of truth for the tie, and the cell never changes id when the chat does.
- Keep `board:<agentId>` and re-key the cell on a chat move: a move would remount the canvas and the cell id would lie
  about what it shows.
- A frontend-only tie (the cell remembers its chat): the drawer reads the tie wavesrv holds, so the two would drift.

## Decisions

- **The cell.** `board:<project>/<boardId>` (`boards/boardcell.ts`). Any number of boards may be open; the open list is
  localStorage `agent.openboards` (`boards/boardentries.ts`). The old per-agent `agent.boards` is not read, and an old
  `board:<agentId>` id in a saved grid is pruned.
- **A rider, not a companion.** `agentgrid.settleRiders` replaces `settleCompanions`: a board cell never holds focus
  (focus goes to the first tab), and a grid with no tab in it drops its board cells. A board stays when the chat it reads
  leaves the grid, and sits beside any tab of its project.
- **Opening.** `openBoard(model, agentId, project, boardId)` keeps its signature and callers: it focuses `agentId` as
  before, opens the board, and puts its cell right of `agentId`'s (else right of the focused cell). A board already on
  screen stays where it is. A full grid gives up its last cell that is neither, as before.
- **Dragging.** The board cell's bar is a drag handle, as a tab's is; a dropped board never takes focus.
- **The chat picker.** The board header shows `Chat: <title> ▾`, listing the live Claude chats of the board's project
  (`takeoverAgents`). Picking one calls `BoardTakeOverCommand`, which no longer refuses a board whose chat still runs.
  The drawer reads the new chat from the start of its session (its read cursor resets, as a takeover always did), and
  "Send to agent" goes to it. The board's tree row moves under the new chat; its cell does not move. A board whose chat
  ended still opens; its ask box says to pick a chat.
- **Switching board** in the header puts the other board in the same square (`replaceBoardCellIn`), closing the first;
  the switcher lists the boards of the board's chat.
- **Expand** is per board (`boardMaxAtom(<project>/<boardId>)`).
- **Hide turns.** A header button folds the turns column (turns, error, ask box) to a 14px strip, right of the canvas
  when the board is expanded and wide, under it otherwise; the strip opens it again. Kept per board in localStorage
  `board.turns.folded`.

## Verification

- Pure: `boardcell.test.ts`, `boardsplitstore.test.ts`, `gridstore.test.ts`, `agentgrid.test.ts` (riders);
  `TestBoardTakeOver` (a live chat's board moves).
- CDP `boards-split`: 8a (the agent's x leaves its board beside the other agent), 12 (two boards side by side), 13 (the
  chat picker moves the board), 14 (Hide turns folds to a strip and back).
