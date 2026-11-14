# Council bugs batch 1: final-stage fixes, round 1

**Effort:** effort:67d1c761-ccae-4498-8c85-50d0ab9a65dd
**Verify:** `node scripts/verify.mjs ./pkg/council`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs council-discussion council-summary council-tree`

The final stage of run a9774e84 failed on three scenario steps, 204 of 207 passing. All three fail on the base too, in
steps this run's tasks did not write, but each one holds the land. Each task fixes one step in one file, so the three run
side by side. These are scenario fixes, with no user-facing change and no changelog line. If a task finds that the app is
wrong rather than the step, it fixes the app in the smallest way, adds that file to its commit, and says so in its report.

Principles: the smallest change that makes the step check what its label says. Never weaken an assertion so it passes,
and never drop a condition. Run the one scenario you touched with `task verify:ui -- <scenario>` (or
`node scripts/cdp/final-verify.mjs <scenario>`) and quote its PASS/FAIL count in the report.

---

### Task 1: council-tree step 11f opens the Report's actions menu before it reads Pin
**Depends on:** none
**Files:** `scripts/cdp/council/tree.mjs`

Final detail: `{"reportPinned":false,"reportUnpins":[],"unpinnedGone":false}`.

The Pin/Unpin row (`[data-council-pin]`) only exists inside the Report's actions menu (`councilheader.tsx:69`, moved
there by 7a43d9ae0). Step 11a (~:512-545) opens the menu with `h.ev(click(menuButton))` before it reads `pinIn`.
Step 11f (~:711-735) calls `openCouncil(h, oldPinned, "summary")` and reads `pinIn` with the menu closed, so it never
finds the row.

- [ ] **Step 1:** In 11f, wait for `menuButton`, click it, then read `reportPinned` as now. A click on the row closes the
  menu, so `unpinnedGone` must open it again before it checks `councilPin === "pin"`. Once the unpin is saved, open the
  menu again with the same click, or check that `menuButton`'s `dataset.pinned` is no longer `"true"`; either way, keep
  the check that the tree row is gone. Close the menu the way 11a does: Escape, wait for no `[data-menu-item]`, then
  Escape again. That way the steps after 11f start from the same state as before. Keep every condition in the `rec`.
- [ ] **Step 2:** Run `council-tree`; 11f and every step after it pass. Commit:
  `test(council): council-tree 11f opens the Report's actions menu before it reads Pin`.

### Task 2: council-discussion header step reads the rail foot's text with whitespace collapsed
**Depends on:** none
**Files:** `scripts/cdp/council/discussion.mjs`

Final detail: `foot.text` is `"Review\n7:20\n19 replie \n0.55M token \n7:20 · 19 replie  · 0.55M token"`, so the regex at
~:527 (`/Review .*\d+:\d\d .*repl(y|ies) .*tokens/`) cannot match.

Root cause: `headerRow` (~:406) evaluates its code from a template literal. At ~:446,
`.replace(/\s+/g, " ")` reaches the page as `/s+/g`, which strips the letter `s` and leaves the newlines. The line
beside it escapes the backslash correctly (`/\\d+ replies/`).

- [ ] **Step 1:** Write it as `/\\s+/g` at ~:446. Grep `discussion.mjs` for any other single-backslash regex class
  (`\s`, `\d`, `\w`, `\b`) inside an `h.ev` template literal and fix those too; name each one in the report.
- [ ] **Step 2:** Run `council-discussion`; the header step passes. Commit:
  `test(council): council-discussion's header step collapses the rail foot's whitespace`.

### Task 3: council-summary narrow-pane step measures the glance against the right column
**Depends on:** none
**Files:** `scripts/cdp/council/summary.mjs`

Final detail: `{"glanceTop":-995,"columnBottom":82,"widths":[461,461,461,461],"scrollWidth":541,"clientWidth":541}`.

The step (~:1460) compares the glance's top (`[data-council-glance]`, `councilsummary.tsx:764`) with the bottom of
`root.querySelector("h1").parentElement`. Both sit in the cover inside `[data-council-scroll]`
(`councilsummary.tsx:~1249-1295`), so the scroll alone cannot put the glance 1,077 px above the column.

Two leads to check, not settled yet:
1. `querySelector("h1")` may match a different `h1` lower in the Report, such as one in the rendered summary.
2. The previous step's jump link (`glideTo`, `councilsummary.tsx:642`) may still be gliding the box, which the Report
   keeps per council.

- [ ] **Step 1:** Find the cause in the live app; the task-1 worker of this run saw the same failure on the base. Then:
  - If the step measures the wrong element, or measures while the box moves, fix it: scope the column to the cover's
    `h1`, and scroll the box to the top or wait for it to settle before measuring.
  - If the glance really no longer wraps under the text at 1000 px, fix the layout in `councilsummary.tsx` and add that
    file.

  Keep all four conditions, and keep the `finally` that resets the 1600x950 metrics.
- [ ] **Step 2:** Run `council-summary`; the narrow-pane step passes, and `cdp-shots/council-summary-narrow.png` shows
  the glance under the text. Commit:
  `test(council): council-summary's narrow-pane step measures the glance against the Report's own column`.
