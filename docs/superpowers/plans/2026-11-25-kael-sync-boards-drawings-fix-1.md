# Kael sync 11-25 (3 of 3), Final round 1 fixes

**Spec:** `docs/superpowers/specs/2026-11-25-kael-sync-boards-drawings-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/boarddrawer ./pkg/boardstore ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs boards-split boards-library boards-chat`

Final round 1 ran 56 steps and failed 8. Every failure, what caused it, and the task that fixes it:

| Step | Cause | Fix |
|---|---|---|
| boards-split 8b | The canvas computes the parts only on open, on a landing and on autosave, never when the canvas changes size. B1 (440 wide) in the 380 px half cell needs parts by `needsParts`' own rule (440 × 0.7 > 380 − 2 × 40). It used to pass only because it read a stale width. | Task 1: the parts follow the canvas size. Task 2: 8b checks this both ways. |
| boards-split 17a, 17b, 17c, boards-library 7b | The probe `.App-toolbar` matches Excalidraw's phone-layout footer (`footer.App-toolbar`), which a narrow canvas draws even in view mode (`node_modules/@excalidraw/excalidraw/dist/dev/index.js` ~15574). | Task 2: probe `.App-toolbar-container` instead. Both layouts render it only while the drawing tools show. |
| boards-split 17a (the drag) | B1 has parts in the half cell, so hovering SQLite's centre puts the Read label (`pointer-events-auto`) under the pointer. The press goes to the label and Excalidraw never sees it. | Task 2: start the drag on the shape away from the label. |
| boards-chat 4 | The bare smoke canvas is rendered with no jotai `Provider`, so `useAtomValue(boardEditingAtom)` reads jotai's default store. `setEditing` writes `globalStore` (`editing: false` in the detail), so undo stays refused in view mode. | Task 2: render the smoke canvas inside `Provider store={globalStore}`, as `cockpit-root.tsx` does. |
| boards-library 9, 9c | Already failing on this base. Main fixed both in `073840e28` (step 9 counts `data-board-cell-of`; 9c matches the confirm's label inside the dialog). | Task 2: `git cherry-pick -n 073840e28`. It applies cleanly here (checked with `git apply --check`). |

Rules for both tasks are the original plan's (`docs/superpowers/plans/2026-11-25-kael-sync-boards-drawings.md`, "Rules for every task"). Also:
- Scenario files are hand-formatted: never run prettier on `scripts/*.mjs`.
- This is an Arc-run worker (`ARC_RUN_AGENT=1`), so it runs no CDP. Final is the live pass.

### Task 1: A board's parts follow the canvas size
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/boards/boardcanvas.tsx`, `CHANGELOG.md`

`frontend/app/view/boards/boardcanvas.tsx`:
- `updateParts()` measures `needsParts(found, st.width, st.height)`, but nothing calls it when the canvas resizes. When Expand or Collapse, the grid, or the window changes the canvas size, the stepper and the Read label stay as they were for the old size.
- In `syncView`, after its guards (not while easing, and not at a zero size), compare `appState.width` and `appState.height` with the size the parts were last computed at. Keep that size in a ref that `updateParts` sets. When the size differs, call `updateParts()`. Excalidraw fires `onChange` with the new size after its container resizes, and `syncView` runs on every change, including the one at the end of an ease.
- When `updateParts` publishes a new list while a part is open, close the part with `closePart()`. This is the rule a change of drawing in view already follows. If the part is left open, its index can point past the new list, or into an empty one when the board now reads whole.
- Keep `drawingChanged`'s own call. Both calls go through `partsKey`, so an unchanged list publishes nothing.

`CHANGELOG.md`: add one line under `Fixed` in the top (Unreleased) section, written for the user. It is not a fork line. For example: "Expanding a board that then fits whole drops its ‹ N parts › stepper, and collapsing it brings the stepper back. The parts used to stay as they were when the board opened."

Acceptance:
- Scenario step `boards-split` 8b, as Task 2 rewrites it: B1 reads `3` parts in the half cell, `0` with no stepper once expanded, and `3` again once collapsed.
- `npx vitest run frontend/app/view/boards/boardparts.test.ts frontend/app/view/boards/boarddrawings.test.ts` passes.
- `task check:ts` passes.
- `npx eslint` and `npx prettier --check` pass on `boardcanvas.tsx`.

### Task 2: Scenario fixes for the Final's failed steps
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios-boards-split.mjs`, `scripts/cdp/scenarios-boards-library.mjs`, `scripts/cdp/scenarios-boards-chat.mjs`

Every rewritten step puts each value it checks into its detail, so that a failure names its condition. Round 1's 8b and 17a details left some out.

`scripts/cdp/scenarios-boards-split.mjs`:
- **`readMode`** (~line 439): change `toolbar: !!c?.querySelector(".App-toolbar")` to `.App-toolbar-container`. Add a comment that the phone layout's bottom `footer.App-toolbar` stays in view mode. This fixes 17b and 17c with no other change to them.
- **17a, the drag:** start on SQLite at about 85 % of its width and 80 % of its height, not at its centre. The Read label sits in the part's top-left corner, from `outline.top + 4`, and covers the centre of a box that small. Read `document.elementFromPoint(x, y)` at the start point after the first `mouseMoved`. Record its tag, and require `CANVAS` for the step to pass. The other conditions of 17a stay.
- **8b, its last block** ("a small board reads whole"):
  - Open B1 beside Chat and wait for `canvasReady`. Read `data-board-parts`; expect `"3"` with one `[data-board-parts-count]`.
  - Click `[data-board-expand]`, and wait until `data-board-parts === "0"` and the stepper count is 0.
  - Click `[data-board-expand]` again, and wait until `data-board-parts === "3"`.
  - Close B1 as now.
  - Rename the step's tail so it describes this ("…; B1 needs parts in the half cell, reads whole once expanded and gets them back collapsed").
  - Record `half`, `expanded`, `collapsed`, and every boolean the step ANDs.

`scripts/cdp/scenarios-boards-library.mjs`:
- Run `git cherry-pick -n 073840e28`. It is main's fix for steps 9 and 9c and touches only this file. If it does not apply cleanly, write its three hunks by hand from `git show 073840e28`.
- **`modeOf`** (~line 319): the same probe change, to `.App-toolbar-container`. This fixes 7b.

`scripts/cdp/scenarios-boards-chat.mjs`, step 4:
- The smoke root renders `BoardCanvas` bare, so its atoms read jotai's default store and miss `globalStore`, where `setEditing` writes.
- In `smoke.render`, wrap the element in jotai's `Provider` with `store: globalStore`. Get `Provider` with `const J = await mod("deps/jotai.js")` and `J.Provider ?? J.default?.Provider`, the same way the step reaches react and react-dom. Check the optimized dep's file name the way the step's existing `deps/react.js` import resolves.
- Nothing else in the step changes. The `editing` condition then holds and Ctrl+Z undoes the landing.

Acceptance:
- On Final:
  - `boards-split` 8b, 17a, 17b and 17c pass.
  - `boards-library` 7b, 9 and 9c pass.
  - `boards-chat` 4 passes.
  - The steps that passed in round 1 still pass.
- `node --check` passes on the three files.
- `npx eslint` passes on the three files (the `gridBefore` warning that was there before may stay).
