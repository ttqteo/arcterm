# Cockpit office in pixel art: fix round

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-10-15-cockpit-office-design.md`: read **Drawing** ("One grid") first.

**Goal:** the two places the run's final verifier found off the prototype: the `n` path's dots and their label are not
on the 3 px art grid, and the DEV-only Cast sheet's column labels drift off their sprites, with `side2`'s label lost
past the sheet's edge.

**Architecture:** frontend only. One component file and its CDP scenario; no model, no Go, no tokens.

---

### Task 1: The path's dots on the art grid, and the Cast sheet in the board's cells
**Depends on:** none
**Files:** `frontend/app/view/agents/cockpitoffice.tsx`, `scripts/cdp/cockpitofficescenarios.mjs`

The spec's **Drawing** says every place snaps to the art grid (`art(v) = Math.round(v / 3)`, 1 art px = `PLAN_CELL` =
3 CSS px). `Mover` and `BossView`'s ring already do (`cockpitoffice.tsx` around lines 1408 and 1460:
`Math.round((v - offset) / PLAN_CELL) * PLAN_CELL`). Two places do not:

- `PathDots` places each dot at `translate(${Math.round(p.x - 3)}px, ${Math.round(p.y - 3)}px)` and the
  `next Needs you` label at `left: end.x - 60, top: end.y + 8`: whole CSS px, not whole art px.
- `PoseSheet` puts a flex row of 60 px column labels over flex rows of sprites (42 or 60 px wide, `gap-2`), so from
  the second column on, each label sits off its sprite. The labels' row is wider than the sprites' row, so `side2`'s
  label falls past the sheet. The prototype's Cast board (`.superpowers/design/cockpit-office-pixel/prototype/
  boards.mjs` lines 209–283, `castSheet` and the block after it) lays the sheet out in fixed cells. The prototype
  wins on pixels.

- [ ] **Step 1: The dots and their label on the grid**

In `PathDots`, snap each dot the way `Mover` snaps:
`translate(${Math.round((p.x - 3) / PLAN_CELL) * PLAN_CELL}px, ${Math.round((p.y - 3) / PLAN_CELL) * PLAN_CELL}px)`.
Snap the label's box the same way: `left: Math.round((end.x - 60) / PLAN_CELL) * PLAN_CELL` and
`top: Math.round((end.y + 8) / PLAN_CELL) * PLAN_CELL`. Each dot keeps its size, shape, colour and `data-office-dot`.

- [ ] **Step 2: The Cast sheet in the board's cells**

Rewrite `PoseSheet`'s body to `castSheet`'s geometry, in CSS px (art px × `PLAN_CELL`):

- A cell is `CW` 22 × `CH` 30 art px, so 66 × 90 CSS px. The sprite area is 18 cells wide (1188 px) and 5 rows tall
  (450 px): the 4 looks in `SHEET_SHIRTS` order (claude, codex, pi, agy; check `plansprite.ts` around line 521),
  then the boss in `BOSS_POSES`.
- The sprite for pose `s` in column `c`, row `r` is absolutely placed at
  `left = (c * 22 + 4 + spriteLeft(s)) * PLAN_CELL` and `top = r * 90 + (30 - 3 - PLAN_SPRITES[s].length) * PLAN_CELL`,
  with `width = spriteWidth(s) * PLAN_CELL` and `height = spriteH(s)`. `spriteLeft` is -3 for the 20-wide
  raised-arm poses, as `ARM_PAD` is in `castSheet`. The images stay `img` elements inside `[data-office-sheet]`, with
  the same `src` and `[image-rendering:pixelated]`, so steps 13 and 13b count them as they do now.
- Column labels sit in a 16 px row above the sprites: each one `absolute`, `left = i * 66`, 66 px wide, centred, 10.5 px,
  `text-muted`, not mono. The text comes from `boards.mjs` `POSES`' second field, in `SHEET_POSES` order: `sit`, `nod`,
  `hand`, `hand, 2`, `cheer`, `cheer, 2`, `doze`, `yawn`, `stretch`, `sofa`, `near seat`, `cup`, `walk ↓`,
  `walk ↓ 2`, `walk ↑`, `walk ↑ 2`, `walk →`, `walk → 2`.
- The boss's labels sit in a 16 px row under the sprites, `margin-top` 4 px, placed the same way: `standing`,
  `at a desk`, `walk ↓`, `walk ↓ 2`, `walk ↑`, `walk ↑ 2`, `walk →`, `walk → 2`.
- Row labels go in a 110 px column left of the sprites, 12 px gap between them. Each one is `absolute`,
  `top = 16 + r * 90 + 52`, 11 px, `text-secondary`, `whitespace-nowrap`: `look 1 · claude`, `look 2 · codex`,
  `look 3 · pi`, `look 4 · agy`, `the boss · cap`.
- Keep the label strings as local constants beside `PoseSheet` (it is DEV-only). Keep the container's
  `data-office-sheet`, its `absolute left-2 top-2 z-[9]`, its border, its padding and its wood background by phase.
  Give each column label `data-office-sheet-col` and each boss label `data-office-sheet-boss`, for Step 3.

- [ ] **Step 3: The scenario checks both**

In `scripts/cdp/cockpitofficescenarios.mjs`:

- Step 5 (`n` shows the way): right after the `n` key, read every `[data-office-dot]`'s computed transform and the
  label's box (the `next Needs you` span; give it `data-office-dot-label` in Step 1 if nothing selects it). Add a
  record `5b. the path's dots and their label sit on the 3 px grid` that passes only when there is at least one dot,
  and every dot's translate x and y and the label's left and top, relative to the office root, are multiples of 3.
