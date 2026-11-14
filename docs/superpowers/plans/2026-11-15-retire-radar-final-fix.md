# Retire Radar: final-stage fixes (round 1)

The round-1 Final (`node scripts/cdp/final-verify.mjs surface-smoke settings-headless settings-pages peek-item-views
resource-linking dag-peek agent-history agent-rail-tabs route-picker-flat brief-surface`) failed in two scenarios. Both
failures are in the CDP scenarios in `scripts/cdp/scenarios.mjs`, and neither step tests Radar. Every other scenario
passed. The round-1 output, screenshots included, is in
`%LOCALAPPDATA%/dev.arc.app/data/final-shots/f06abbc7-5a92-4086-801b-dc61010efdc8/1/`. `shots.json`
holds each step's detail and `cdp-shots/` the screenshots.

## Global Constraints

- Edit only the files named in each task's Files line (Task 1 may also edit the app file that holds the root cause,
  and names it in its report). Never weaken a step until it checks nothing: the fix has to
  make the step check what its title says.
- If the root cause is in app code rather than the scenario, fix the app code. Say which it was in your report.
- Never run prettier on `scripts/*.mjs`. Those files use hand-formatted 4-space indentation.

### Task 1: agent-rail-tabs steps 2-8 find the fixture agent's Cockpit card

**Depends on:** none
**Files:** `scripts/cdp/scenarios.mjs`

Scope: the `agent-rail-tabs` scenario and its `railTabs*` helpers, plus app code only if the root cause is there.

**Failure.** Step 2 reports `{"clicked2":false,"editor2":false,"surface2":"Cockpit","tabs2":[...],"w2":0}`. Steps 3-8
then fail in a cascade, because each depends on the same click or on the File tab it opens. `railTabsClickLink` goes
to the Cockpit and waits 15 s for a `[data-path-link]` ending in `a.txt` inside `RAIL_TABS_CARD`, but never finds one.

**Lead.** The screenshot `cdp-shots/agent-rail-tabs-file.png` shows the Cockpit with **Live only** on and the card
area empty. The IDLE (1) and BACKGROUND (2) groups are folded at the foot, so the fixture agent's card is likely
inside the folded IDLE group, or filtered out by Live only. Two possible causes: a scenario that ran earlier left that
Cockpit state behind, or the arrange step never reset it. Confirm the cause before you fix it.

**Steps.**
1. Find out why `RAIL_TABS_CARD` is missing or has no path links when step 2 runs. Read `agent-rail-tabs-file.png`,
   the arrange step and `railTabsClickLink`, and check which Cockpit filter or fold state hides the card.
2. Fix the scenario so it reaches the card wherever the Cockpit filter and fold state start. Set the state in arrange
   and restore it in teardown, so the next scenario is not affected. Don't depend on the scenario order.
3. Run `task verify:ui -- agent-rail-tabs` against a dev app, or
   `ARC_FINAL_OUT=<dir> node scripts/cdp/final-verify.mjs agent-history agent-rail-tabs` (agent-history ran just
   before it in the failing Final). Expected: every agent-rail-tabs step passes.
4. `node --check scripts/cdp/scenarios.mjs`.

**Shown by:** agent-rail-tabs steps 2-8.

### Task 2: settings-pages index accepts a hairline rule at any display scale

**Depends on:** Task 1
**Files:** `scripts/cdp/scenarios.mjs`

Scope: the `settings-pages` scenario's index step.

**Failure.** The step "index: one flat list of nine pages in order, About alone at the foot under a 1px rule and a
10px gap" got `foot={"sections":["about"],"borderTop":"0.909091px","marginTop":"10px"}`. The page order, the About
foot and the gap were all correct. The scenario compares `borderTopWidth` to the string `"1px"`, but at a 110%
display scale Chromium reports a 1px border as `0.909091px`.

**Steps.**
1. Change only the border check, so that a border which is 1 device-independent pixel at any device pixel ratio
   passes. For example, accept a `parseFloat(borderTopWidth)` greater than 0 and no more than 1, or compare it with
   `1 / devicePixelRatio` read in the same `h.ev`. A missing border (0) must still fail. Leave the step's other
   checks unchanged.
2. `node --check scripts/cdp/scenarios.mjs`. If a dev app is available, run `task verify:ui -- settings-pages`.
   Expected: every step passes.

**Shown by:** settings-pages "index" step.
