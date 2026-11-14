# Surfaces on Chat's spring: Final round 1 fixes

**Effort:** effort:7655bf18-619e-40cf-8805-5f4a6e5ac85e
**Spec:** `docs/superpowers/specs/2026-11-14-surfaces-chat-look-design.md`
**Verify:** `node scripts/verify.mjs`
**Check:** `task check:ts`

Final round 1 ran 152 steps on the merged result and 148 passed. The 4 that failed all fail on the base too, and none
is in code this run's spring changes touch; they hold the land all the same, so this round fixes each one. The run's
Final stays as it is.

Principles for every worker: KISS, YAGNI, DRY, one source of truth, measure before optimizing, handle errors at
boundaries without swallowing them. Never weaken what a step asserts: fix the product when it is wrong, and fix the
test only where it reads the wrong element or rests on a premise that is no longer true, keeping its intent. Commit
locally only, no attribution trailer in the message; never `task install`; stop a dev app by PID, never by image name.

### Task 1: brief-act-blocked step 4 reads the chunk's own head
**Depends on:** none
**Files:** `scripts/cdp/scenarios-brief-act.mjs`

Failure: `brief-act-blocked` step 4, detail `{"face":"effort","head":null,"chunk":"Stuck","status":"blocked","notes":true}`.
The step asserts `[data-jarvis-brief-sheet] [data-jarvis-initiative-sheet-head]` carries `effort:<id>`, but with a
chunk open `InitiativeSheet` draws `ChunkViewHead` (`frontend/app/view/jarvis/chunkview.tsx`, `data-jarvis-chunk-head`,
its `[data-jarvis-chunk-back]` button holding the initiative's title) instead of the initiative's head, so that
attribute can never be there. The product is right: landing on the chunk is what the step wants.

Fix the read in `scripts/cdp/scenarios-brief-act.mjs` (around line 148): take the initiative from the chunk's head,
`[data-jarvis-chunk-head] [data-jarvis-chunk-back]`'s text, and assert it equals the initiative title the scenario's
arrange created (the title is already in the file; reuse its constant, do not retype it). Keep every other condition of
the step as it is (face, chunk, status, notes, `landed`), and put the new field in the step's detail.

Acceptance: `brief-act-blocked` passes all its steps against a dev app of your tree
(`ARC_FINAL_OUT=<tmp dir> node scripts/cdp/final-verify.mjs brief-act-blocked`), step 4's detail showing the title.

### Task 2: cockpit-office steps 5b, 13c and 15b
**Depends on:** none
**Files:** `frontend/app/view/agents/cockpitoffice.tsx`, `scripts/cdp/cockpitofficescenarios.mjs`

Two causes.

**5b, the path label off the 3px grid** (detail `label: {left: 1031.9886, top: 212.9971}`, the dots exact). The dots in
`PathDots` (`cockpitoffice.tsx`, ~line 3504) are placed by `transform: translate(...)`, the label by `left` / `top`, both
rounded to `PLAN_CELL`. Chromium snaps a layout box's offset to its own grid while a transform is not snapped, so the
label lands a hundredth of a pixel off the cell the dots sit on. Fix the product: place the label like the dots
(`left-0 top-0` plus a `transform: translate(x, y)` of the same rounded values), so both come out of one path. Leave
the step's `on3` tolerance as it is. If the measure still misses, find out why before touching the assertion, and say
in your report what you measured.

**13c and 15b, the theme switch is a no-op** (13c detail `{"prevTheme":"graphite", ... "ringChanged":false}`; 15b
`prevAway: "graphite"`). Both steps switch to `"graphite"` and assume the app started on another theme, but Graphite
became the default preset on 2026-11-14 (`DEFAULT_THEME_PRESET` in `frontend/app/view/agents/themes.ts`, commit
ca4ee1207), so in Final's fresh store the switch changes nothing. Fix the scenario's premise, not its checks: pick the
target theme as a preset other than the current one (read the current one with `window.__cockpitOfficeTheme`'s return
or the preset list in `themes.ts`; a preset whose accent differs from Graphite's, so the ring must change), use that
same target in 13c and 15b (15b compares against 13c's ring), and rename the `ctx.graphiteRing` / `"graphite"` names to
match. Keep every condition of both steps (`prevTheme !== target`, the one extra scenery draw, ring changed, nothing
unresolved, the away ring equal to the open one) and restore the previous theme as the steps do now.

Acceptance: `cockpit-office` passes steps 5b, 13c and 15b against a dev app of your tree
(`ARC_FINAL_OUT=<tmp dir> node scripts/cdp/final-verify.mjs cockpit-office surfaces-spring-office`), and no other step
of either scenario fails. Step 1 has failed now and then in earlier runs (the dialog read as `""`); if it fails for you,
report it with its detail, and fix it only if the cause is plain.
