# Jarvis as Sprout

**Spec:** `docs/superpowers/specs/2026-10-06-jarvis-sprout-pet-design.md` — the sprite grids, marks, walker states and the `window.__jarvisPet` contract are all there; it is the authority wherever this plan is shorter.
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
- `PET_GRID = 16` (cells) and `PET_CELL_PX = 3`
- `POSES: Record<PetPose, readonly string[]>`, exactly the eight grids in spec §2 (rows of 16 cell codes, `.` empty)
- `MARKS: Record<PetMark, { x: number; y: number; rows: readonly string[] }>`, exactly the spec §2 mark table
- `PET_TOKENS`: the cell code → `--color-*` name table from spec §2
- `interface PetCell { x: number; y: number; token: string }` and
  `spriteFor(pose: PetPose, marks: readonly PetMark[]): { body: PetCell[]; overlay: PetCell[] }`: `body` is every
  drawn cell of the pose, `overlay` every drawn cell of the marks, kept apart because the renderer mirrors only the
  body (spec §2: marks never read backwards).

Tests, `petsprite.test.ts`: every pose is 16 rows of 16; every code used maps to a `--color-` token; `gate`,
`escalation` and `blocked` stamped on `stand`, `z` on `sleep`, `drop` on `tired` and `unread` on every pose never
land on a drawn body cell; `spriteFor` returns one body cell per non-`.` code and keeps marks out of `body`.
Run `npx vitest run frontend/app/view/jarvis/petsprite.test.ts`.

### Task 2: The walker model
**Depends on:** Task 1

Create `frontend/app/view/jarvis/petwalk.ts`, pure, implementing spec §3's state table: walk, rest, sleep, hold,
hop and dragged, with tired's slower pace, reduced motion and home.

Interface, which Task 4 relies on:
- `type WalkerStateName = "walk" | "rest" | "sleep" | "hold" | "hop" | "dragged"`
- `interface WalkerInput { ledge: { left: number; right: number }; avoid: readonly [number, number][]; expression: PetExpression["kind"]; posture: PetPosture; speaking: boolean; peekOpen: boolean; dragging: boolean; reduce: boolean; lastActivityAt: number; home: number }`
  (`PetExpression`, `PetPosture` from `petcondition.ts`; `home` is the 0..1 fraction)
- `interface WalkerState` (opaque to callers beyond `name`) and `initialWalker(input, now): WalkerState`
- `stepWalker(state, input, now, rand: () => number): { state: WalkerState; pose: PetPose; marks: PetMark[]; x: number; flip: boolean; delayMs: number | null }`
  where `x` is the sprite's left edge and `delayMs` is the wait before the next step, `null` when nothing moves
- `homeX(fraction, ledge)` and `homeFraction(x, ledge)`, and `restSpot(ledge, avoid, home, rand)` returning a left
  edge whose 48 px span overlaps no avoid span, or home when none is clear
- `dropAt(x, ledge)`: the left edge a release at x lands on, clamped to the ledge

Constants from the spec: 8 fps and one 3 px cell per frame when walking (4 fps when tired), legs of 80–400 px,
rests of 5–15 s (twice that when tired), sleep after 10 minutes since `lastActivityAt`, a hop of 2 frames lifted
2 cells. The marks follow the posture (`review-gate` → `gate`, `escalation`, `blocked-worker` → `blocked`),
`tired` adds `drop` while resting, sleep adds `z`; `unread` is the renderer's, not the walker's.

Tests, `petwalk.test.ts`, with an injected `rand` and clock: x never leaves the ledge and flips at both ends;
`restSpot` avoids every span and falls back to home when all are blocked; a posture, `speaking`, `peekOpen` and
`dragging` each hold it (`delayMs` null, no x change); a posture's arrival hops once and its standing does not;
tired walks at half speed; 10 idle minutes put it to sleep at a clear spot and a posture wakes it; `reduce` never
moves it off home; `homeX(homeFraction(x, a), b)` keeps the relative position across ledges of different widths.
Run `npx vitest run frontend/app/view/jarvis/petwalk.test.ts`.

### Task 3: Ledge and avoid markers, and the home atom
**Depends on:** none

- Add `data-pet-ledge` to the bar root of `FooterBar` in `frontend/app/cockpit/hints-footer.tsx` (it covers both
  the rest and the leader posture) and to the root of `HintsBar` in `frontend/app/view/agents/cockpithelp.tsx`.
- Add `data-pet-avoid` to the root of `frontend/app/view/agents/composer-shell.tsx`.
- In `frontend/app/view/jarvis/petstore.ts` add `petHomeAtom` (a number in [0, 1], localStorage key
  `wave:pet.home`, default 0.9, seeded at module load the way the corner atom is; a missing, non-finite or
  out-of-range value reads as 0.9) and `setPetHome(fraction)`, which clamps and persists. Leave `petCornerAtom`
  and its helpers in place: `petview.tsx` still uses them until Task 4, and Task 5 deletes them.

Tests: extend `petstore.test.ts` with the home round-trip and the fallback for a corrupt, negative and >1 value.
Run `npx vitest run frontend/app/view/jarvis/petstore.test.ts`. The markers are proven in the running app by the
Final's `jarvis-pet` step 1 (the creature stands on the footer on Agent and on the HintsBar on Cockpit).