- Steps 13 and 13b: before `dev(h, { sheet: true })`, widen the viewport with
  `h.cdp("Emulation.setDeviceMetricsOverride", { width, height: 950, deviceScaleFactor: 1, mobile: false })`. Make
  `width` wide enough that the whole sheet (about 1,350 px with its row-label column and padding) fits inside the
  office's scroller with no horizontal scroll. Restore `{ width: 1600, height: 950, … }` after
  `dev(h, { sheet: false, afterHours: false })`. `verify.mjs` restores its viewport after each scenario, so a throw
  in between is covered. Add a record `13d. the Cast sheet in the board's cells` with four checks. First, the sheet's
  right edge is inside the viewport. Second, there are 18 column labels and 8 boss labels. Third, label `i`'s left
  edge is `i * 66` px from the sprite area's left. Fourth, the first-row sprite in column `c` has its left edge at
  `(c * 22 + 4 + spriteLeft) * 3`, within 1 px. Read `spriteLeft` from the image's width: 60 px wide means -3, else 0.
  Take `cockpit-office-states.png` and `cockpit-office-states-night.png` at the widened viewport, as now.

- [ ] **Step 4: Run it**

Typecheck with `task check:ts` (allow it 4 minutes). Then run the `cockpit-office` scenario in the browser app on its own
ports and store (`ARC_BROWSER_CDP_PORT`, `ARC_BROWSER_VITE_PORT`, `ARC_DEV_DATA_DIR` under `$TMPDIR`). Background only the
`node scripts/cdp/browser-app.mjs` command, with its `cd` on its own line, so `$!` is node's pid. Stop it by that pid, and
check that nothing listens on its two ports afterwards. Every step must pass, 5b and 13d included. Open
`cockpit-office-next-ask.png`, `cockpit-office-states.png` and `cockpit-office-states-night.png`, and compare the sheet with the
prototype's `Cast.dc.html` (`cast-a.png` and `cast-b.png` in the same folder). Check that the labels sit over their sprites,
that `side2`'s `walk → 2` shows, and that the boss's row has its eight labels.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/view/agents/cockpitoffice.tsx scripts/cdp/cockpitofficescenarios.mjs
git commit -m "fix(cockpit): the office's path dots on the art grid, and the Cast sheet in the board's cells"
```

No `CHANGELOG.md` line: the sheet is DEV-only, and a dot moving by at most 1 px is not something a user notices.
