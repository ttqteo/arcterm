# Jarvis as Sprout — a pixel pet that walks the footer ledge

Replaces the Jarvis hologram (`avatarscene.ts`, `avatarthree.ts`, `avatarcanvas.ts`) with **Sprout**, an
original 8-bit creature drawn from Arc's own `t>` mark, which walks along the top edge of the hints footer.
Everything the creature *means* stays as it is: `petcondition.ts` still decides the one expression and the
posture (`2026-08-04-jarvis-pet-design.md` §3, §5), and the bubble, unread marker, peek, errand and acts keep
working. Only the renderer and where the creature stands change.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| 1 | An original creature, not Anthropic's Clawd. | Clawd is Anthropic's mascot. Arc ships an installer and drives pi, codex and opencode too, so wearing another company's mascot reads as an affiliation Arc does not have. |
| 2 | Sprout: an accent-blue blob whose head grows the `t` of the mark as a sprout (the crossbar is its leaves). | Picked from four candidates (Cursor, Sprout, Visor, Bird) on the `arc-pet` design canvas. |
| 3 | It walks along the ledge: the top edge of the hints footer, from the nav rail to the window's right edge. | The user asked for a creature that roams, and the bottom edge is the one place it can roam without sitting on a surface's heading band (pet spec §9). |
| 4 | It may walk across a terminal, but it never stops on one. Rest, sit and sleep spots are chosen outside every terminal and composer that touches the ledge. | The pet spec's occlusion rule (§9: "a creature that covers the composer or a terminal's last line and cannot be moved is worse than no creature"); passing over is brief, resting is not. |
| 5 | SVG `<rect>` pixels filled with `var(--color-*)`, no canvas, no WebGL. | Theme tokens apply for free, and the creature gives back the WebGL context the hologram held against the terminals' xterm-webgl contexts (pet spec §9). |
| 6 | The frame loop runs at 8 fps and stops whenever the creature is not moving. | Pixel art steps one cell at a time; an always-on loop holds the page at display rate (DESIGN.md, pulse driver). |

## 2. The creature

A 16×16 cell grid, one cell = 3 CSS px, so the sprite is 48×48 and its bottom row stands on the ledge. Rows 0–3
hold the marks. Cell codes and their tokens:

| Code | Token | Use |
|---|---|---|
| `b` | `--color-accent` | body |
| `d` | `--color-accent-600` | sprout, legs |
| `l` | `--color-accent-200` | highlight, sweat drop |
| `k` | `--color-background` | eyes, mouth, the eye mark's pupil |
| `w` | `--color-primary` | the review-gate eye mark |
| `m` | `--color-muted` | the sleep `z` |
| `r` | `--color-error` | the escalation `!` |
| `y` | `--color-asking` | the blocked-worker `?` |

Poses (`E` is an empty row, `................`):

```
walk1                 walk2                 stand                 sit
E                     E                     E                     E
E                     E                     E                     E
E                     E                     E                     E
........d.......      ......d.........      .......d........      E
......dddd......      ......dddd......      ......dddd......      .......d........
.......d........      .......d........      .......d........      ......dddd......
.......d........      .......d........      .......d........      .......d........
....llbbbbbb....      ....llbbbbbb....      ....llbbbbbb....      .......d........
...lbbbbbbbbb...      ...lbbbbbbbbb...      ...lbbbbbbbbb...      ....llbbbbbb....
..bbbbbbbbbbbb..      ..bbbbbbbbbbbb..      ..bbbbbbbbbbbb..      ...lbbbbbbbbb...
..bbbbkbbbbkbb..      ..bbbbkbbbbkbb..      ..bbbkbbbbkbbb..      ..bbbbbbbbbbbb..
..bbbbkbbbbkbb..      ..bbbbkbbbbkbb..      ..bbbkbbbbkbbb..      ..bbbkbbbbkbbb..
..bbbbbbbbbbbb..      ..bbbbbbbbbbbb..      ..bbbbbbbbbbbb..      ..bbbkbbbbkbbb..
..bbbbbbbbbbbb..      ..bbbbbbbbbbbb..      ..bbbbbbbbbbbb..      ..bbbbbbbbbbbb..
...bbbbbbbbbb...      ...bbbbbbbbbb...      ...bbbbbbbbbb...      ..bbbbbbbbbbbb..
...dd......dd...      .....dd..dd.....      ....dd....dd....      ...bbbbbbbbbbdd.

sleep                 tired                 speak                 dangle (being dragged)
E                     E                     E                     E
E                     E                     E                     .......d........
E                     E                     E                     ......dddd......
E                     E                     .......d........      .......d........
E                     .......d........      ......dddd......      .......d........
E                     .....dd.dd......      .......d........      ....llbbbbbb....
.......d........      .......d........      .......d........      ...lbbbbbbbbb...
.....dd.dd......      ....llbbbbbb....      ....llbbbbbb....      ..bbbbbbbbbbbb..
.......d........      ...lbbbbbbbbb...      ...lbbbbbbbbb...      ..bbbkkbbkkbbb..
....llbbbbbb....      ..bbbbbbbbbbbb..      ..bbbbbbbbbbbb..      ..bbbkkbbkkbbb..
..lbbbbbbbbbbb..      ..bbbbbbbbbbbb..      ..bbbkbbbbkbbb..      ..bbbbbbbbbbbb..
.bbbbbbbbbbbbbb.      ..bbbkbbbbkbbb..      ..bbbkbbbbkbbb..      ..bbbbbbbbbbbb..
.bbbkkbbbbkkbbb.      ..bbbbbbbbbbbb..      ..bbbbbkkbbbbb..      ...bbbbbbbbbb...
.bbbbbbbbbbbbbb.      ..bbbbbbbbbbbb..      ..bbbbbbbbbbbb..      ....d......d....
.bbbbbbbbbbbbbb.      ...bbbbbbbbbb...      ...bbbbbbbbbb...      ....d......d....
..bbbbbbbbbbbb..      ....dd....dd....      ....dd....dd....      ....d......d....
```

