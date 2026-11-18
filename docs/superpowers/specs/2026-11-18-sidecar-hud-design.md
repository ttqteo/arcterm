# Sidecar as a HUD

Date: 2026-11-18. Brainstorm: `.superpowers/brainstorm/sidecar-hud/brainstorm.json`.
Prototype: `D:\work\arcterm\.superpowers\design\sidecar-hud\project` (boards `A-giu-bo-cuc.dc.html` for the wall P,
`Q-dang-nho.dc.html` for the small form Q; the options not chosen are in `../unchosen/`).

## Intent

Make Sidecar, the second window read from across the room, look like a sci-fi HUD: cyan glow on a dark blue-black
ground, tick-marked rings, corner brackets, circuit-line dividers, monospace figures. It must stay light: Sidecar
is open all day on a second screen, and the person put lightness first ("ưu tiên perf thấp nhưng vẫn đẹp").

## Decisions

### Scope
The whole wall (layout P: orbit, Needs you, lanes, the Resources column) and the small form (Q) take the HUD skin.
The panel the title bar's figures open (`sidecarresourcespanel.tsx`) takes it too, since it shares the parts.

### Motion: static, moves only when a figure changes
No repeating motion. Rings, ticks, brackets and glow stand still. When a figure changes (every 2 s at most), its arc
or needle slides to the new value and stops (the orbit's rings already do: `stroke-dasharray` transition 500 ms in
`sidecarorbit.tsx`). The waiting item's ping stays as it is today. Under reduced motion values jump.

### Light first
- Glow is never a `filter: blur`, `drop-shadow` or large `box-shadow` on an element that changes: it is two stacked
  strokes, a thin bright one over a wide faint one (`stroke-opacity` ~0.22, 4× the width), drawn as plain SVG.
- The static decoration (corner brackets, tick rings, circuit dividers) is its own SVG layer that depends on no
  snapshot field, so a snapshot never repaints it. Only the value arcs, the chart lines and the figures change.
- One deliberate exception: the window's alert frame keeps today's glowing full-window inset `box-shadow` (`FRAME` in `sidecarorbit.tsx` and `sidecarcompact.tsx`: 3 px warning; 4 px and a 120 px red halo on error, 500 ms transition), recolored through the tokens only. It repaints only when the state changes, a few times a day, never on the 2 s beat (the person chose it after weighing it against corner brackets: question 9). On Q it replaces the window corner brackets board Q draws.
### Color: a HUD token set
New `@theme` tokens in `frontend/tailwindsetup.css`, used only by Sidecar: `--color-hud-bg` (blue-black ground,
~`#061218`), `--color-hud-panel` (~`#0a1b22`), `--color-hud-line` (~`#123642`, ticks and dividers),
`--color-hud-glow` (cyan, ~`#3fd8ff`), `--color-hud-glow-dim` (the wide faint stroke), `--color-hud-text`
(~`#d4f4ff`), `--color-hud-muted` (~`#5f8c99`). A theme may override them like any `--color-*` (`themes.ts` /
`themestore.ts`). Status colors keep their tokens: warning (asking), error (RAM strained), success (working).

### Layout: keep P's blocks, swap Needs you and the orbit
Board `A-giu-bo-cuc.dc.html`. P keeps its blocks and grid, with one change: the right column of today moves to the left (`2fr`) whole, the strain band on top, Needs you, then the run box when no band shows (builder question 1), and the orbit to the right (`3fr`), next to the Resources column; lanes stay below, the footer at the bottom,
the Resources column (CPU/RAM/GPU 5-minute charts, then the process table) on the right from 1560×760 as today
(`resourcesColumnFits`). The orbit sits in the middle of its own area (close to the window's centre, off by a few
tens of px depending on size), not pinned to the window's centre. The skin: corner brackets around Needs you and the
Resources column, a tick ring around the orbit, circuit-line dividers, labels and figures in JetBrains Mono
(uppercase, letter-spaced labels), value arcs and chart lines glowing with stacked strokes. 

Agent's call: board A is a sketch of the skin, not of the content. P keeps everything it shows today: the node labels with the heavy agent's line, the spokes, Needs you filling its cell's height and scrolling, and the footer's `←→` and `F11` hints; only the drawing and the two blocks' places change.

Agent's call: the keys keep their two axes (↑↓ through Needs you, ←→ around the orbit); `dashKey` and `selectionAfter` do not change. Only the DOM and Tab order follow the new layout (Needs you first).

A row of SYS dials (option B) or a central array (option C) can be added later on this same skin; neither is built
now.

### Small form (Q)
Board `Q-dang-nho.dc.html`. Q (340 px) takes the same tokens, corner brackets and monospace figures; its core is a
small three-ring dial with ticks; the RAM band gets red corner brackets. Decoration is thinner than on P so the small
form stays readable.

