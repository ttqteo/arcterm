# Sidecar HUD skin

**Spec:** `docs/superpowers/specs/2026-11-18-sidecar-hud-design.md` (its "Builder's calls" section settles what the spec left to the builder)
**Verify:** `node scripts/verify.mjs`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs sidecar-orbit sidecar-compact`
**Prototype:** D:\work\arcterm\.superpowers\design\sidecar-hud\project\A-giu-bo-cuc.dc.html

Goal: Sidecar (P, the wall; Q, the small form; the Resources column and panel; the title bar) takes a static HUD skin
(cyan stacked-stroke glow on a blue-black ground, tick rings, corner brackets, circuit dividers, monospace figures),
and P swaps its two top blocks: Needs you (with the strain band and run box) on the left at `2fr`, the orbit on the
right at `3fr`. Board A is `A-giu-bo-cuc.dc.html`, board Q `Q-dang-nho.dc.html`, both beside the Prototype path; open
them in a browser to see the skin. Board A sketches the skin, not the content: P keeps everything it shows today.

Rules every task keeps (spec "Light first", "Motion"):
- No `filter`, `blur`, `drop-shadow`, or new `box-shadow` glow anywhere on the Sidecar page. Glow is two stacked SVG
  strokes from `sidecarhud.tsx`. The alert frame (`FRAME` in `sidecarorbit.tsx` / `sidecarcompact.tsx`) stays exactly
  as it is.
- No new repeating motion: the ping (`animate-sidecar-ping`) stays the only infinite animation. A value arc or chart
  line may ease to a new value (as the orbit rings' 500 ms `stroke-dasharray` transition does) and jumps under reduced
  motion.
- Static decoration (brackets, tick rings, dividers) takes no snapshot field, so a snapshot never re-renders it.
- Colours only through tokens (`hud-*` from Task 1, plus the existing `warning`, `error`, `success`). No raw hex in
  components.
- Every `data-sidecar-*` attribute the scenarios read today stays on the same element, and so does every structure
  `DASH_READ` (`scripts/cdp/scenarios-sidecar.mjs:416`) reads: the `.animate-sidecar-ping` class on a ping, the
  `bg-errorbg` class on a failed Needs-you row, a row's `:scope > div.flex-col` box whose children are [head, text,
  how] in that order (P's row is itself the column; Q's holds a marker and that column), a node's label `title`, and
  the "Failed" word leading a failed row's text. Restyle around them; do not rename or reorder them.

## Interface Task 1 lands (Tasks 2, 3 and 4 build on it)

Tokens in `frontend/tailwindsetup.css` `@theme`: `--color-hud-bg` `#061218`, `--color-hud-panel` `#0a1b22`,
`--color-hud-line` `#123642`, `--color-hud-glow` `#3fd8ff`, `--color-hud-glow-dim`
(`color-mix(in srgb, var(--color-hud-glow) 22%, transparent)`), `--color-hud-text` `#d4f4ff`, `--color-hud-muted`
`#5f8c99`, so `bg-hud-bg`, `stroke-hud-glow`, `text-hud-muted`, `border-hud-line` etc. exist.

