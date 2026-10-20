# Pinned apps on the nav rail: fix round 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** keep the 1 s clock off the always-mounted nav rail. Run 85770eac's pins made `NavRail` read
`model.nowAtom` for the pin tooltips (`railItemTitle(s, now)`), so the whole rail re-renders every second, pins or
not, and redoes its badge work each time (`answeredAskIdsAcross` over every channel message). The codebase's rule is
that only leaves read the 1 s clock (`nowticker.tsx`; `agents.tsx` around `structuralNowAtom`).

**Spec:** `docs/superpowers/specs/2026-10-20-rail-apps-design.md` (unchanged)

### Task 1: The pin item reads the clock itself

**Depends on:** none
**Files:** `frontend/app/view/agents/navrail.tsx`

Today `NavRail` calls `useAtomValue(model.nowAtom)` and passes `now` to `renderApp`, which draws each pin's button.

- [ ] **Step 1:** Move `renderApp`'s button into a component in the same file, `RailAppItem`, taking what it needs as
  props: the `model` (for `nowAtom` and `surfaceAtom`), the service `s`, its index and the pin count (for Move up /
  Move down's `enabled`), `narrow`, and whether it is active (or `appId` to work it out). It reads
  `useAtomValue(model.nowAtom)` itself and computes `title={railItemTitle(s, now)}` there. The click (set
  `appSurfaceIdAtom`, then the surface to `app`) and the right-click menu (Unpin from the rail, Move up, Move down,
  through `setRailPinned` / `moveRailPin`) behave exactly as now.
- [ ] **Step 2:** Remove `const now = useAtomValue(model.nowAtom)` from `NavRail`. `NavRail` must not read
  `nowAtom` at all; `grep -n nowAtom frontend/app/view/agents/navrail.tsx` shows it only inside `RailAppItem`.
- [ ] **Step 3:** Keep the drawn DOM the same, byte for byte where it can be: the `button` with `key`,
  `data-nav-app`, `aria-label`, `title`, the classes, the accent fill and bar, the `data-nav-app-dot` span and the
  truncated label (hidden when `narrow`). The `services-rail` scenario reads all of these (steps 1, 5, 6, 8, 9, 10),
  and no scenario changes in this round.
- [ ] **Step 4:** Check: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (exit 0), and
  `npx vitest run frontend/app/view/agents/railapps.test.ts`. Check only the touched file with
  `npx prettier --check frontend/app/view/agents/navrail.tsx` and `npx eslint frontend/app/view/agents/navrail.tsx`
  (report a warning already on the base rather than fixing the file's other lines).
- [ ] **Step 5:** Commit `perf(rail): the pin item reads the 1s clock, not the whole nav rail`.

**Shown by:** `services-rail` steps 5 and 6 (each pin's `title` from the clock: `crashed`, then `sleeping`) and 9
(the narrow rail keeps `aria-label` and `title`); the final stage runs it.
