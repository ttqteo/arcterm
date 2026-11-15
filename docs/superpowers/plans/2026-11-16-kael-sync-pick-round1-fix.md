# Kael sync pick, round 1 fix: agent-tree-rail steps 8, 9 and 12

**Spec:** `docs/superpowers/specs/2026-11-13-kael-sync-engine-hardening-overview-design.md`
**Verify:** `node scripts/verify.mjs ./cmd/wsh/... ./cmd/server/... ./pkg/baseds/... ./pkg/wavevault/... ./pkg/effortstore/... ./pkg/notestore/... ./pkg/agentsync/... ./pkg/agentobserve/... ./pkg/agentsessions/... ./pkg/blockcontroller/... ./pkg/consult/... ./pkg/gitinfo/... ./pkg/usagestats/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs surface-smoke agent-tree-rail agent-streams-offsurface kael1113-pick`

**Goal:** The final stage on the merged result failed three steps of `agent-tree-rail` (in `scripts/cdp/scenarios.mjs`,
around lines 15733-15904). Every other step of the four scenarios passed. Make these three pass without weakening what
they check. All three look stale against the base, not broken by this run's ports, but any failing step holds the land.

### Task 1: agent-tree-rail steps 8, 9 and 12 pass on the merged result
**Depends on:** none
**Files:** `scripts/cdp/scenarios.mjs`, `frontend/app/view/agents/agenttree.tsx`

Edit `agenttree.tsx` only for a `data-` hook (step 2a) or if step 2 finds the tree no longer draws a nested row's
guide (step 2b).

Final's output for the failing steps:

```
FAIL  8. t-1's worker row sits under the lead with one guide line
      {"worker":true,"workerGuides":0,"sub":true,"subGuides":0, ...}
FAIL  9. the lead's working subagent is listed under it with one guide line
      (same detail)
FAIL  12. with no preset picked the cockpit is Claude
      {"preset":null,"bg":"#111111"}
```

1. **Step 12 is stale.** `ca4ee1207` ("feat(theme): Graphite and Google Sans Flex are the defaults", on the base) made
   `DEFAULT_THEME_PRESET` graphite, and `frontend/tailwindsetup.css` paints Graphite's `--color-background` `#111111`.
   The step still expects Claude (`#1f1e1d`) when no preset is stored. Rewrite it to "with no preset picked the cockpit is
   Graphite". It runs when the stored preset is null or `'"graphite"'` and expects Graphite's `bg` from
   `frontend/app/view/agents/themes.ts`. Keep the skip for any other stored preset. Graphite is the product's intended
   default, so the scenario changes, not the theme.
2. **Steps 8 and 9 find the rows but count 0 guides.** The step takes the name leaf, then `closest(".relative")` as the
   row, and counts the row's direct `SPAN` children whose computed width is `1px`. `agenttree.tsx` still renders
   `<Guides depth={…}/>` (absolute `w-px` spans) on nested rows (around lines 1494, 1610, 1858, 1988, 2052 and 2091).
   The subagent row (step 9) is not something this run touched, so the cause is likely on the base. First find which of
   these it is, in the running dev app (`task verify:ui -- agent-tree-rail` against a dev app, or a quick CDP
   `Runtime.evaluate` of the row's DOM):
   - (a) The nearest `.relative` above the name is no longer the row div that holds the guides, because a wrapper between
     them gained `relative`, or the guides moved into a child. Then fix the step's lookup so it reaches the row that holds
     `<Guides>`. Mark the row in `agenttree.tsx` with a `data-` attribute if no stable hook exists. It must still count
     exactly one guide on each nested row.
   - (b) The tree no longer draws the guide on these rows. Then restore it in `agenttree.tsx`, since the guide is the
     tree's design. A nested row keeps one guide per level, as the `Guides` comment says.
   Say which it was, and the commit that caused it, in the commit body.
3. Run `task verify:ui -- agent-tree-rail` (or `ARC_FINAL_OUT=<dir> node scripts/cdp/final-verify.mjs agent-tree-rail`)
   and have every step pass. Add no skip and loosen no other step's check.
4. One commit. The body names the cause of each failure. Never run prettier on `scripts/*.mjs`. Edit the file with the
   Edit tool.