`frontend/app/cockpit/sidecarhudmodel.ts` (pure):
- `HUD_GLOW_HALO = 4` (halo width = core × 4), `HUD_GLOW_OPACITY = 0.22`.
- `tickLines(cx: number, cy: number, r: number, count: number, majorEvery: number, minorLen: number, majorLen: number): { x1: number; y1: number; x2: number; y2: number; major: boolean }[]`
  (ticks start at 12 o'clock, clockwise, pointing inward from `r`).
- `bracketPath(size: number, corner: "tl" | "tr" | "br" | "bl", inset?: number): string` (an SVG path `d` for one
  L-shaped corner in a `size`×`size` box).

`frontend/app/cockpit/sidecarhud.tsx` (each part `React.memo`, `aria-hidden`, `pointer-events-none`, carries
`data-hud-deco`, takes only static props):
- `HudBrackets({ size?: number; className?: string })`: four corner SVGs absolutely positioned at the parent's corners
  (the parent is `relative`); stroke `hud-glow` by default, `className` can recolor (`stroke-error`). Default size 14.
- `HudTickRing({ cx, cy, r, count, majorEvery, minorLen, majorLen })`: an SVG `<g>` of `hud-line` ticks, for use inside
  a caller's `<svg>`.
- `HudDivider({ className?: string })`: a circuit-line divider, a 1 px `hud-line` rule with a short angled jog and an
  end node, drawn in CSS or a small SVG.
- `HudLabel({ children, className? })`: a `font-mono` uppercase `tracking-[0.14em]` `text-hud-muted` span at 10.5 px.
- `GlowCircle(props: SVGProps<SVGCircleElement> & { width: number })` and `GlowPath(props: SVGProps<SVGPathElement> & { width: number })`:
  render the same shape twice in a `<g>`, a halo (`width × HUD_GLOW_HALO`, `strokeOpacity HUD_GLOW_OPACITY`, carries
  `data-hud-glow`) under a core (`width`); `className` and `style` (stroke colour, dasharray, transition) go to both.
  These are not memoized decoration: they draw the changing values.

### Task 1: HUD tokens, parts, and the DESIGN.md exception
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/tailwindsetup.css`, `frontend/app/cockpit/sidecarhudmodel.ts`, `frontend/app/cockpit/sidecarhudmodel.test.ts`, `frontend/app/cockpit/sidecarhud.tsx`, `DESIGN.md`

Land the interface above exactly as named (Tasks 2–4 import these names in parallel). Decisions this task makes: the
tokens are fixed in `@theme` and `themes.ts` does not override them (spec "Builder's calls"); `--color-hud-glow-dim`
is a `color-mix` of the glow. In `DESIGN.md`, extend the Sidecar paragraph (around the `animate-sidecar-ping`
exception) with the HUD exception: the `hud-*` tokens, stacked-stroke glow, corner brackets, tick rings and circuit
dividers live only in Sidecar; glow is never a filter or a large shadow on a changing element; the alert frame is the
one glowing `box-shadow`; still no repeating motion besides the ping.

Acceptance:
- `sidecarhudmodel.test.ts`: `tickLines` returns `count` ticks, the first at 12 o'clock (x1 = cx, y1 = cy − r), every
  `majorEvery`-th one major and `majorLen` long, the rest `minorLen`, all on radius `r` going inward; `bracketPath` for
  each corner starts and ends on that corner's two edges. `npx vitest run frontend/app/cockpit/sidecarhudmodel.test.ts`.
- `task check:ts` passes with the new module (nothing imports it yet).
- No view is drawn by this task; Tasks 2–4 name the scenario steps that show the parts.

### Task 2: P, the wall: swap Needs you and the orbit, HUD skin
**Depends on:** Task 1 (imports the `sidecarhud.tsx` parts and `hud-*` tokens)
**Model:** sonnet
**Files:** `frontend/app/cockpit/sidecarorbit.tsx`, `frontend/app/cockpit/sidecarband.tsx`

Layout: the top grid becomes `grid-cols-[minmax(0,2fr)_minmax(0,3fr)]` with the column holding the strain band,
Needs you and the run box first (DOM and Tab order: Needs you before the orbit) and `OrbitCell` second. The left
column carries `data-sidecar-needs-col`, the orbit cell `data-sidecar-orbit-cell` (Task 5's scenario compares their
rects). The column's padding mirrors to the left side (`pl-6`, not `pr-6`); the band's negative side margins follow.
`dashKey`, `selectionAfter`, the key handler and every behaviour stay as they are; only the drawing and the two
blocks' places change.

Skin (board A; spec "Builder's calls"): the root and lanes on `hud-bg`/`hud-panel`; Needs you on `hud-panel` with
`HudBrackets` instead of a border, its title a `HudLabel` ("NEEDS YOU") with the count in `font-mono`; an asking row a
1 px `border-warning` over its tint, other rows `border-hud-line`, the selected row's ring `hud-glow`; ages, `needHow`
and counts in `font-mono tabular-nums`. The orbit: a static `HudTickRing` (120 ticks, every 10th major, 4 / 7 px)
just outside the outer value ring, drawn in its own memoized `<svg>` layer under the changing one; the three value
rings become `GlowCircle`s (3 px core) on 1 px `hud-line` tracks, keeping `ringDash`, the `rotate(-90)` and the 500 ms
`stroke-dasharray` transition (with `motion-reduce:transition-none`); the 5-hour ring `hud-glow`, the week ring
`hud-muted`, RAM `hud-text` or the band's tone as today; the orbit ellipse and quiet spokes `hud-line`; the core figure
in `font-mono`, its word a `HudLabel`. Node dots' halo gap uses `--color-hud-bg` instead of `--color-background`; node
labels keep name (sans), line and heavy line. The ring legend and the counts row use `font-mono` figures. Lanes: title
`HudLabel` ("LAST 2 HOURS") followed by a `HudDivider`, tracks on a `hud-line` baseline, axis clocks in `font-mono`.
Run box on `hud-panel` with a `hud-line` border. Footer: `font-mono` uppercase hints on `hud-bg` with a `hud-line`
top border, keeping its four hints (`←↑↓→`, Enter, 1–9, F11). `SidecarBand`: `hud-panel` ground, figures in
`font-mono`, `HudBrackets` in the band's tone (`stroke-warning` / `stroke-error`) instead of its border; its
behaviour, buttons and `data-*` attributes unchanged. Keep `FRAME` and the ping unchanged.

Acceptance:
- `npx vitest run frontend/app/cockpit/sidecarorbitmodel.test.ts frontend/app/cockpit/sidecarkeys.test.ts` still
  passes (the models are untouched).
- `sidecar-orbit` scenario shots `p-orbit-dashboard`, `p-calm`, `p-high`, `p-critical`, `p-failed`, `band-red`,
  `band-amber` and `p-keys` (the selected row's `hud-glow` ring) show the HUD skin with Needs you on the left, and the
  existing steps reading `DASH_READ` still pass; Task 5's step "the wall's Needs you column sits left of the
  orbit" passes, and its step "no filter on the Sidecar page, and the ping is the only infinite animation" passes on P.

### Task 3: Q, the small form, HUD skin
**Depends on:** Task 1 (imports the `sidecarhud.tsx` parts and `hud-*` tokens)
**Model:** sonnet
**Files:** `frontend/app/cockpit/sidecarcompact.tsx`

Board `Q-dang-nho.dc.html`. Q (340 px) takes the tokens, `HudLabel`s and `font-mono` figures; its core becomes a small
three-ring dial at board Q's size: `CORE_PX` 128 (today 112) with the rings at r 52 / 44 / 36 (today 50 / 41 / 32),
which leaves room for a static `HudTickRing` (60 ticks, every 5th major, 3 / 5 px) just outside the 5-hour ring, in its
own memoized `<svg>`; the three value rings become `GlowCircle`s (2 px core) on `hud-line` tracks keeping today's dash
maths and transition. One wrapper element around both svgs (and the core's figures) carries `data-hud-dial`. Its strain
line (`data-sidecar-strainline`) takes `HudBrackets` in the strain's tone (`stroke-warning` at high, `stroke-error` at
critical) inside the line's box. The heavy dot's `HALO` gap (`sidecarcompact.tsx:87-88`) uses `--color-hud-bg`
instead of `--color-background`, as P's node does. Decoration is thinner than P's (brackets size 10). The window corner
brackets board Q draws are not drawn: the alert frame (`FRAME`) stays and does that job (spec "Light first"). Every
`data-sidecar-*` attribute, the `DASH_READ` structures above and behaviour stay.

Acceptance:
- `sidecar-compact` scenario shots `q-normal` (the dial with waits), `q-high` and `q-critical` (the bracketed strain
  line, warning then error), `small-s`, `small-pin` and `small-calm` show the HUD dial and skin, and the existing
  `compactStates` asserts still pass; Task 5's steps "Q draws the HUD dial", "Q's strain line wears brackets" and its
  no-filter step pass on Q.

### Task 4: Resources column and panel, title bar, page shell
**Depends on:** Task 1 (imports the `sidecarhud.tsx` parts and `hud-*` tokens)
**Model:** sonnet
**Files:** `frontend/app/cockpit/sidecarresourcecharts.tsx`, `frontend/app/cockpit/sidecarresourcespanel.tsx`, `frontend/app/cockpit/sidecartitlebar.tsx`, `frontend/tauri/sidecar.tsx`, `frontend/tauri/sidecar.html`

The Resources column on `hud-panel`, keeping board A's `hud-line` left border (it divides the column from the wall)
and adding `HudBrackets` (spec "Builder's calls"); section titles `HudLabel`s ("RESOURCES", "ARCTERM", "OTHER APPS >
200 MB"); the CPU/RAM/GPU chart lines become `GlowPath`s (1.5 px core), gridlines `hud-line`, figures
`font-mono tabular-nums`; the process table's figures `font-mono`. The panel the title bar's figures open
(`data-sidecar-resources="panel"`, today `bg-surface-raised` with `shadow-popover-md`) takes the same parts on a
`hud-panel` ground with a `hud-line` border; its popover shadow may stay (floating chrome that does not change on the
beat). Title bar: `hud-bg`
with a `hud-line` bottom border, its title in `font-mono` uppercase letter-spaced `hud-glow`, the machine figures
(`data-sidecar-machine`) in `font-mono` with the strained figure in its status tone; buttons keep their behaviour and
`data-sidecar-btn`. `sidecar.tsx`: the root's `bg-background` becomes `bg-hud-bg` and the waiting state's text uses
`HudLabel` styling. `sidecar.html`: the pre-mount body background becomes `#061218` (the HUD ground; raw hex is right
here, nothing has loaded the tokens yet).

