# Rail context breakdown — fix round 1: `agent-tree-rail` green

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:systematic-debugging for each failing step before changing code.

**Goal:** The run's Final (`rail-context-breakdown agent-tree-rail`) passes. `rail-context-breakdown` already passes
10/10; `agent-tree-rail` fails steps 7, 13 and 14, and fails them the same on the base commit `cb67d0370` (run
b8ee0109's Task 4 checked it there), so the cause is in the Agent tree, not in the rail's Context part.

**Spec:** `docs/superpowers/specs/2026-09-29-agent-tree-rail-polish-design.md` (what `agent-tree-rail` pins) and
`DESIGN.md`. The context-breakdown spec is not touched.

**Verify:** `node scripts/verify.mjs ./pkg/ctxbreakdown/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs rail-context-breakdown agent-tree-rail`

---

### Task 1: Make `agent-tree-rail` steps 7, 13 and 14 pass

**Depends on:** none

Files: `frontend/app/view/agents/agenttree.tsx` (and the pure model beside it if the fix belongs there),
`scripts/cdp/scenarios.mjs` (the `agent-tree-rail` scenario, ~line 15733). Do not touch the `rail-context-breakdown`
scenario, `sessionsection.tsx` or `agentdetailsrail.tsx`.

What the round-1 Final saw (fixture: the scenario's own arrange, a real run with t-1 dispatched):

- **Step 7** `{"progress":{"text":"Working · 0/3","clipped":true}, "workersChip":"1worker", "strip":"0 of 3 tasks done; …"}`:
  the lead's progress text is cut. Likely cause to check first: the lead row now shows the whole run's RAM
  (`useRunRam`, `agenttree.tsx` ~1206, commits `8fa946dac` / `fee85f1bd`) on the run line's `trailing`, taking the
  width the progress needs. `RunSubline`'s `@container` already drops the chip's word on a narrow line so the progress
  is not cut; that intent stands.
- **Step 13** `{"newAgent":true,"groups":2,"folders":2,"plain":0,"twoLines":true,"tallest":0}`: no row in
  `[data-agent-active-rows]` matches the step's "plain agent row" filter (a `.cursor-pointer` non-button with a
  `span.rounded-full`, no Workflow mark, no guide, not `pl-[28px]`), so `plain > 0` fails. Find out which part of the
  filter no longer matches a plain agent row (the fixture has plain agents) and why.
- **Step 14** `{"before":10,"after":10,"back":10}`: clicking the first expanded `[data-agent-folder-section="active"]`
  leaves the Active rows count unchanged. Either the click no longer folds the project (a defect), or folding keeps the
  rows in the DOM / the counted rows are not the project's (a stale selector).

Steps:

1. Reproduce: `node scripts/cdp/final-verify.mjs agent-tree-rail` (its own dev app; do not use the person's running
   arcterm). Read each failing step's detail and the screenshot in `cdp-shots/`.
2. For each of the three steps, decide **UI defect or stale assertion**, with evidence: `git log -S` / `git log -L` on
   the selector or the markup, the commit that changed it, and what that commit meant.
   - **A UI defect:** fix the UI and keep the assertion. This is the default for step 7. The run line's progress
     text must read whole at the rail's default tree width. When the RAM figure and the progress do not both fit, the
     RAM yields: it is dropped, or wrapped off the line, below a container width, as the chip's word already is. The
     progress is never truncated in favour of it. Keep the RAM where it fits. For step 14, a project row that no
     longer folds its agents is a defect.
   - **A stale assertion against an intended change:** update the step's selector or bound, and leave a comment above
     it naming the commit and why. Follow the existing ones at steps 3 and 13 (`db9d60a1`). Never loosen a step so
     that it passes on a broken UI. Step 13 must still find at least one plain agent row and bound it at two lines,
     and step 14 must still see the row count drop on fold and come back on unfold.
3. Re-run `node scripts/cdp/final-verify.mjs rail-context-breakdown agent-tree-rail` until it ends 25/25. Look at the
   step 7 and step 13 screenshots, not just the PASS lines: the progress reads whole and a plain row has two lines.
4. If `agenttree.tsx` logic changed in a pure helper, add a vitest case beside it. Run `task check:ts`.
5. If a user would notice the change (the run line drops its RAM figure when narrow), add one `Fixed` line under
   `CHANGELOG.md`'s top `Unreleased` section.

Report, for each step, defect or stale, the commit that caused it, and what you changed.
