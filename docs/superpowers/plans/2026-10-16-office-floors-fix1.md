# Office floors, fix round 1

The final stage of run 006c403f found one defect against the spec
(`docs/superpowers/specs/2026-10-16-office-floors-design.md`, "A room": "A project with no run has no table: the strip
is carpet with a plant") and the Room board (`Room.dc.html`, lines 152-193): a room with no run must have a plant in
its meeting strip, and the top-right plant too while its first desk row has a free place. Today `buildPlan` keeps one
plant at most and puts the strip plant only when the first desk row is full, so mit-thesis and cuscofi-production on
floor 1, and portfolio-journal, vnstock-js-docs and Home on G, show plain carpet in the strip.

### Task 1: A plant in every runless room's meeting strip

**Depends on:** none

**Files:** `frontend/app/view/agents/officeplanmodel.ts`, `frontend/app/view/agents/officeplanmodel.test.ts`, `frontend/app/view/agents/officeboss.ts`, `frontend/app/view/agents/officeboss.test.ts`, `frontend/app/view/office/scenery.ts`, `frontend/app/view/office/scenery.test.ts`, `frontend/app/view/agents/cockpitoffice.tsx`, `scripts/cdp/cockpitofficescenarios.mjs`

Where: the `// one plant` block after the chip in `buildPlan` and the `Room` type's `plant?: Point`; officeboss's
furniture (one pot per plant); scenery's plant drawing and the value at line ~640 that reads `r.plant`; the DEV probe's
`plant` field; `cockpit-office-floors` step 10.

**Steps:**

1. In `Room`, replace `plant?: Point` with `plants?: Point[]` (absent or empty when the room has none). Update every
   reader (`grep -rn "\.plant\b\|plant:" frontend scripts/cdp`).
2. In `buildPlan`, replace the one-plant rule with two independent ones, keeping both positions as they are today:
   - top right, `{ x: x + colW - 44, y: y + 64 }`, when `fill.seated.length < cap.perRow`;
   - in the strip's left, `{ x: x + 16, y: zy + 50 }`, when `fill.tabled.length === 0`.
   Update the comment to say so. A room with a free first row and no run gets both.
3. `officeboss.ts` furniture: one pot per entry of `room.plants`.
4. `scenery.ts`: draw every plant in `room.plants`; the line ~640 value that folds `r.plant` into a signature or cache
   key must cover all of them (e.g. their count and coordinates).
5. Tests, `officeplanmodel.test.ts` "a room without a run": a runless room with a free first row has both plants (top
   right and strip); a runless room with a full first row (`plan(seven, [])`) has the strip plant only; a room with a
   run and a free first row has the top-right plant only; `plan(seven, three)` has none. Update `scenery.test.ts` and
   `officeboss.test.ts` asserts that read `plant`.
6. DEV probe in `cockpitoffice.tsx`: keep `plant` as a boolean (any plant) and add `plants` as the list, so other
   scenario steps still read.
7. `cockpit-office-floors` step 10: mit-thesis's probe must show a plant in the strip (a `plants` entry whose `y` is
   inside the room's bottom `MEET_H` px), not only `plant === true`. Rerun the scenario and check steps 1 and 1b's shots
   show the strip plant in mit-thesis, cuscofi-production, portfolio-journal, vnstock-js-docs and Home.

**Shows in:** `cockpit-office-floors` steps 1 (floor 1), 1b (G) and 10 (the probe of mit-thesis's strip plant).
