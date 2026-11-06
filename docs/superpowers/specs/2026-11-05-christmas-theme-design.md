# Christmas theme

A new theme preset, **Christmas**, that brings a palette and a set of seasonal effects: snow over the window,
a string of lights under the app bar, Christmas decorations in the Office, and a Santa hat on the pet. It follows the
Spider theme's model (`frontend/app/view/agents/themedecor.ts` + `themedecorview.tsx`): a palette in `THEMES`, plus
decor that shows only while its preset is active.

Brainstorm: `.superpowers/brainstorm/christmas-theme/brainstorm.json`. Prototype board (palette and layout):
`.superpowers/design/christmas-theme/project/A-forest-gold.dc.html`. Motion spikes:
`.superpowers/design/christmas-theme/spike/snow.html`, `spike/lights.html`.

## Background

- A theme today is a palette only: a `ThemeDef { id, name, palette }` in `frontend/app/view/agents/themes.ts`.
  `buildThemeVars` maps it to the `--color-*` overrides that `themestore.ts` writes on `document.documentElement`.
- The Spider theme also has decor. `hasSpiderDecor(preset)` decides when it shows, and `themedecorview.tsx` draws
  `SpiderMark`, `TreeSpider`, `HeroSpider` and `PanelWeb`. Every piece is `aria-hidden` and `pointer-events-none`,
  and none of them loops: the spider drops once, then hangs still.
- The Spider palette's own comment notes that a red accent "glared across the whole UI". So red stays in the decor
  there, and error turns pink so that a failure never reads as decor.
- DESIGN.md says motion is functional-first, honors `prefers-reduced-motion`, and never uses an infinite CSS
  animation. The status-dot pulse is drawn at 12fps by `element/pulsedriver.tsx`, which is always mounted in
  `cockpit/cockpit-root.tsx`.
- The Office (`cockpitoffice.tsx`) is pixel art seen from above. The static building is drawn on two canvases
  (`office/scenery.ts`), people are cached sprite `<img>`s (`office/plansprite.ts`), and each project room has up to
  two plants (`officeplanmodel.ts`, `plants`). People wear outfits through `jarvis/petoutfit.ts` (`vn-shirt`,
  `vn-flag`).
- The user's reference palette is `#1A2821` forest, `#3E5647` moss, `#28604C` emerald, `#A0061B` crimson and
  `#B27F49` antique gold. On `#1A2821`, the crimson reaches 1.85:1 and the gold 4.39:1, both below the 4.5:1 text
  floor. For text they are lifted: gold to `#d4a26a` (6.7:1) and crimson to `#ee6170`. The raw crimson works as a
  fill behind white text (8.27:1) and as decor.

## Decisions

### Activation

