# Council figures: fix round 1

Final failed on one step, `council-map`'s "at a 1000px window the Map's tabs are icons…". That step was already
broken on the base, so it is not a regression from this run. Task 1 fixes it. Task 2 fixes a layout defect t-8
reported: in the shots, the stance grid hides its last columns behind a sideways scroll even at 1600px. Both tasks
are small and independent.

**Verify:** `node scripts/verify.mjs ./pkg/council/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs council-summary council-map council-figures council-figures-graph council-bench-chart`
**Prototype:** D:\work\arcterm\.superpowers\design\council-figures\project

### Task 1: council-map's narrow-header step expects the shortcut hint in the tab titles
**Depends on:** none

Files: `scripts/cdp/council/map.mjs` (only this file).

- **Cause:** commit `91e095d12` ("r, c and m switch a council to its Report, Discussion and Map") changed the
  council tabs' `title`s to `Report (r)`, `Discussion (c)` and `Bản đồ (m)`. In the step "at a 1000px window the Map's
  tabs are icons with Bản đồ in the Map tab's title and aria-label…" (`map.mjs` around line 770), the assertion
  still reads `t.title === t.word`, so it fails on the base as well. The data the last Final printed:
  `"title":"Bản đồ (m)","aria":"Bản đồ"`.
- **Fix:** change the assertion to expect the hint, `t.title === \`${t.word} (${"rcm"[i]})\`` with the index taken
  from `every((t, i) => …)`. This is exactly what `council-summary`'s equivalent step does (`summary.mjs` around line
  1568). Keep the `aria === "Bản đồ"` check, and update the step's title text if it names the title. No product
  code changes.
- **Done when:** `task verify:ui -- council-map` (or the Final) passes that step and every other `council-map` step
  still passes.

### Task 2: the stance grid fits beside the quadrant, as the Main board draws it
**Depends on:** none

Files: `frontend/app/view/agents/councilglancefigures.tsx`, `scripts/cdp/council/figures.mjs`.

- **Problem:** figure B forces a minimum width of `DIRECTION_COL_PX (200) + seats × SEAT_COL_PX (92) +
  BACKING_COL_PX`, which comes to 810px for five seats. Beside A (452px plus a 20px gap) inside the Report's body
  (at most 1100px), B gets about 628px. So at every width, the last seat's column and the Backing column sit behind
  B's sideways scroll. The approved `Main.dc.html` board puts B beside A at the same widths, with every column
  showing, because its columns are sized to their content and the direction cell is the one that gives way
  (`max-width: 230px`, title ellipsed, "D<rank>" never cut).
- **Fix:** match the board. Size the seat columns and the Backing column to their content: no fixed 92px floor, and
  a pill ("? Challenge") never wraps or clips. The Direction column takes whatever width is left and truncates its
  title with an ellipsis. It keeps the "D<rank>" label and a minimum of about 96px. The full title stays in the row's
  tooltip and title attribute. The table's minimum width becomes that direction minimum plus the seat and Backing
  columns' content widths. B scrolls sideways only below that width, which happens in a narrow stacked pane (N6
  still holds). Keep the 900px container query, the markers, the row click and Enter, the legend line, and the
  glyph plus word in each cell. Don't change A.
- **Scenario:** in `council-figures`, the first step ("At a glance sits between the cover and the directions…")
  records `sideBySide`. Extend it to read B's scroll box and assert `scrollWidth <= clientWidth + 1` while A and B
  sit side by side, with the last seat's header and the Backing header inside B's box. The shot must show every
  column. The narrow step (pane under 900px, stacked) stays as it is.
- **Done when:** `task check:ts` passes, and `council-figures` passes with the new assertion and with
  `sideBySide: true` at the scenario's wide window.
