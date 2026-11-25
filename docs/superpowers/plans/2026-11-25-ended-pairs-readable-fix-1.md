# Read a judge pair again: Final fix round 1

**Spec:** `docs/superpowers/specs/2026-11-25-ended-pairs-readable-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/agentpair/... ./pkg/wshrpc/... ./cmd/wsh/... ./skills/...`
**Final:** `node scripts/cdp/final-verify.mjs library-tabs boards-library library-pair-open library-pairs project-overview-history pair-conversation pair-decided council-tree council-bench-chart`

The Final of round 1 passed 120 of 123 steps. The three that failed are scenario steps that went stale on `main` before
this run, not defects of the feature: each checks a behaviour the app changed on purpose earlier. Both tasks edit only a
scenario file, run side by side, and change no product code. No worker runs CDP: the Final does.

Rules for every task:

- Change only the failing step and what it alone uses; keep every other step's checks as they are. Never weaken a check
  to make it pass: replace a stale check with one that tests the same intent against today's app.
- Put every value the step's verdict reads into its `rec(...)` detail, so a future failure says which check failed.
- Never run prettier on `scripts/*.mjs` (hand-formatted 4-space files). `node --check <file>` after editing.

### Task 1: boards-library steps 9 and 9c check today's board views
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios-boards-library.mjs`

Step 9 ("selecting the live agent's board shows it alone over the Agent surface's centre, the split left as it was")
failed with detail `{"st":{"open":[],"surface":"agent"},"gridBefore":"1","noCell":false,"libraryOpen":0}`. The shot shows
the board alone over the centre, as asked. `noCell` counts `[data-board-cell="${B_LIVE}"]`, but the alone view is drawn
by the same `BoardCell` (`frontend/app/view/agents/agentsurface.tsx:1123-1133`, `BoardAlone` inside
`[data-board-alone]`), and `BoardCell` puts `data-board-cell={boardId}` on its root
(`frontend/app/view/boards/boardsplit.tsx:153`). So the check counts the alone board itself. A board's cell in the split is
wrapped by `BoardGridCell`, which carries `data-board-cell-of={boardKey(board)}` (`agentsurface.tsx:1165`).

- Make `noCell` count `[data-board-cell-of=...]` for the live board's key (the same key `ALONE` uses; confirm
  `boardKey`'s format in `frontend/app/view/boards/boardentries.ts`), so it still means "no cell of it in the split".
- Add `clicked`, `alone` and `ready` to the step's detail.

Step 9c ("Delete board in the open board's header asks first, then the board leaves the list and the detail") failed
with `{"calls":0,"detail":1,"rowsBefore":3,"rowsAfter":3}`. The shot `9c-delete-confirm` shows the confirm with its
`Delete` button, but that button is a `DialogButton` (`frontend/app/modals/dialogbutton.tsx:36-48`) that appends a key-hint
`<kbd>`, so its `textContent` is `DeleteEnter`. Both `asked` and `confirmed` match `textContent.trim() === "Delete"`, so
the click never happens.

- Match the confirm's button by its label without the hint, as `scripts/cdp/scenarios-run-start-choice.mjs:97` does
  (`(b.firstChild?.textContent ?? "").trim() === "Delete"`), in both `asked` and `confirmed`. Keep it scoped so the
  header's trash button (which has no text) and a row's Delete button can't match.
- Add `clicked`, `asked`, `confirmed` and `gone` to the step's detail.

Acceptance: `node --check scripts/cdp/scenarios-boards-library.mjs` passes. In the Final, `boards-library` steps 9 and 9c
pass, with the shots `9-live-agent`, `9c-delete-confirm` and `9c-deleted`, and every other step of the scenario still
passes.

### Task 2: council-tree step 14b steps agents with the arrows
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/council/tree.mjs`

Step 14b ("j from the agent whose next row is a council lands on the next agent or terminal row, skipping the councils,
and k comes back to the agent") failed with `jMoved: false`: after `j` the selection stayed on `fx-room-witness`.
`main`'s commit 8c547fd79 (2026-11-21, "j/k no longer step agents") removed `agent:next-j` and `agent:prev-k`. Now a letter
typed off a field goes into the focused agent's chat box. ArrowDown and ArrowUp step agents only while focus is inside
`[data-agent-tree]` (`inAgentTree` at `frontend/app/store/keybindings/bindings.ts:1357`), and `agentNav` (`bindings.ts:1352`) also
needs the centre at rest. Ctrl+Tab still steps agents anywhere. The step passed on 2026-11-14, before that change.

- Rewrite 14b to test the same intent with ArrowDown and ArrowUp: with focus on a row inside `[data-agent-tree]` (focus
  the witness row after `mouseOn` selects it, instead of blurring as `pressLetter` does), ArrowDown lands on the next
  agent or terminal row past the councils (`skipsTo`, read off the rows as today), and ArrowUp comes back to the witness.
  Check that the arrows still skip council rows: read `step` / `treeNavIds` in the bindings and the tree model, and say
  in the step's comment which function makes the skip.
- If the centre is not at rest when 14b starts (an earlier step left a council open in it), put it back first through
  the app's own route (`leaveCenter` from `frontend/app/view/agents/agentcenter.ts`, or the witness row's selection,
  which brings its terminal back), and record that in the detail.
- Rename the step's text to name ArrowDown and ArrowUp, fix the file header's mention of j and k (line 24) and the
  comment over 14b, and remove `pressLetter` if 14b was its only user.
- Add `focusInTree` (focus inside `[data-agent-tree]` before the press) to the detail.

Acceptance: `node --check scripts/cdp/council/tree.mjs` passes. In the Final, `council-tree` step 14b passes with the shot
`council-tree-jk-skip` (keep the file name, as the contact sheet and earlier runs know it), and every other step of the
scenario still passes.