The effects come with the preset. Choosing **Christmas** in Setup → Theme turns on the palette and every effect below;
no other preset gets any of them. A **Turn off effects** switch next to the preset keeps the palette and drops all
motion and decor. `prefers-reduced-motion` stops only the motion, the snow and the blink. The static decor still
shows: trees, hats, gifts, the wreath and the lights, lit and still. The Spider theme keeps its spider under
reduced motion in the same way. *(Agent's call, builder question 1.)* The pure model therefore has two gates:
`decorOn` (preset is Christmas and effects are not turned off) and `motionOn` (`decorOn` and reduced motion is off).
Every static piece keys off the first gate, and the snow and the blink off the second.

### Palette

The palette is built from the reference: forest ground, moss edges, an antique-gold accent. Red is kept for the decor
(bulbs, hats, gifts, the wreath), never the accent, and error stays the familiar red-pink.

| Role | Value | Role | Value |
|---|---|---|---|
| bg | `#0a100d` | text | `#f2ead9` |
| surface | `#0f1814` | secondary | `#d2cbb8` |
| surfaceRaised | `#16241d` | muted | `#a8b3a4` |
| surfaceHover | `#1a2a22` | inkFaint | `#86958a` |
| surfaceSelected | `#21342a` | accent | `#d4a26a` |
| code | `#070b09` | success | `#7cc98e` |
| border | `#1a2922` | warning | `#f0904a` |
| edgeMid | `#22362b` | error | `#ff6f7d` |
| edgeStrong | `#32493a` | ansiBlue | `#88b4dc` |
| edgeFaint | `#14211a` | | |

`surfaceHover`, `edgeMid` and `edgeFaint` were not on the board; the values above are interpolated between their
neighbours. Decor colours are new tokens alongside the `--color-spidey-*` ones: crimson `#A0061B` for fills (hats,
ribbons) and `#d0283c` for lit bulbs; pine green for the trees; the accent gold for the star. There is no `claudeMark`,
because the accent is not Claude's clay. The palette must pass the DESIGN.md contrast floor, and `themes.test.ts`
guards it the way it guards the other presets.

### Snow

Snow falls over the whole window, terminals included. A flake that lies over a terminal is drawn at about half its
opacity so the log stays readable.

How it is drawn: one `<canvas>` (`pointer-events-none`, `aria-hidden`) is mounted next to `PulseDriver` in
`cockpit-root.tsx`. Its 12fps clock runs only while the Christmas preset is on, effects are not turned off, the
window is not hidden (`document.hidden`) and reduced motion is off. Each frame it reads the rectangles of the visible
`.term-connectelem` elements (`view/term/term.tsx`); a flake inside one of them is drawn at reduced opacity. Flakes
are small and faint, since they cross text in the agent tree and the sidebar. The canvas stops while the window is
folded into Float or Sprout. The rule that sets a flake's opacity from the terminal rectangles is pure and
unit-tested.

### App bar lights

A string of red, gold, green and cream bulbs runs along the inside of the app bar's bottom edge, behind the bar's
controls (it first hung below the bar, where its bulbs sat on the headers' buttons and made them look disabled).
Normally the bulbs are lit and still, so they cost no frames. When an agent needs you (the same signal as the Cockpit nav badge, `navrail.tsx`), the
string blinks in the `asking` colour until nothing is asking. The blink is driven by a `PULSES` class
(`element/pulse.ts`) that `PulseDriver` already ticks at 12fps, not by a CSS animation. Under reduced motion it stays
lit in `asking` without blinking.

### Office

All of these are static sprites, drawn when the Office's theme epoch changes (`useThemeEpoch`):

- Every room plant becomes a small Christmas tree with lights and a star, at the plant's existing positions.
- Agents, the boss and the pet wear Santa hats in every pose (sit, walk, doze, back, the Spidey poses). For the pet
  and the boss, the hat is an outfit that replaces the Vietnam outfit (see Beyond the Office).
- Gifts lie under each room's tree: one box for every agent that has `finished` and every `done` task of the runs at
  the room's tables. At most six boxes are drawn: four on the floor and two stacked on top. From the seventh job on,
  no more boxes are added, so the space the boxes take beside the tree stays fixed. *(Agent's call, builder
  question 3.)* Gifts leave with their agent or run. The count, clamped to 6, is pure and unit-tested.
- A red and green wreath hangs on the notice board.

### Beyond the Office

The pet wears its Santa hat everywhere it appears: Sprout when the window is folded, the pet corner, and Jarvis. The
`t>` mark and the no-terminal hero stay as they are.

While the Christmas decor shows, the hat **replaces** the outfit for the pet and the Office boss: no Vietnam shirt
and no flag in hand, flag days included. When the theme or its effects are turned off, the outfit from Settings →
Appearance comes back. The hat is a new `PetOutfit` value (`jarvis/petsprite.ts`), chosen ahead of the Settings
choice in `petoutfit.ts`. It is drawn only over the plain poses, never over the dressed grids. *(Builder question 2.)*

## Left to the builder

- Pixel art for the tree (replacing the plant sprite), the Santa hat for every person and pet pose (Spidey
  included), the gift box and the wreath.
- 16 ANSI colours derived from the palette, at the contrast floor.
- The **Turn off effects** switch: its name, its storage (next to the preset in `themestore.ts`) and its row in
  Setup → Theme.
- A pure model in the shape of `themedecor.ts` (when Christmas decor shows, the gift count, flake opacity from the
  terminal rectangles), with tests beside it.
- A CDP scenario in `scripts/cdp/scenarios.mjs` that captures the cockpit with Christmas on, the Office with trees,
  hats, gifts and the wreath, and the lights while an agent is asking.
- Measure the snow canvas's CPU and RAM, and log the numbers in `docs/open-issues.md` "RAM watch".
- One `CHANGELOG.md` line under `Added`, and a `docs/hand-checks.md` line for the WebView2 look.

## Changes made while planning (2026-11-05, plan review round 1)

- **A tree in a room with no plant.** A busy project room (desk row full, a run at its table) has no plant, and it is
  the room that earns gifts. So the plan model gives every project room a tree spot while one is free: the room's
  first plant, else a spot that overlaps no desk, seat, table, door or chip. A room with no free spot draws no tree and
  no gifts. Every plant is still drawn as a tree.
- **Where the pet's hat shows.** Sprout, the pet corner, Jarvis, the Office (pet and boss), and every pose there,
  Spider-Man's web hang and crawl included. The fold button's small sprite in the app bar and the What's new sheet's
  pet stay as they are: both draw the pet with no outfit today, the Vietnam shirt included.
- **The effects switch** is a plain control under the theme chips in Settings → Appearance, not a registered setting
  row, so it shows only while Christmas is the preset.

## Changes after it shipped (2026-11-05, the decor beyond the Office)

The person asked for the decor in more places, starting from the New agent dialog, where only the palette showed.

- **Snow over dialogs.** The snow canvas moves from z-45 (under every modal) to z-75: above ModalShell's z-70 backdrop,
  below the z-80 popovers. A flake over an open dialog's panel (`[role="dialog"][aria-modal]`) is halved as over a
  terminal. This replaces "below popovers and modals" in Snow above.
- **Lights in dialogs.** `ModalShell` takes `christmasLights`: the string hangs from the panel's top edge, lit and
  still, only in a dialog whose header leaves its 16px clear (New agent, New project, Keyboard shortcuts, Quick look).
  The lights also hang along the Christmas effects row in Settings → Appearance.
- **More hats.** The nav rail's hat goes on New agent's Start column marks and on the cockpit's "No agents running"
  window glyph. The Christmas theme chip always wears one, as the Spider chip shows its spider.
- **The pet's hat in two more places.** The fold button's sprite in the app bar and What's new's pet now wear the
  Santa hat while the decor shows, which reverses "stay as they are" in the plan review above. They still wear no
  other outfit.
- **Gifts for finished runs.** A run's Complete check in the agent tree becomes a gift while the decor shows; an
  unverified run keeps its check.
- **A pine in the Agent rail's Overview.** In the bottom right corner of the Agent details rail's Overview tab
  (`CollapsibleRail`'s footer: in the corner while the sections leave room, after them once they scroll), a small
  pixel pine drawn after the Office lobby's tree of the Christmas tree game (`.superpowers/design/christmas-tree-game`): four
  tiers in alternating shades, red and gold baubles, one rare cream piece, a gold star (`christmasrailtree.ts`). It
  is static and drawn full: the game's season count is not built, and when it is, the rail pine is the place to show
  the lobby tree's stage.
