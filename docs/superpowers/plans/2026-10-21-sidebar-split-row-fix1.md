# Sidebar split row — fix round 1

**Goal:** The `agent-grid` CDP scenario reaches a split cell through the split row, now that a cell's own tree row is
folded into it.

**Spec:** `docs/superpowers/specs/2026-10-21-sidebar-split-row-design.md`

**Verify:** `npx vitest run frontend/app/view/agents`

**Final:** `node scripts/cdp/final-verify.mjs tools-split`

### Task 1: agent-grid clicks a cell in the split row

**Depends on:** none

**Files:** `scripts/cdp/scenarios.mjs`

Since the split row landed, an agent that is a cell of a split of 2+ cells has no `[data-agent-row]` in the tree; it is
a `[data-split-cell="<id>"]` inside its project's `[data-split-row]` (`agenttree.tsx` `SplitCell`, whose click focuses
the cell). The `agent-grid` scenario (`scenarios.mjs`, `name: "agent-grid"`) still clicks a cell's old row:

- Step 8b (~line 31111) runs `click(gridRow(D))` while the grid is `[D, B, A]`, so D's row is gone, the click finds
  nothing, the focus stays on B, and the step fails.
- The comment over `gridRow` (~line 30686) says "an agent the grid shows keeps its row in its folder, marked as in the
  split", which is no longer true.

Steps:

1. Add `const gridCell = (id) => \`[data-split-cell="${id}"]\`;` beside `gridRow`, and fix the comment over them: a row
   while the agent has no cell in a split, its cell in the split row while it has one.
2. Step 8b clicks `gridCell(D)`, and its label says it clicks D's cell in the split row. Record the click's return in the
   step's detail, so a missing cell reads as such.
3. Read the rest of `agent-grid` (steps 1 to the last) and change any other click or drag whose source is the row of an
   agent that has a cell in a split of 2+ cells at that moment to `gridCell`. A one-cell grid is no split: its agent
   keeps its row (step 1's `gridRow(A)` stays). Rows dragged in while their agent has no cell (steps 2, 3, 4, 6) stay.
4. `node --check scripts/cdp/scenarios.mjs`.
5. Run the scenario through Final's harness, narrowed to it: `node scripts/cdp/final-verify.mjs agent-grid` (it starts
   and stops its own dev app). Every step passes; if one unrelated to the tree fails, report it under Found not fixed
   with its detail rather than changing it. Do not run `task verify:ui`.
6. Commit `scripts/cdp/scenarios.mjs` with a pathspec.

**Acceptance:** `agent-grid` passes in full, step 8b focusing D through its split cell.
