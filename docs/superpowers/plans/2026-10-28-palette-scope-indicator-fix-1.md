# Palette scope indicator: final round 1 fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `palette-scope-indicator` steps 5 (no slide on reopen) and 6 (reduced motion snaps) pass in Final.

**Architecture:** Step 5 is a product defect in the open path, fixed in `palette-chrome.tsx` and `command-palette.tsx`. Step 6 is a race in the scenario, fixed in `scenarios.mjs`. The two fixes touch different files and run in parallel.

**Tech Stack:** React 19, motion 12.40 (`motion/react`), CDP scenarios.

**Spec:** C:\Users\kael02\AppData\Local\arc-wt\9cfc58fd\docs\superpowers\specs\2026-10-28-palette-scope-indicator-design.md

## Global Constraints

- Opening the palette shows the bar already under its scope, with no slide, even when that scope differs from the last open (Code opens on Files). Only a change while the palette is open animates.
- Reduced motion: the existing `MotionConfig reducedMotion="user"` covers the layout animation, so the bar snaps.
- Never loosen a scenario step's pass rule to make it pass.

## Diagnosis (from the Final output and the installed motion source)

- **Step 5:** the samples show the first frame with `pressed: "runs"` and the bar under Runs. Later frames show `pressed: "files"` with the bar sliding from 621px toward Files at 902px. Two causes, both confirmed.
  - (a) `LayoutGroup` (`node_modules/framer-motion/dist/es/components/LayoutGroup/index.mjs`) computes its context id once, inside `if (context.current === null)`. A later change to the `id` prop is ignored, so bumping `openGen` never gives the bar a fresh layoutId. The re-render that applies the open's nav then reuses the stale render's layoutId, and the bar slides.
  - (b) The open reset in `CommandPalette` is a passive `useEffect`, so one frame with the previous open's nav (Runs) paints before the reset.
- **Step 6:** the scenario calls `Emulation.setEmulatedMedia` and presses Tab at once. motion's `prefersReducedMotion.current` (`motion-dom/.../render/utils/reduced-motion/index.mjs`) changes only in a MediaQueryList `change` listener, and the browser dispatches that event during its next rendering update. So the new bar mounts while the value is still `false`, and slides. The jarvis activity scenario (`scenarios.mjs`, the comment above `JARVIS_ACTIVITY_ASK`) hit the same stale read.

## Review Focus

1. A first-ever open after page load (`openGen` 0 → 1) draws in place, like any later open.
2. Two opens in a row on the same scope do not slide, even though the bar sits in the same place both times.
3. Esc then reopen on the Agent or Jarvis surface lands on All, with no slide.

---

### Task 1: Reopen draws the bar in place from the first painted frame

**Depends on:** none

**Files:** `frontend/app/cockpit/palette-chrome.tsx`, `frontend/app/cockpit/command-palette.tsx`

Where: `PaletteScopeTabs` and its `<LayoutGroup>` (~line 135); `CommandPalette`'s open effect (~line 172) and the `react` import (line 25).

**Interfaces:**
- Consumes: `openGen: number`, bumped once per open (unchanged).
- Produces: the same DOM contract as before. Exactly one `span[data-palette-scope-indicator]`, inside the `aria-pressed="true"` `[data-palette-scope]` button.

- [ ] **Step 1:** In `PaletteScopeTabs`, add `key={openGen}` to the `LayoutGroup`, so each open remounts the group and its id is read again. Keep the `id`. Correct the `openGen` prop comment (line ~126): it should say the key remounts the group, because `LayoutGroup` reads its id only once, when it mounts.
- [ ] **Step 2:** In `CommandPalette`, change the open effect ("Each open starts fresh on the surface's own scope…") from `useEffect` to `useLayoutEffect`, so the reset nav and the new `openGen` commit before the first paint of an open. Keep the body and the rAF focus. Update the comment to say why it runs before paint.
- [ ] **Step 3:** Run the Check: `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit` (allow over 2 minutes). Expected: exit 0.
- [ ] **Step 4:** Run `node scripts/cdp/final-verify.mjs palette-scope-indicator palette-actions`. Expected: step 5 PASS with `offFrames: []`, and steps 1-4 and palette-actions still PASS. Step 6 may still fail in this tree, because Task 2 fixes it. If step 5 still fails, report the `offFrames` detail and do not change the scenario.

### Task 2: Step 6 waits for the reduced-motion change to reach motion

**Depends on:** none

**Files:** `scripts/cdp/scenarios.mjs`

Where: the `palette-scope-indicator` scenario, step 6 (~line 18179).

**Interfaces:**
- Consumes: the DOM contract above. `h.ev` awaits a promise.

- [ ] **Step 1:** Between the `Emulation.setEmulatedMedia` call and `sampleIndicator`, wait in the page until `matchMedia("(prefers-reduced-motion)").matches` is true and two animation frames have passed. Do this as one `h.ev` promise, so the `change` event (dispatched in the rendering update) has reached motion before Tab is pressed. Add a one-line comment above it saying why: motion updates its reduced-motion value only from that event, which fires on the next frame. Keep step 6's pass rule and the teardown reset as they are.
- [ ] **Step 2:** Run `node --check scripts/cdp/scenarios.mjs`. Expected: exit 0.
- [ ] **Step 3:** Run `node scripts/cdp/final-verify.mjs palette-scope-indicator`. Expected: step 6 PASS, with `firstNew` matching Commands and no frame in flight. Step 5 may fail in this tree until Task 1 lands.
  - If step 6 still slides after the wait, do not loosen the step. Read `matchMedia("(prefers-reduced-motion)").matches` in the page and report it. The fallback, decided now: reload the page under the emulation before step 6, as the jarvis activity scenario does. Reopen the palette on the Code surface (Files), press Tab to Commands, then keep step 6's assertions. Say in the report which of the two fixed it.