### Task 4: Render Sprout in PetView
**Depends on:** Task 1, Task 2, Task 3

Rewrite `frontend/app/view/jarvis/petview.tsx` as spec §4 "Changed" describes:
- Replace both canvases, the GL and 2D render loop, the ripple and `__jarvisAvatarScene` with a fixed-position
  48×48 `<svg shape-rendering="crispEdges">`: the body cells as `<rect>`s in a group mirrored when `flip`, the
  overlay cells and the unread dot (`unread` mark, when `petUnreadAtom` is set) outside it, every `fill` a
  `var(--color-…)`.
- One timeout loop calls `stepWalker` and schedules the next call by `delayMs`; `null` stops it until an input
  changes. It pauses while `document.hidden`.
- Measure the ledge: the lowest visible `[data-pet-ledge]` element's top, left bound the nav rail's right edge
  (`navrail.tsx`'s `<nav>`), right bound the window's right edge less 8 px, the window bottom when no ledge element
  is visible; re-measure on resize and on a surface switch (`model.surfaceAtom`). Collect avoid spans from every
  `.xterm` and `[data-pet-avoid]` whose box comes within 80 px above the ledge, when the walker is about to rest.
  Put that rect arithmetic (lowest ledge, spans from rects) in a pure helper with tests, in `petwalk.ts` or a new
  `petledge.ts`, so the component stays thin.
- Drag: keep motion's drag; while dragging the walker is `dragged` (pose `dangle`); on release place it with
  `dropAt` and persist `setPetHome(homeFraction(...))`.
- Keep unchanged: the utterance effect (watermark, `rememberSaid`, bubble, unread), click toggling the peek,
  Enter/Space opening it, `role="button"`, `tabIndex={0}`, `aria-label="Jarvis condition"`, the quiet opacity
  values (0.4 quiet, 1 otherwise and on hover), and `PetBubble`/`PetPeek`, whose `corner` prop is now derived from
  the creature's centre: `bottom-left` in the left half of the window, else `bottom-right`.
- `lastActivityAt` advances on an utterance, a posture change, a hover, a click and a drag.
- In DEV builds publish `window.__jarvisPet` with the fields and the `force(override | null)` method of spec §4,
  folded out of production by `import.meta.env.DEV`.
- Stop importing `avatarscene`, `avatarthree`, `avatarcanvas`, `petmotion`, `petCornerAtom` and `markPetSpoke`;
  Task 5 deletes them.

Acceptance: the Final's `jarvis-pet` steps 1–6 (ledge, tokens and label, walking, resting off the terminal, every
forced state, drag and drop), and `surface-smoke`'s notify step and `jarvis-peek` passing unchanged (the bubble and
the peek still anchor to the creature). Run the tests of any pure helper you add.

### Task 5: Remove the hologram
**Depends on:** Task 4

- Delete `avatarscene.ts`, `avatarthree.ts`, `avatarcanvas.ts` and their `.test.ts` files, and `petmotion.ts`
  with `petmotion.test.ts`, all under `frontend/app/view/jarvis/`.
- From `petstore.ts` remove `PET_CORNERS`, `PetCorner` (keep the union only where `petbubble.tsx`/`petpeek.tsx`
  still type their `corner` prop; move it beside them if `petstore.ts` no longer needs it), `petCornerAtom`,
  `setPetCorner`, the corner reader and the `wave:pet.corner` key, and `petSpokeAtAtom`/`markPetSpoke`, with any
  test of them.
- Drop `three` and `@types/three` with `npm uninstall --package-lock-only three @types/three`. Lock-only on
  purpose: this worktree's `node_modules` is a junction into the main checkout, where a plain uninstall would delete
  the package while the main checkout's code still imports it.
- Grep `frontend/` and `scripts/` for anything still naming the removed modules or atoms.

Acceptance: `task check:ts` is clean and `npx vitest run frontend/app/view/jarvis` passes.

### Task 6: The jarvis-pet CDP scenario
**Depends on:** none

In `scripts/cdp/scenarios.mjs` replace the `jarvisAvatar` scenario (`name: "jarvis-avatar"`) with `jarvisPet`,
`name: "jarvis-pet"`, and swap it in the `SCENARIOS` list. It reads `window.__jarvisPet` and drives its `force`
exactly as spec §4 defines them, and records each of spec §5's CDP steps 1–6 as its own `rec(...)` with a
screenshot `cdp-shots/jarvis-pet-<n>.png`: the ledge on Agent and on Cockpit, tokens and the one "Jarvis
condition", walking (two samples a second apart), resting off the Agent terminal (poll up to 40 s for the
`rest` state), each forced state's pose and marks, and a real drag with `h.cdp("Input.dispatchMouseEvent", …)`
showing `dangle` then landing on the ledge at the release x. Teardown calls `force(null)` and returns to Cockpit.

The app this scenario checks exists only once Task 4 merges, so don't start a dev app to run it here: the Final
runs it. Check it parses with `node --check scripts/cdp/scenarios.mjs`, and keep it to the `__jarvisPet` contract
so it needs nothing Task 4 does not publish.