Marks are stamped over a pose at a fixed cell (x, y), never as a count (pet spec §3, "the creature never draws
a number"), and each pairs its colour with a shape (DESIGN.md: status is never colour alone):

| Mark | Cell | Rows | Stamped on |
|---|---|---|---|
| review gate (an eye: "look at this") | (11, 0) | `.www.` `wwkww` `.www.` | `stand` |
| escalation (`!`) | (13, 0) | `rr` `rr` `rr` `..` `rr` | `stand` |
| blocked worker (`?`) | (13, 0) | `yyy` `..y` `.yy` `...` `.y.` | `stand` |
| sleep (`z`) | (11, 0) | `mmmm` `..m.` `.m..` `mmmm` | `sleep` |
| sweat drop | (14, 4) | `l.` `ll` `ll` | `tired` |
| unread | (1, 5) | `bb` `bb` | any pose |

Walking left mirrors the body horizontally; marks and the unread dot are drawn unmirrored, so `?` never reads
backwards.

## 3. Behaviour

**The ledge** is the top edge of the lowest visible element carrying `data-pet-ledge`: the hints footer's bar
(`hints-footer.tsx` `FooterBar`, both its rest and leader postures) and the Cockpit surface's own `HintsBar`
(`cockpithelp.tsx`), since the footer renders nothing on Cockpit. It runs from the nav rail's right edge
(`navrail.tsx`'s `<nav>`) to the window's right edge less 8 px. With no ledge element visible, the window's
bottom edge is the ledge. It is re-measured on resize and on every surface switch.

**Avoid spans** are the horizontal extents of every `.xterm` and every `[data-pet-avoid]` element (the
composer shell, `composer-shell.tsx`) whose box comes within 80 px above the ledge. They are read when the
walker picks where to stop, not every frame.

**The walker** (`petwalk.ts`, pure) runs these states:

| State | Pose | Moves | Enters when |
|---|---|---|---|
| walk | `walk1`/`walk2`, alternating every 2 frames | 1 cell (3 px) per frame at 8 fps, 24 px/s | a rest ends; it picks a target 80–400 px away inside the ledge and turns at the ends |
| rest | `stand` or `sit` | no | a walk reaches its target; lasts 5–15 s; the target is outside every avoid span (home, when none is clear) |
| sleep | `sleep` + `z` | no | 10 minutes with no utterance, posture change or interaction; it walks to a clear spot first |
| hold | `stand` + posture mark, `speak` while a bubble shows | no | a posture other than none, a bubble, or the peek open; it wakes from sleep for any of them |
| hop | `stand`, lifted 2 cells for 2 frames | in place | a posture arrives (replaces the hologram's jolt: on arrival only, never while it stands) |
| dragged | `dangle` | follows the pointer | a drag starts; on release it drops to the ledge at the release x, which becomes home |

`tired` (the rate-limit expression) halves the walking speed to 4 fps, makes rests twice as long, and rests in
`tired` + sweat drop instead of `stand`/`sit`. The quiet opacity rule is unchanged: faint (0.4) while it walks,
rests or sleeps with nothing to express, solid for anything it expresses, solid on hover.

**Reduced motion:** no walking and no hop; it stands at home, and its pose and marks still change.
**Hidden tab** (`document.hidden`): the loop stops and resumes where it was.

**Home** is persisted in `petstore.ts` as a fraction of the ledge's width (`wave:pet.home`, default 0.9),
replacing `petCornerAtom`/`PET_CORNERS`/`wave:pet.corner`, so a resize keeps it in the same place. Boot places
the creature at home. An older build's corner key is ignored, as the corner spec did for its own migration.

**Bubble and peek** keep their `corner` prop and its placement tables, but the value is derived from where the
creature stands: `bottom-left` when its centre is in the left half of the window, else `bottom-right`. The
creature holds still while either is open, so `autoUpdate` keeps anchoring correctly without following motion.

**Input:** click toggles the peek; Enter or Space opens it (`role="button"`, `tabIndex 0`); the accessible name
stays "Jarvis condition" (the nav rail owns "Jarvis", and the CDP harness navigates by it).

## 4. Architecture

New, pure, each with a vitest file beside it:

- **`frontend/app/view/jarvis/petsprite.ts`** — the poses and marks above as data, and
  `spriteFor(pose, marks): { x, y, token }[]` returning one cell per drawn pixel with its `--color-*` token name.
  The grids live here and nowhere else.
- **`frontend/app/view/jarvis/petwalk.ts`** — the walker: `stepWalker(state, input, now, rand)` →
  `{ state, pose, marks, x, flip, delayMs }`. `input` is `{ ledge: { left, right }, avoid: [x0, x1][],
  expression, posture, speaking, peekOpen, dragging, reduce, lastActivityAt }`; `rand` is injected so tests are
  deterministic. `delayMs` is how long until the next frame, or `null` when nothing moves (the loop stops).

Changed:

- **`petview.tsx`** — drops both canvases, the GL/2D render loop, the ripple and the scene publisher. Renders a
  fixed-position `<svg width=48 height=48 shape-rendering="crispEdges">` of `<rect>`s from `spriteFor`, the body
  in a group mirrored by `flip`, marks and the unread dot outside it. Its left edge comes from the walker, its
  bottom sits on the ledge. One timeout loop drives `stepWalker`; it measures the ledge on resize and on surface
  switch and the avoid spans when the walker asks for a rest spot. Drag uses motion's drag as now; on release the
  walker drops to the ledge and `setPetHome` persists the fraction. In DEV builds it publishes
  `window.__jarvisPet = { state, pose, x, ledge: { top, left, right }, avoid, tokens }` for the CDP scenario.
- **`petstore.ts`** — `petHomeAtom` (fraction) and `setPetHome` replace the corner atom, its key and
  `PET_CORNERS`; `petSpokeAtAtom`/`markPetSpoke` go (they only fed the hologram's ring surge).
- **`hints-footer.tsx`**, **`cockpithelp.tsx`** — `data-pet-ledge` on the bar. **`composer-shell.tsx`** —
  `data-pet-avoid` on its root.

Removed: `avatarscene.ts`, `avatarthree.ts`, `avatarcanvas.ts` and their tests, `petmotion.ts` and its test
(orbit, breath, utterance and impulse envelopes, frame delay — all hologram motion), and `three` with
`@types/three` from `package.json` (`avatarthree.ts` is their only importer).

## 5. Verification

- **vitest** — `petsprite.test.ts`: every pose is 16×16; every cell code maps to a `--color-*` token; no mark
  overlaps a body cell of the pose it is stamped on; no pose or mark draws a digit-shaped count (the marks are
  the fixed set above). `petwalk.test.ts`: x stays inside the ledge and turns at both ends; a rest spot never
  falls inside an avoid span, and falls back to home when every spot is blocked; posture, bubble, peek and drag
  each hold it still; a posture's arrival hops once and its standing does not; tired halves the speed; it sleeps
  after 10 idle minutes and wakes on a posture; reduced motion never moves it off home; `delayMs` is `null` while
  it holds, rests or sleeps; home as a fraction lands at the same relative x after a resize. `petstore.test.ts`
  covers the home round-trip and a corrupt value falling back to the default.
- **CDP** — `jarvis-avatar` becomes `jarvis-pet` in `scripts/cdp/scenarios.mjs`: the creature's bottom equals
  the ledge top (±1 px) on Agent and on Cockpit; x stays within the ledge; every rendered fill is a
  `var(--color-…)`; exactly one element is named "Jarvis condition"; after a rest spot is chosen on the Agent
  surface, the creature's span does not overlap the terminal; a screenshot to `cdp-shots/jarvis-pet.png`. The
  existing scenarios that open the peek and read the bubble (`surface-smoke`'s notify step, `peek-*`) must still
  pass unchanged.

## 6. Out of scope

- Any other creature, a picker between creatures, or a user-drawn sprite.
- Roaming anywhere but the ledge (climbing panels, sitting on headers): rejected in the brainstorm for covering
  terminals and buttons.
- New Condition registers: `petcondition.ts` keeps exactly the expressions and postures it has.
- Sound.
