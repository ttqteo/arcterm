# Dev servers in the agent rail — fix round 1

**Spec:** `docs/superpowers/specs/2026-10-07-rail-dev-servers-design.md`

Final round 1 (`node scripts/cdp/final-verify.mjs rail-servers agent-rail-sections agent-tree-rail`) passed 29 of 34
steps. Both tasks below change only `scripts/cdp/scenarios.mjs` and test code. No app code changes. Never run prettier on
`scripts/*.mjs` (4-space hand formatting). A task may not run a dev app or a build. Final runs the scenarios.

### Task 1: rail-servers step 9 reads the log text Monaco renders
**Depends on:** none

Step 9 of `rail-servers` (`scripts/cdp/scenarios.mjs`, the `logText` check near the end of the scenario's `assert`)
failed with `{"logClick":true,"fileUp":true,"following":"true","logText":false}`. The final shot
`rail-servers-log.png` shows the panel displaying `rail-servers: listening on 127.0.0.1`, so the app works and the
check is wrong. Monaco renders spaces in its view lines as non-breaking spaces (U+00A0), so `innerText` never contains
`RAIL_SERVERS_LOG_LINE` with plain spaces.

Fix: inside the page expression, normalise the panel's `innerText` before the `includes`: replace ` ` with a
space. Mind the escaping, because the expression is a template string evaluated in the page. Keep the 12 s wait, and
keep the check scoped to `[data-rail-file]`. Change nothing else in the scenario.

Acceptance: the page-side expression, run on a string holding `rail-servers: listening on 127.0.0.1`,
returns true. Show this with `node -e`, building the same expression text the scenario builds. Final's
`rail-servers` step 9 passes.

### Task 2: agent-tree-rail steps 0, 3, 7, 13 follow the current Agent tree
**Depends on:** none

These four steps of `agent-tree-rail` (`scripts/cdp/scenarios.mjs`: `arrangeTreeRail` and the scenario's `assert`)
failed, though this run never touched the tree (its only change to this scenario, step 10's strip order, passes). Three earlier commits changed the tree on purpose and
did not update the scenario:
- 688253b7: a run a session started nests one level in under it.
- 577a89b6: an idle row shows the n/m part its turn stopped on.
- 2e5adf23: an ended run lists under the ended session that started it.

Read `frontend/app/view/agents/agenttree.tsx` and `agenttreemodel.ts` at HEAD and those commits' diffs. Then bring
each failing step up to the current markup. Failing details from Final:
- 0. `the lead row nested under its run and was focused, and t-1 dispatched`: `dispatched` is true, so
  `ctx.leadFocused` came back false. The lead row lookup or focus click in `arrangeTreeRail` no longer finds the
  row.
- 3. `the lead row's mark is an svg in the 14px leading column`: `{"tag":null,"slotWidth":null}`. The lookup
  `name.closest(".cursor-pointer")` → first child no longer reaches the row's leading column.
- 7. `the lead's run line carries its workers chip, unclipped progress and the task strip`:
  `{"strip":null,"workersChip":null,"progress":null,...}`. The final shot `agent-tree-rail.png` still shows the lead
  row with a `1 worker` chip, `0/3 done` and a progress bar, so `rowOf(lead)` now resolves to an element that does
  not hold them.
- 13. `... a plain agent row is one line`: `{"newAgent":true,"groups":2,"folders":2,"plain":1,"tallest":50.25}`. Only
  `tallest <= 34` fails: the plain row `idle scribe` renders a second line (`? · sonnet`).

Rules:
- Keep every claim the current UI still meets, and fix only how the step finds its elements.
- Change a claim only when one of the commits above changed that behaviour on purpose. Say so in a comment at the
  step, naming the commit, and in your report. Step 13's one-line height is the likely case. Find out from
  `agenttree.tsx` which commit added the second line and whether it is meant for every plain row.
- If a step fails because the tree is broken rather than changed, leave the step failing. Report it under Found not
  fixed instead of weakening the check.
- Do not touch steps 1, 2, 4–6 or 8–14 beyond a shared helper they all use. If you change such a helper, check that
  every caller still reads the same element. Other scenarios that copy this pattern (`run-sheet-polish`, the
  doc-review scenario) are out of scope.

Acceptance: each changed selector matches the element it targets in the JSX at HEAD. Cite the line in your report.
Final's `agent-tree-rail` passes all 15 steps.
