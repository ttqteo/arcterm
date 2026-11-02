# Council report under a cover: fix round 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement your task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three defects the final stage found on the merged result of `2026-11-02-council-report-cover.md`. On a narrow pane the Discussion's title must truncate rather than vanish. An idea card's chevron must stay at its footer's right. Two report screenshots must show what their steps check.

**Spec:** the parent plan (`docs/superpowers/plans/2026-11-02-council-report-cover.md`) and its two boards. Its Global Constraints apply: token colours only; every existing `data-council-*` hook keeps its name and element. Tasks 1 and 2 share no file.

---

### Task 1: The Discussion's title keeps a floor on a narrow pane

**Depends on:** none
**Files:** frontend/app/view/agents/councildiscussion.tsx, frontend/app/view/agents/counciltabs.tsx, scripts/cdp/council/discussion.mjs

**The defect:**
- **Measured:** in `cdp-shots/council-discussion-header-narrow.png` (a 1000px window, a 674px pane), the h1 `[data-council-title]` is 2px wide, with no letters and no ellipsis. The row's parts measure: tabs 248, title 2, status chip 21, seats 44, cost 189, Summarize 31, Stop 50.
- **Why:** the h1 (`min-w-0 flex-[0_1_auto]`) has no floor and shrinks at the same rate as the seat strip.
- **Why the check missed it:** the step's `truncated` check (`scrollWidth > clientWidth`) also passes on a 2px box.

- [ ] **Step 1: Give the title a floor.** Add `min-w-[72px]` to the h1 in `Header` (`councildiscussion.tsx`). Keep `truncate` and `title={c.feature}`.
- [ ] **Step 2: Free the room the floor needs.** The room comes from the other parts, never from the cost or Stop, which must stay inside the pane. Apply these in order, and stop as soon as the 674px pane fits:
  1. Below 900px of the header container, the Discussion tab's count pill leaves the eye but stays readable: `@max-[900px]:sr-only` on the pill in `counciltabs.tsx`. The Summary's tab bar sits in no `@container`, so its pill stays.
  2. The tablist's `gap-5` tightens to `gap-3` below 900px. The header passes this through `CouncilTabs`' `className`.
  3. Below 900px the cost shows only its first part (the clock, or the replies when the council has not started), with the whole `headerCost` line in its `title`.

  The seat strip keeps its 44px minimum. The status chip may stay a dot.
- [ ] **Step 3: Make the narrow step catch a vanished title.** In `discussion.mjs`:
  - `headerRow` also returns `titleW: Math.round(title.clientWidth)`.
  - The narrow header check also requires `narrow.titleW >= 60`, and its label says the title keeps at least 60px.
  - The wide check is unchanged.
- [ ] **Step 4: Run it.** Run `node scripts/cdp/final-verify.mjs council-discussion` until every check passes. Open `cdp-shots/council-discussion-header-narrow.png` and `council-discussion-header.png`:
  - The narrow shot shows the title's first letters ending in an ellipsis, with the cost and Stop inside the pane.
  - The wide shot is unchanged from before.
- [ ] **Step 5: Commit.**

### Task 2: The card's chevron stays at the footer's right; two report shots frame what they check

**Depends on:** none
**Files:** frontend/app/view/agents/councilsummary.tsx, scripts/cdp/council/summary.mjs

**The defects:**
- **The chevron:** in `cdp-shots/council-summary-outline.png`, card 1's ChevronDown wraps onto its own line under the chips, at the bottom-left. The board draws it at the footer's right.
  - **Why:** in `DirectionCard`'s footer, the `flex-1` spacer and the chevron are items of the same `flex-wrap` row, so the chevron wraps alone.
- **The open-card shot:** `council-summary-open-card.png` is taken at scrollTop 0. Card 1's detail under the grid is out of frame, so no shot shows an open card in grey with its detail beneath it.
- **The Brainstorm shot:** `council-summary-brainstorm.png` cuts off at the card titles, so no First step box is in frame.

- [ ] **Step 1: Restructure the card footer.** In `DirectionCard`, the footer becomes a non-wrapping row: `mt-auto flex w-full items-end gap-2`. It holds two children:
  1. A `min-w-0 flex-1 flex-wrap items-center gap-x-[7px] gap-y-[6px]` span holding the meta and the chips.
  2. The chevron as a `flex-none` sibling, carrying a new `data-council-direction-chevron` hook.

  Drop the `flex-1` spacer.
- [ ] **Step 2: Check the chevron's place.** In the step that takes `council-summary-outline.png`, add a check over every `[data-council-direction]` card:
  - the chevron's right edge sits within 2px of the right edge of the card's content box (the card's rect less its right padding);
  - its bottom edge sits within 2px of the footer's bottom edge.
- [ ] **Step 3: Frame the open-card shot.** Before `h.shot("cdp-shots/council-summary-open-card.png")`, scroll `[data-council-scroll]` so the open card 1 and the top of `[data-council-direction-detail="1"]` are both in frame:
  - Start with card 1's row just under the sticky tab bar.
  - If the detail's top is still below the box, scroll the detail into view instead (`block: "center"`).

  Record a check that the detail's top lies inside the box's visible rect, below the tab bar. If a later step relies on the old scroll position, restore it after the shot.
- [ ] **Step 4: Frame the Brainstorm shot.** Before `h.shot("cdp-shots/council-summary-brainstorm.png")`, scroll `[data-council-directions-heading]` to just under the sticky tab bar. Record a check that at least one `[data-council-first-step]` lies inside the box's visible rect.
- [ ] **Step 5: Run it.** Run `node scripts/cdp/final-verify.mjs council-summary` until every check passes. Open the outline, open-card and Brainstorm shots and compare each with the report board (`M-report-cover.dc.html`):
  - every chevron sits at its card's footer right;
  - card 1 shows open, in grey, with its detail directly beneath the grid;
  - the Brainstorm cards show their First step boxes.
- [ ] **Step 6: Commit.**
