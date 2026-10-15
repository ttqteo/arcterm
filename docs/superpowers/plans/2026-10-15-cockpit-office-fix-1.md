# Cockpit office, fix round 1

**Spec:** `docs/superpowers/specs/2026-10-15-cockpit-office-design.md` (the bullet "The lounge holds a fixed set of
spots" under the floor plan, the RAM panel's "people drawn", and the Benchmark's row 7, all as of commit 904426fc4)

**Goal:** the final stage of run a81096a1 failed before it ran a scenario. This round fixes what failed it and what
would fail it next: a test that fails on every Mac, a crowded lounge whose labels overlap, a People count that reads
low, and a bench row that measures the dev page's own growth.

### Task 1: final-verify's two-stages test pins the tauri mode

**Depends on:** none
**Files:** `scripts/cdp/final-verify.test.mjs`

`final-verify.mjs build slots › runs two final stages at once, each on its own target dir, stores and ports` reads
`out-a/tauri.final.json`, which only the tauri mode writes. `finalMode()` picks the browser app off Windows, so on a
Mac the test fails with ENOENT on the base (it passes with `ARC_FINAL_BROWSER=0` in the environment).

- [ ] In `fakeDevEnv` (inside `describe("final-verify.mjs build slots")`), add `ARC_FINAL_BROWSER: "0"` to the env it
  returns, with a one-line comment: these stages read the tauri config, which only the tauri mode writes, and Final
  picks the browser app off Windows.
- [ ] Do not change `scripts/cdp/final-verify.mjs`.
- [ ] Run `node node_modules/vitest/vitest.mjs run scripts/cdp/final-verify.test.mjs`: all 28 pass on this Mac.

### Task 2: The lounge's fixed spots, the `+N in the lounge` line, People as the people drawn

**Depends on:** none
**Files:** `frontend/app/view/agents/officeplanmodel.ts`, `frontend/app/view/agents/officeplanmodel.test.ts`, `frontend/app/view/agents/cockpitoffice.tsx`, `scripts/cdp/cockpitofficescenarios.mjs`, `scripts/cockpit-fixtures/scenarios.mjs`

Today `buildPlan` (`officeplanmodel.ts`, "feet at the coffee machine and on the sofa") stands coffee people at
`coffee.x - 18 - i * 40`, which runs out of the lounge from about the fourth, and seats sofa people at
`sofa.x - 58 + (i % 3) * 40`, so a fourth sits on the first. `cockpitoffice.tsx` draws every lounge label 120 px wide
at `l.x - 42`, so labels 40 px apart overlap from the second person on. Task 6 saw "scratch · idle 7m" over
"wren · idle 14m" at 1600 px. The bench sends 18 people to the lounge.

- [ ] In `officeplanmodel.ts`, replace the two placement loops with a fixed list of lounge spots: the sofa's seats, and
  standing places by the coffee machine and by the plant, as many as fit. Each spot is a feet point plus a label box.
  Every label box (11 px text, `<name> · idle <age>`) and every person's sprite box lies inside `plan.lounge`. No
  label box overlaps another label box or another lounge person's sprite box. Keep the furniture where
  `cockpitoffice.tsx`'s `Building` draws it, and keep `plan.coffee` and `plan.sofa`, which walkers head for.
- [ ] Sofa people (`at === "sofa"`) take sofa seats, and coffee people take the standing places. Within each, order by
  `idleSince` ascending (longest idle first), ties by id, so a newcomer never moves someone already there.
- [ ] Whoever gets no spot goes in a new `plan.loungeOverflow: string[]` (agent ids), not in `loungers`. Their desk
  keeps today's look: empty, dimmed, and a title saying "at the coffee machine" or "on the sofa".
- [ ] Give `Lounger` its label box (or its width), so the view draws exactly the box the model checked. A name too
  long for its box is cut with an ellipsis, and the full label goes in the person's `title`.
- [ ] Add tests in `officeplanmodel.test.ts`, with 1, 4 and 20 people in the lounge, split between coffee and sofa,
  and one 24-character name:
  - every lounger's sprite box and label box lies inside `plan.lounge`;
  - no two label boxes intersect, and no label box intersects another lounger's sprite box;
  - spots fill longest idle first, and adding a newcomer with a later `idleSince` leaves every existing lounger's
    `x` and `bottom` unchanged;
  - `loungers.length + loungeOverflow.length` equals the people sent to the lounge;
  - no room's box changes between 1 and 20 loungers.
- [ ] In `cockpitoffice.tsx`, draw each lounge label in the model's box (`truncate`, full text in `title`). When
  `loungeOverflow.length > 0`, draw a muted 11 px line `+N in the lounge` inside the lounge, marked
  `data-office-lounge-more`. An overflow person still walks to the lounge (to `plan.coffee` or `plan.sofa`, as now)
  and is not drawn once there.
- [ ] Make People mean the people drawn. `people` (the meter and the probe, around line 741) must equal the person
  sprites on the floor: people at a desk or a seat, drawn loungers, walkers and the boss, never the `+N`.
  - Task 7's bench read 49 to 51 two seconds after opening, and 73 later, on a roster of 48 agents plus 24 run seats.
    Its guess was agents waiting to walk to the lounge, but those keep a dozing desk and are counted as seated. Find
    the real cause, which may be the walk queue, the runs' seats arriving late, or the count itself, and fix it.
  - Move the count into a pure function in `officeplanmodel.ts` (for example `peopleDrawn(plan, walkingIds)`) with a
    test.
  - Add `loungeMore` (the overflow's length) to the probe.
- [ ] Add a step to the `cockpit-office` scenario (`scripts/cdp/cockpitofficescenarios.mjs`) that crowds the lounge.
  - Setup: 12 or more agents idle past the Finished window, several of them 10 min or more, through a fixture roster
    (`scripts/cockpit-fixtures/scenarios.mjs`) or the existing dev hook. Turn the animation off, so everyone is there
    at once.
  - Shot: `cockpit-office-lounge.png`.
  - Assert from the DOM:
    - no two lounge label rects intersect;
    - every lounge label and lounge person lies inside `[data-office-floor="lounge"]`;
    - `[data-office-lounge-more]` reads `+N in the lounge`, with N equal to `probe.loungeMore`, which is above 0;
    - `probe.people` equals the person images in the DOM.
  - Afterwards, restore the roster and the animation setting as the scenario's other steps do.
- [ ] The existing `cockpit-office` steps still pass. Run
  `ARC_FINAL_OUT=<tmp dir> node scripts/cdp/final-verify.mjs cockpit-office` and look at the lounge shot and the Main
  shot.
- [ ] Do not change `cockpit-office-bench`. Task 3 changes its rows.

### Task 3: The bench's row 7 holds a second Office round trip; row 0 counts the roster

**Depends on:** Task 2
**Files:** `scripts/cdp/cockpitofficescenarios.mjs`, `docs/open-issues.md`, `frontend/app/view/agents/cockpitoffice.tsx`

Row 7 measured from the first Cards read misses because of noise. Task 7 read 0.94, 1.16, 1.09 and 2.16 MB, and a
control run that never opened the office read +1.56 MB over the same steps. The spec's Benchmark now holds what a
second round trip adds. With Task 2's `+N`, the people drawn on the bench roster (whose lounge holds 18) no longer
reach row 0's 70.

- [ ] In `cockpit-office-bench`'s assert, keep the existing return to Cards and its `closed` read. Keep
  `r.heapAfterMB` in the printed JSON for information, with no row.
  - Then open Office again the way the first open does (click `Office`, wait for `[data-office-desk]`), sleep 2 s,
    click `Cards`, sleep 2 s, and read `metrics(h)` again.
  - Set `r.heapTripMB = mb(<second read>.heap - closed.heap)`.
  - Row 7 becomes `"7. heap a second Office round trip adds, back in Cards <= 1 MB"`, holding `r.heapTripMB <= 1`.
- [ ] Row 0 reads the roster the plan holds: `desks + seats + 1` from the probe (48 + 24 + the boss), `>= 70`,
  labelled `"0. the bench holds about 75 people (desks, seats and the boss)"`. Replace the 20 s people poll with a
  wait of up to 20 s for `walking === 0` before the sprite-cache read.
- [ ] Run `ARC_FINAL_OUT=<tmp dir> node scripts/cdp/final-verify.mjs cockpit-office-bench` three times. Every row must
  hold each time. Report the three `heapTripMB` and `heapAfterMB` figures.
- [ ] If row 7 still misses, do not raise the budget. Find what the office keeps on each open (a listener, a timer, an
  atom write that outlives unmount, a sprite cache entry per open) with a heap snapshot comparison, and fix it in
  `cockpitoffice.tsx`.
- [ ] `docs/open-issues.md`, RAM watch: replace the row 7 miss with the second-trip figures, dated 2026-10-15. Say that
  the first trip's figure is the dev page's own growth (+1.56 MB with the office never opened), as the spec's
  Benchmark says.
