# Kael sync 11-25 (1 of 3): final stage round 1 fixes

**Spec:** `docs/superpowers/specs/2026-11-25-kael-sync-fast-track-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/orchestrate ./pkg/jarvis ./pkg/waveobj ./pkg/wshrpc/... ./cmd/wsh/cmd ./claude/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs kael1125-fast-track-label kael1125-fast-track-views model-picks plan-review-rounds kael1113-final-stage`

Round 1 of the final stage passed 34 of 36 steps. Both failing steps are defects in the scenario's reading, not in the
product: the screenshots show what the step asks for. The outputs are under
`C:/Users/me/AppData/Local/dev.arc.app/data/final-shots/45c32d52-ae31-4ff0-b85d-7373c460f7a2/1/` (`shots.json`,
`cdp-shots/`). Change no product code. Never run prettier on `scripts/*.mjs` (hand-formatted 4-space files). This
agent runs no CDP (`ARC_RUN_AGENT`): the run's Final is the live pass. Commits carry no attribution trailer.

### Task 1: Two scenario readings that fail on a correct view
**Depends on:** none
**Files:** `scripts/cdp/scenarios-kael1125-label.mjs`, `scripts/cdp/scenarios.mjs`

- `kael1125-fast-track-label` step 1 failed only on `bordered: false`. The chip, as Final drew it in
  `cdp-shots/kael1125-fast-track-label-1-sheet.png`, has a visible 1px border (`border border-accent/40`,
  briefrunsheet.tsx ~L492). The reading `getComputedStyle(chip).borderTopWidth === "1px"`
  (scenarios-kael1125-label.mjs ~L64) is too strict: Chrome snaps a computed border width to whole device pixels, so
  at a fractional device scale a 1px border reads as, for example, `0.8px`. Read it as `scenarios-chat-judge.mjs`
  (~L123, ~L617) does: `bordered` is true when `borderTopStyle === "solid"` and `parseFloat(borderTopWidth)` is
  `> 0.5` and `<= 1`. Also add `borderWidth: cs.borderTopWidth` to the returned object so that a later failure shows
  the width it read. Leave step 1's condition (`read.bordered === true`) as it is.
- `plan-review-rounds` step 4 failed with "no plan-reviewer rows in the tree". Its tree
  (`cdp-shots/plan-review-rounds-4-tree.png`) shows the run's stage fold reading `2 reviews · 1 failed`. The scenario
  unfolds only a row matching `/\d+ reviews?$/` (scenarios.mjs `planReviewTreeRows`, ~L32610), but since `6ee45c45f`
  (2026-10-14) the fold's label (agenttree.tsx ~L4152, the `done` FoldRow) can end in ` · N failed`. The fold was
  never clicked, so no reviewer row showed. This step already failed on `main`, outside this goal; fix it here because
  it holds the land. Match the count word anywhere in the label: `/\b\d+ reviews?\b/` (written `\\b` and `\\d` inside
  the template string, as the existing pattern is). Change nothing else in the scenario.
- Acceptance: `node --check scripts/cdp/scenarios-kael1125-label.mjs` and `node --check scripts/cdp/scenarios.mjs`
  pass. A node one-liner that runs the new fold regex shows it matches `2 reviews · 1 failed`, `1 review` and
  `3 done · 2 reviews` and does not match `5 queued`. Final's `kael1125-fast-track-label` step 1 and
  `plan-review-rounds` step 4 pass.
