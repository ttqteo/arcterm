# Jarvis as Sprout

**Spec:** `docs/superpowers/specs/2026-10-06-jarvis-sprout-pet-design.md` — the sprite grids, marks, walker states and the `window.__jarvisPet` contract (§4, "The DEV contract") are all there; it is the authority wherever this plan is shorter, and the two agree on every interface below.
**Verify:** `node scripts/verify.mjs ./pkg/baseds`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs jarvis-pet surface-smoke jarvis-peek`

Every task follows DESIGN.md: colours only through `--color-*` tokens, pure logic in a `.ts` with a `.test.ts`
beside it, no jsdom render tests. The frontend is the only thing that changes; no Go type changes, so no
`task generate`.

### Task 1: Sprout sprite data
**Depends on:** none

Create `frontend/app/view/jarvis/petsprite.ts`, pure (no React, no atoms), the only home of the creature's pixels.

Exports, which Task 2 and Task 4 rely on:
- `type PetPose = "walk1" | "walk2" | "stand" | "sit" | "sleep" | "tired" | "speak" | "dangle"`
- `type PetMark = "gate" | "escalation" | "blocked" | "z" | "drop" | "unread"`
- `PET_GRID = 16` (cells), `PET_CELL_PX = 3` and `PET_PX = 48`
- `POSES: Record<PetPose, readonly string[]>`, exactly the eight grids in spec §2 (rows of 16 cell codes, `.` empty)
- `MARKS: Record<PetMark, { x: number; y: number; rows: readonly string[] }>`, exactly the spec §2 mark table
- `PET_TOKENS`: the cell code → `--color-*` name table from spec §2
- `interface PetCell { x: number; y: number; token: string }` and
  `spriteFor(pose: PetPose, marks: readonly PetMark[]): { body: PetCell[]; overlay: PetCell[] }` (spec §4): `body`
  is every drawn cell of the pose, `overlay` every drawn cell of the marks, kept apart because the renderer mirrors
  only the body.

Tests, `petsprite.test.ts`: every pose is 16 rows of 16; every code used maps to a `--color-` token; `gate`,
`escalation` and `blocked` stamped on `stand`, `z` on `sleep`, `drop` on `tired` and `unread` on every pose never
land on a drawn body cell; `spriteFor` returns one body cell per non-`.` code and keeps marks out of `body`;
`MARKS` has exactly the six keys of the spec, and `spriteFor` takes nothing but a pose and mark names, so nothing
can draw a count (spec §5).
Run `npx vitest run frontend/app/view/jarvis/petsprite.test.ts`.

### Task 2: The walker model
**Depends on:** Task 1

Create `frontend/app/view/jarvis/petwalk.ts`, pure, implementing spec §3's state table: walk, rest, sleep, hold,
hop and dragged, with tired's slower pace, reduced motion and home.

Interface, which Task 4 relies on (spec §4):
- `type WalkerStateName = "walk" | "rest" | "sleep" | "hold" | "hop" | "dragged"`
- `interface WalkerInput { ledge: { left: number; right: number }; avoid: readonly [number, number][]; expression: PetExpression["kind"]; posture: PetPosture; speaking: boolean; peekOpen: boolean; dragging: boolean; reduce: boolean; lastActivityAt: number; home: number }`
  (`PetExpression`, `PetPosture` from `petcondition.ts`; `home` is the 0..1 fraction; `ledge` bounds the whole
  48 px span: `left <= x` and `x + 48 <= right`)
- `interface WalkerState { name: WalkerStateName; … }` and `initialWalker(input, now, rand): WalkerState`, which
  starts walking toward a clear target (or stands, under reduced motion)
- `stepWalker(state, input, now, rand: () => number): { state: WalkerState; pose: PetPose; marks: PetMark[]; x: number; flip: boolean; delayMs: number | null }`
  — `x` the sprite's left edge; `delayMs` one frame while walking or hopping (125 ms, 250 ms tired), the time left
  in the rest while resting, `null` while it holds, sleeps, is dragged or stands under reduced motion
- `homeX(fraction, ledge)`, `homeFraction(x, ledge)`, `clearSpot(target, ledge, avoid)` (the left edge nearest
  `target` whose span overlaps no avoid span, or `target` when none is clear) and `dropAt(pointerX, ledge)` (the
  left edge that centres the sprite on the pointer, clamped to the ledge)
- `nextTick(delayMs: number | null, hidden: boolean): number | null`: `null` while hidden, else `delayMs`

Every step reads `input.avoid` fresh (the renderer re-measures it each step), so a walk whose target has become
blocked retargets with `clearSpot` and keeps walking. Targets are 80–400 px away; rests last 5–15 s (twice that
when tired); sleep comes after 10 minutes since `lastActivityAt`, at a clear spot; the hop lifts the sprite 2 cells
for 2 frames on a posture's arrival only. Marks follow the posture (`review-gate` → `gate`, `escalation`,
`blocked-worker` → `blocked`), `tired` adds `drop` while resting, sleep adds `z`; `unread` is the renderer's.

Tests, `petwalk.test.ts`, with an injected `rand` and clock: x keeps the whole span inside the ledge and flips at
both ends; a target never lands in an avoid span, falls back to the clear spot nearest home, and is replaced when
its spot becomes blocked mid-walk; a posture, `speaking`, `peekOpen` and `dragging` each hold it with `delayMs`
null; a rest returns its remaining time as `delayMs` and walks again once that time passes; a posture's arrival hops
once and its standing does not; tired walks at half speed; 10 idle minutes put it to sleep at a clear spot and a
posture wakes it; `reduce` never walks and stands at the clear spot nearest home; `homeX(homeFraction(x, a), b)`
keeps the relative position across ledges of different widths; `dropAt` centres and clamps; `nextTick` is null
while hidden.
Run `npx vitest run frontend/app/view/jarvis/petwalk.test.ts`.

### Task 3: Ledge and avoid markers, and the home atom
**Depends on:** none

- Add `data-pet-ledge` to the bar root of `FooterBar` in `frontend/app/cockpit/hints-footer.tsx` (it covers both
  the rest and the leader posture) and to the root of `HintsBar` in `frontend/app/view/agents/cockpithelp.tsx`.
- Add `data-pet-avoid` to the root of `frontend/app/view/agents/composer-shell.tsx`.
- In `frontend/app/view/jarvis/petstore.ts` add `petHomeAtom` (a number in [0, 1], localStorage key
  `wave:pet.home`, default 0.9, seeded at module load the way the corner atom is; a missing, non-finite or
  out-of-range value reads as 0.9) and `setPetHome(fraction)`, which clamps and persists. Leave `petCornerAtom`
  and its helpers in place: `petview.tsx` still uses them until Task 4, and Task 6 deletes them.

Tests: extend `petstore.test.ts` with the home round-trip and the fallback for a corrupt, negative and >1 value.
Run `npx vitest run frontend/app/view/jarvis/petstore.test.ts`. The markers are proven in the running app by the
Final's `jarvis-pet` step 1, which measures the creature against the `[data-pet-ledge]` element on Agent (the hints
footer) and on Cockpit (its `HintsBar`, drawn once the scenario's fixture roster is ready).

### Task 4: Render Sprout in PetView
**Depends on:** Task 1, Task 2, Task 3

Rewrite `frontend/app/view/jarvis/petview.tsx` as spec §4 "Changed" describes:
- Replace both canvases, the GL and 2D render loop, the ripple and `__jarvisAvatarScene` with a fixed-position
  48×48 `<svg shape-rendering="crispEdges">`: the body cells as `<rect>`s in a group mirrored when `flip`, the
  overlay cells (and the `unread` mark when `petUnreadAtom` is set) outside it, every `fill` a `var(--color-…)`.
- One timeout loop calls `stepWalker` and schedules the next call with `nextTick(delayMs, document.hidden)`; a
  `null` stops it until an input changes (signals, bubble, peek, drag, `force`, resize, surface switch,
  `visibilitychange`).
- Measure the ledge: the lowest visible `[data-pet-ledge]` element's top, the left bound the nav rail's right edge
  (`navrail.tsx`'s `<nav>`), the right bound the window's right edge less 8 px, the window bottom when no ledge
  element is visible; re-measure on resize and on a surface switch (`model.surfaceAtom`). Measure the avoid spans
  (every `.xterm` and `[data-pet-avoid]` whose box comes within 80 px above the ledge) on every step. Put the rect
  arithmetic (lowest ledge, spans from rects) in a pure helper with tests, in `petwalk.ts` or a new `petledge.ts`.
- Drag: keep motion's drag; while dragging the walker is `dragged` (pose `dangle`); on release place it with
  `dropAt(pointerX, ledge)` and persist `setPetHome(homeFraction(...))`.
- Drop motion's `layout` prop and the 1.07 hover scale: hover changes opacity only (spec §3). Keep the quiet opacity
  values (0.4 quiet, 1 otherwise and on hover).
- Keep unchanged: the utterance effect (watermark, `rememberSaid`, bubble, unread), click toggling the peek,
  Enter/Space opening it, `role="button"`, `tabIndex={0}`, `aria-label="Jarvis condition"`, and `PetBubble`/`PetPeek`,
  whose `corner` prop is now derived from the creature's centre: `bottom-left` in the left half of the window, else
  `bottom-right`.
- `lastActivityAt` advances on an utterance, a posture change, a hover, a click and a drag.
- In DEV builds keep `window.__jarvisPet` current with exactly the fields of spec §4's DEV contract table, `force`
  included, folded out of production by `import.meta.env.DEV`.
- Stop importing `avatarscene`, `avatarthree`, `avatarcanvas`, `petmotion`, `petCornerAtom` and `markPetSpoke`;
  Task 6 deletes them.

Acceptance: the Final's `jarvis-pet` steps 1–9 (ledge, tokens and label, walking, resting off the terminal, every
forced state, drag and drop, unread, bubble and peek sides with a real click, reduced motion), and `surface-smoke`'s
notify step and `jarvis-peek` passing unchanged. Run the tests of the pure helper you add.

### Task 5: The jarvis-pet CDP scenario
**Depends on:** none

In `scripts/cdp/scenarios.mjs` replace the `jarvisAvatar` scenario (`name: "jarvis-avatar"`) with `jarvisPet`,
`name: "jarvis-pet"`, and swap it in the `SCENARIOS` list. Implement spec §5's CDP list exactly, steps 1–9, each its
own `rec(...)` with a screenshot `cdp-shots/jarvis-pet-<n>.png`:
- `arrange` sets up what the Final's empty store lacks: a fixture roster agent so the Cockpit roster is ready and
  its `HintsBar` renders (as `arrangeRailSections` writes `TREE_RAIL_FIXTURE`), and a terminal agent focused on the
  Agent surface so an `.xterm` sits above the ledge (as `openRailTerminal`/`openGridAgent` do); step 4 asserts an
  `.xterm` is present before it judges the rest spot.
- It reads `window.__jarvisPet` and calls its `force` exactly as spec §4's DEV contract table defines them.
- Step 3 waits for `state === "walk"` and samples every 100 ms for 1 s; step 4 polls up to 40 s for `rest`; the
  drag in step 6 and the click in step 8 are real `h.cdp("Input.dispatchMouseEvent", …)` events at the creature's
  box; step 7 sends `h.rpc("notify", …)` as `surface-smoke` does and waits out the bubble; step 9 uses
  `h.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] })` and
  resets it.
- `teardown` calls `force(null)`, resets the emulated media, removes what `arrange` created (as the scenarios whose
  helpers it borrows do), and returns to Cockpit.

The app this scenario checks exists only once Task 4 merges, so don't start a dev app to run it here: the Final
runs it. Check it parses with `node --check scripts/cdp/scenarios.mjs`.

### Task 6: Remove the hologram
**Depends on:** Task 4, Task 5

- Delete `avatarscene.ts`, `avatarthree.ts`, `avatarcanvas.ts` and their `.test.ts` files, and `petmotion.ts`
  with `petmotion.test.ts`, all under `frontend/app/view/jarvis/`.
- From `petstore.ts` remove `PET_CORNERS`, `petCornerAtom`, `setPetCorner`, the corner reader and the
  `wave:pet.corner` key, and `petSpokeAtAtom`/`markPetSpoke`, with any test of them. `PetCorner` stays only as the
  type of `petbubble.tsx`/`petpeek.tsx`'s `corner` prop: move it beside them if `petstore.ts` no longer needs it.
- Drop `three` and `@types/three` with `npm uninstall --package-lock-only three @types/three`. Lock-only on
  purpose: this worktree's `node_modules` is a junction into the main checkout, where a plain uninstall would delete
  the package while the main checkout's code still imports it.
- Update `docs/deferred.md`'s entry on the 3D creature (around "The 3D creature", which names `avatarcanvas.ts` and
  `avatarscene.ts`) to say the hologram was replaced by the Sprout pixel pet, citing the spec.
- Grep `frontend/`, `scripts/` and `docs/` (outside `docs/superpowers/specs`, which keep their history) for anything
  still naming the removed modules, atoms or `__jarvisAvatarScene`.

Acceptance: `task check:ts` is clean and `npx vitest run frontend/app/view/jarvis` passes.
