# Overlays in the Chat look: fix round 1

**Effort:** effort:7655bf18-619e-40cf-8805-5f4a6e5ac85e
**Spec:** `docs/superpowers/specs/2026-11-14-overlays-chat-look-design.md`

Round 1's Final passed 154 of 155 steps. The one failure is `palette-scope-indicator` step 1 ("Tab from All slides the
bar to Needs you; one bar, inside the pressed tab"):

```
{"sample":{"n":11,"mid":0,"first":{"t":239,"pressed":"needs","bar":{"left":360.1,"width":74.4},"target":{"left":360.5,"width":75}},
 "last":{"t":633,...}},"one":{"count":1,"inPressed":"true"}}
```

The sampler (`sampleIndicator`, `scripts/cdp/scenarios.mjs:29073`) dispatches the Tab and counts animation frames for
600 ms. Here the first frame came 239 ms after the Tab, and 11 frames in 600 ms is about 55 ms a frame, so by the first
frame the 360 ms front-loaded slide was already within 1 px of its target and no frame caught it mid-flight. Steps 2–6
of the same scenario passed, and Task 3 ran it 6/6 on the frosted palette (`final-verify.mjs overlays-frost-palette
palette-scope-indicator modal-focus-home`). So the slow frames show up in the Final's order, after the 15 scenarios that
run before it. Two explanations are open and this round decides between them: (a) the first Tab is a cold render, and
the slow frames come from state the earlier scenarios leave behind; (b) the palette's frost (18px backdrop blur on the
panel over the scrim's own blur, Task 3) makes each frame expensive enough to drop frames over a busy cockpit.

### Task 1: palette-scope-indicator step 1 passes in the Final's order
**Depends on:** none
**Model:** opus
**Files:** `scripts/cdp/scenarios.mjs`, `frontend/app/modals/modalshell.tsx`, `frontend/app/cockpit/command-palette.tsx`

In `scenarios.mjs`, edit only the palette-scope-indicator block (about lines 29065–29300). Touch the two `.tsx` files
only if (b) is the cause.

- Reproduce it on this branch: run the round's Final command (the plan's **Final** line in
  `docs/superpowers/plans/2026-11-14-overlays-chat-look.md`), or at least the scenarios before `palette-scope-indicator`
  in that order plus it. Then run `palette-scope-indicator` alone. Record step 1's `n`, `mid` and first-frame `t` for
  each run.
- Measure whether frost causes it: in the same Final-order dev app, sample step 1's frames with the palette panel
  forced solid (from the scenario, swap `frost` for `bg-modalbg` on the dialog panel before the Tab; no app flag) and
  with it frosted, 3 passes each. Report frame count and the first-frame delay for each.
- If the frosted passes drop clearly more frames than the solid ones, the frost is the cause and this is a real defect:
  fix it in the palette (for example, the scrim's own `backdrop-blur-sm` under a panel that already blurs 18px), keeping
  the spec's look (the panel frosted over today's scrim, `overlays-frost-palette` still 7/7). Do not change
  `palette-scope-indicator`'s assertions.
- Otherwise the cause is the cold first Tab or leftover state, not the overlays. Then fix the scenario: before step 1's
  sampled Tab, warm the palette (Tab to Needs you and Shift+Tab back to All, then `settleIndicator(h, "all")`), so the
  sampled Tab is the second render of that scope. Keep `slidOk`, `barMidFlight` and every threshold as they are: the step
  must still catch the bar mid-flight.
- Acceptance: the plan's full **Final** command exits 0 with every step passing, run once on the committed tree;
  `palette-scope-indicator` alone passes 6/6; if the palette changed, `overlays-frost-palette` 7/7 and `task check:ts`
  exit 0. The report states which of (a) or (b) the measurements showed, with their numbers.
- A dev-app boot rewrites `cmd/wsh/cmd/arc-theme.json` and `pi/themes/arc.json`: restore both
  (`git checkout -- cmd/wsh/cmd/arc-theme.json pi/themes/arc.json`) before committing, and commit by pathspec.