Acceptance:
- `npx vitest run frontend/app/cockpit/sidecarresources.test.ts frontend/app/cockpit/sidecarlayout.test.ts` passes.
- `sidecar-orbit` shots `waiting` (title bar and waiting state) and `p-orbit-dashboard` (the Resources column at
  1920×1080) show the skin; Task 5's step "the title bar's figures open the HUD Resources panel" shows the panel.
- The mono uppercase title must still fit Q's 340 px bar: `sidecar-compact`'s `small-s` step (it asserts the bar's
  `scrollWidth <= clientWidth`) still passes; shorten or truncate the title at the small layout rather than overflow.

### Task 5: Scenarios, RAM watch, changelog
**Depends on:** Task 2 (uses `data-sidecar-needs-col` / `data-sidecar-orbit-cell`), Task 3 (uses `data-hud-dial`), Task 4 (opens the restyled panel)
**Model:** sonnet
**Files:** `scripts/cdp/scenarios-sidecar.mjs`, `frontend/app/cockpit/sidecarorbit.tsx`, `docs/open-issues.md`, `docs/hand-checks.md`, `CHANGELOG.md`

Add steps to the existing scenarios (each `rec(...)` with a clear name, shots under `cdp-shots/`):
- (Folded in by the lead, 2026-11-18, at the person's request after seeing the built wall: P's two top blocks go back
  to the order before this run. In `frontend/app/cockpit/sidecarorbit.tsx` the grid is `3fr / 2fr` again, the orbit
  cell first in DOM and Tab order, then the Needs you column with `pr-6`; every HUD skin change, `dashKey`,
  `selectionAfter` and the `data-*` attributes stay.)
