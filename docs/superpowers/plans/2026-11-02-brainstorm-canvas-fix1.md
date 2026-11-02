# Brainstorm rail: fix round 1

Fixes the one defect the final stage found on the merged rail: the builder check's row stacks at the design's 640px
cutoff while its rail stacks at 820px, so in a check pane 640–819px wide the rail goes full width beside the question and
squeezes the question column to nothing.

**Spec:** `D:\work\arcterm\docs\superpowers\specs\2026-11-02-brainstorm-canvas-design.md` ("Pane too narrow for both": 820px in the check)
**Verify:** `node scripts/verify.mjs ./pkg/wshrpc`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs canvas-tabs brainstorm-mode brainstorm-builder-ask`
**Prototype:** D:\work\arcterm\.superpowers\design\brainstorm-canvas\project\Rail.dc.html

### Task 1: The check's row stacks at the check's cutoff
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/brainstormcheck.tsx`, `scripts/cdp/scenarios-brainstorm-builder.mjs`

The defect: `frontend/app/view/agents/brainstormcheck.tsx:112` renders `<RailRow question=… rail=…>` with no
`minWidth`, so `RailRow` (`brainstormrail.tsx:681`) picks `ROW_STACKED.design` and stacks only under 640px. The
`BrainstormRail` inside it gets `minWidth={RAIL_MIN_W_CHECK}` (line 154) and applies `STACKED.check` under 820px
(`w-full`, handle hidden). Between 640 and 819px the row stays side by side while the rail is full width, and the
question column (`flex-1 min-w-0`) shrinks to 0, hiding the builder's question, the talk question and the review.

- Pass `minWidth={RAIL_MIN_W_CHECK}` to `RailRow` in `brainstormcheck.tsx` (`RAIL_MIN_W_CHECK` is already imported
  there). Change nothing in `brainstormrail.tsx`.
- Add a step to the `brainstorm-builder-ask` scenario in `scripts/cdp/scenarios-brainstorm-builder.mjs`, after step 3a
  (~line 628), named `3a2. check rail stacks when narrow` (3b is taken). With the same row open as 3a, narrow the window with
  `Emulation.setDeviceMetricsOverride` until the check pane is between 640 and 819px wide (aim for ~720px; read the
  pane's width and adjust, as the talk's step `3c. rail stacks when narrow` does with `BS_NARROW_WINDOW_W` in
  `scripts/cdp/scenarios.mjs` ~29458 and ~30539). Assert:
  - the pane width is in [640, 820);
  - the rail (`data-brainstorm-board-rail`) sits under the question column (its top is at or below the question
    column's bottom) and is the pane's full width (within a few px);
  - the question column is at least 300px tall or holds the builder's question text, so it is not squeezed away;
  - no `data-brainstorm-rail-handle` is shown.
  Take a screenshot `cdp-shots/brainstorm-builder-ask-3a2-narrow.png`. Restore the window size the scenario had before
  (and in teardown too, so a failed assert does not leave the next step narrow). Keep the file's hand-formatted 4-space
  style: never run prettier on `scripts/*.mjs`.

**Acceptance:** `task check:ts` is clean; `node scripts/cdp/final-verify.mjs brainstorm-builder-ask` passes with the new
step, and its 3a2 screenshot shows the question on top and the rail full width under it.