## Left to the builder
- `--color-hud-*` values per theme. A light theme that does not override them falls back to its own accent and
  surface tokens, so no cyan glow lands on a white ground.
- Tick density and glow stroke widths at each size (P, Q, the panel), with no blur filter anywhere.
- A Sidecar exception in `DESIGN.md`: the stacked-stroke glow, brackets and HUD tokens live only in Sidecar; still no
  repeating motion besides the ping.
- The Sidecar CDP scenarios (`scripts/cdp/scenarios-sidecar.mjs`: orbit, small form, resources) updated to shoot the
  new skin and the swapped order.
- The before/after measurement in "RAM watch".

## Context
DESIGN.md today: depth is tonal, shadows only for floating chrome, glow only on a CTA; Sidecar's one repeating motion
is the ping (a radar sweep was removed for keeping the GPU busy). P is drawn in a 1160×620 stage scaled to its box
(`useFit` in `sidecarorbit.tsx`); Q is `sidecarcompact.tsx`; the title bar `sidecartitlebar.tsx`; the band
`sidecarband.tsx`; the Resources charts and table `sidecarresourcecharts.tsx` and `sidecarresourcespanel.tsx`.

## Builder's calls (2026-11-18, autonomous run)
What "Left to the builder" settles, and why.

- **HUD tokens are fixed, not per theme.** `--color-hud-*` sit in `@theme` with the values above; `themes.ts`
  `buildThemeVars` does not set them, so every theme keeps the cyan HUD. Every shipped theme is dark (light mode was
  declined, `themes.ts` header), so the "light theme falls back" case does not arise; a per-theme set is YAGNI until a
  theme asks for it. `--color-hud-glow-dim` is the glow colour at 22% (`color-mix`), so it follows `--color-hud-glow`.
- **Status colours stay the theme's** (`warning`, `error`, `success`), as the spec says; the alert frame (`FRAME`) is
  unchanged.
- **One home for the parts.** `frontend/app/cockpit/sidecarhud.tsx` holds the HUD parts every Sidecar view uses
  (corner brackets, tick ring, circuit divider, label, stacked-stroke glow); `sidecarhudmodel.ts` their pure geometry,
  unit-tested. Each decoration part is `React.memo` with static props only, so a snapshot never re-renders it.
- **Corner brackets need no measuring:** four small fixed-size SVG corners pinned to the box's corners, not one SVG
  sized to the box, so no `ResizeObserver` is added for decoration.
- **Tick density:** P's orbit ring 120 ticks (every 3°), every 10th major (4 px minor, 7 px major); Q's dial 60 ticks
  (every 6°), every 5th major (3 / 5 px), which needs board Q's larger core: 128 px with rings at r 52 / 44 / 36
  (today 112 px, r 50 / 41 / 32, leaves no room for a tick ring); the panel and the charts have no tick rings (their gridlines take
  `hud-line`).
- **Glow widths:** the glow is a halo stroke 4× the core width at `stroke-opacity` 0.22 under the core. P's value rings
  become a 3 px core over a 12 px halo on a 1 px `hud-line` track (the rings are 16 px apart, so the halo never
  touches the next ring; today's 9 px ring with a 36 px halo would); chart lines 1.5 px over 6 px; Q's dial 2 px over
  8 px.
- **Type:** labels are JetBrains Mono (`font-mono`), uppercase, letter-spaced 0.14em, `hud-muted`; figures (counts,
  percentages, ages, clocks, bytes) are `font-mono tabular-nums`; names and need text stay in the sans face, as the
  board draws them.
- **Surfaces:** the page and title bar on `hud-bg`; Needs you, the run box, the lanes and the Resources column on
  `hud-panel`; Needs you gets brackets instead of a border; the Resources column gets brackets and keeps board A's
  `hud-line` left border, which divides it from the wall; the run box and lanes a `hud-line` border or divider. `sidecar.html`'s pre-mount body colour becomes the HUD ground, so the window does not flash grey.
- **Light-first check in the scenario:** the Sidecar scenarios assert that no element on the page has a CSS `filter`
  and that the only infinite animation is `sidecarPing`, and record the page's idle cost (layout and style recalcs
  over 10 s, JS heap, DOM nodes) as the HUD's "after" figure. **The run reports only the after figure** (this amends
  "The before/after measurement in RAM watch"): the read is a new scenario step, so no earlier tree has it, and a
  dev-app before/after of the same step would need a second app on the base tree in the run. The before/after that
  matters, Sidecar's renderer plus GPU process on a release build before and after the HUD, stays the person's
  (hand-checks.md), against the part 3 RAM watch row.