- In `sidecar-orbit`, after the `p-orbit-dashboard` shot: "the wall's Needs you column sits right of the orbit"
  (`[data-sidecar-orbit-cell]`'s rect right ≤ `[data-sidecar-needs-col]`'s left, and the orbit cell comes first in DOM
  order); "the page wears the HUD ground" (the root's computed background equals the resolved `--color-hud-bg`);
  "no filter on the Sidecar page, and the ping is the only infinite animation" (every element's computed `filter` and
  `backdrop-filter` are `none`; `document.getAnimations()` with infinite iterations all have `animationName`
  `sidecarPing`); "the HUD decoration is drawn" (at least one `[data-hud-deco]` and one `[data-hud-glow]`); and
  "HUD idle cost" — `Performance.getMetrics` before and after 10 s idle at 1920×1080, recording LayoutCount and
  RecalcStyleCount deltas, JSHeapUsedSize and Nodes in the step's detail (passes when read; it is the HUD's "after"
  figure).
- In `sidecar-orbit`, a step "the title bar's figures open the HUD Resources panel": at a viewport below
  `RESOURCES_MIN_W` (e.g. 1400×900) click `[data-sidecar-machine]`, then `waitFor`
  `[data-sidecar-resources="panel"] [data-hud-glow]` for up to 15 s before the shot (shrinking closes the column, the
  bridge's `stopResources` clears the history (`sidecarbridge.tsx:234-241`), and a chart line draws only once a series
  has two points, two polls after the panel opens); shoot `resources-panel`, close it, restore `ORBIT_VIEWPORT`. Off
  win32 the chart state is "unsupported": skip the glow wait there the way `taskbarIdStep` skips, still checking the
  panel opens.
- In `sidecar-compact`'s `compactStates`: at `q-normal`, "Q draws the HUD dial" (one `[data-hud-dial]` wrapper
  holding a `[data-hud-deco]` tick ring and `[data-hud-glow]` value rings); at `q-high` and `q-critical`, "Q's strain
  line wears brackets" (`[data-sidecar-strainline] [data-hud-deco]` exists, its stroke the warning tone at high and the
  error tone at critical, compared against the resolved `--color-warning` / `--color-error`); at `small-calm`, the same
  no-filter / ping-only check as P.
Read the merged components for the exact attributes; adjust any existing assertion the swap breaks (none reads
geometry today) without loosening what it checks.

`docs/open-issues.md` "RAM watch": add a "(arcterm) Sidecar HUD skin" row: the static decoration layer, stacked-stroke
glow and no filters; the run reports only the after figure, from the scenario's "HUD idle cost" step (the spec's
"Builder's calls" amends the before/after: no earlier tree has the step); the release-build before/after read
pending (the person's). `docs/hand-checks.md`: a `- [ ] (arcterm)` line to read Sidecar's renderer plus GPU
process on a release build before the HUD and on one with it, each on screen for an hour, against part 3's row. `CHANGELOG.md`: under the top
`Unreleased` section's `Changed` (open `## Unreleased` above a dated top section), one user-facing line: Sidecar now
wears a HUD look, with Needs you on the left and the orbit on the right.

Acceptance: `node scripts/cdp/final-verify.mjs sidecar-orbit sidecar-compact` (the Final) runs the new steps; each
passes against the merged Tasks 2–4. `node --check scripts/cdp/scenarios-sidecar.mjs` passes.
