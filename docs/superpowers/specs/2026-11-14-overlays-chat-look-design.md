# Overlays in the Chat look: the frosted fill

Date: 2026-11-14 · Brainstorm: `.superpowers/brainstorm/overlays-chat-look/brainstorm.json` ·
Initiative: "GUI redesign after the AI-chat references" (`effort 7655bf18-619e-40cf-8805-5f4a6e5ac85e`, chunk
"Overlays in the Chat look: palette, popovers, menus, toasts (one brainstorm, one spec)")

**Prototype:** .superpowers/design/overlays-chat-look/project

The canvas holds one board, `B-todays-scrim.dc.html`: the command palette's panel frosted over today's dialog scrim,
in front of a working agent. Read it for the palette only; the other overlays have no board and follow the rule below.

## Goal

After trying the new Chat, the person decided (chunk 9 of the initiative) that the shared overlays follow its look:
the command palette, popovers, menus and toasts. Of Chat's traits, only the **frosted fill** carries over (answer 1):
`--color-panel` with a static backdrop blur, as Chat's suggestion panel draws today.

## Scope

- In scope: the fill of every overlay panel: the command palette's panel, context menus, popovers, menus (picker
  dropdowns included) and toasts.
- Not changing (answer 1): radius, border, shadow and motion stay as each site has them today; no key-hint line is
  added to any list. Chat's 16px radius, `shadow-popover-soft` and spring motion stay Chat's.
- Out of scope (answer 5): tooltips and the hover title tip (`TOOLTIP_SURFACE` in `element/tooltip.tsx`,
  `element/titletiphost.tsx`) stay solid `surface-raised` chips.
- Out of scope: the other ModalShell dialogs (New agent, the cheatsheet, Quick look…) and sheets, and every other
  surface (the initiative's "Fog: other surfaces" chunk).

## Today

- Context menus: one recipe, `PANEL` in `frontend/app/element/contextmenu.tsx` (8px radius, `edge-strong` border,
  `bg-surface-raised`, `shadow-popover-md`), used from 28 files.
- Popovers: `element/popoverreveal.tsx` owns motion only; its 32 calling files pass their own `className`, with fills
  `bg-surface-raised` (13), `bg-surface` (8) and `bg-modalbg` (2) at the call.
- Toasts: `frontend/app/cockpit/notificationtoasts.tsx:100`, `rounded-lg border bg-surface shadow-popover-md`.
- Palette: `frontend/app/cockpit/command-palette.tsx:1741` renders in `ModalShell` (`modals/modalshell.tsx`), whose
  dialog variant draws the scrim `bg-black/60 backdrop-blur-sm` and the panel on `bg-modalbg`, radius 14px. 31 files
  use ModalShell.
- Chat's frost: `view/agents/pickerlist.tsx:132`, `rounded-[16px] border border-edge-mid bg-panel shadow-popover-soft
  backdrop-blur-[18px]`, under `look: "frosted"`. `--color-panel` is themed: `themes.ts:498` sets it to each theme's
  `surfaceRaised` at 60% opacity.
- `shadow-popover*` appears in 63 tsx files, overlays and non-overlays alike, so it does not mark an overlay.
- Blur cost: `view/orchestrate/dagmodal.tsx:98` drops its blur because WebView2 re-blurs the window every frame
  anything under the blur moves, which stuttered the open.

## Design

### 1. One frost class (answer 4)

- Define the frosted fill once in `frontend/tailwindsetup.css` as a utility (e.g. `@utility frost`): `--color-panel`
  for the fill and a static 18px `backdrop-filter` blur, from tokens only. The blur is never animated.
- Every overlay site swaps its solid fill class (`bg-surface-raised`, `bg-surface`, `bg-modalbg`) for the frost class
  by hand. A caller's own `bg-*` class is removed, not left beside it.
- `pickerlist.tsx:132` uses the class in place of its spelled-out `bg-panel … backdrop-blur-[18px]`.

### 2. Which overlays (answer 2)

- **Context menus:** `PANEL` in `contextmenu.tsx` takes the frost class; its 28 callers need nothing.
- **A real frost, not a nominal one (Agent's call, builder question 1).** An element with `backdrop-filter` (or
  opacity below 1) is a backdrop root in Chromium/WebView2: a frosted panel nested inside it samples only what that
  root paints. Context-menu submenus render inside the parent `PANEL` (`contextmenu.tsx:176`), so they render outside
  it (a portal or a sibling layer) and each level frosts what is behind it. The same check applies to any popover
  nested in another frosted overlay.
- **Popovers:** every `PopoverReveal` caller's panel, and any other absolutely placed floating panel that is a menu or
  a popover. A card, a sheet or a strip that only carries `shadow-popover*` is not an overlay and stays.
- **Menus:** picker dropdowns count as menus, so `PickerList`'s plain look (the launcher, and the lists outside Chat)
  is frosted too. Its plain/frosted split then differs only in placement and radius, not fill.
- **Toasts:** `notificationtoasts.tsx` takes the frost class, measured first (section 4).
- **Palette:** see 3.

### 3. The palette keeps today's scrim (answer 3, board `B-todays-scrim.dc.html`)

The palette stays a ModalShell dialog with today's scrim, black 60% with `backdrop-blur-sm`. Its panel's fill
changes from `bg-modalbg` to the frost class, and the frost must really show, as on the board (builder question 1, the
person's answer).

- In `ModalShell` today the panel is a child of the scrim (`BACKDROP.dialog`, opacity animated by `modalBackdrop`).
  The scrim's `backdrop-filter` makes it a backdrop root, so a frosted child would sample only the scrim's black.
- ModalShell gets a **palette-only variant** (a new `variant` value or prop) in which the scrim is a sibling layer
  behind the panel's positioning container, not its parent. The panel's blur then samples the blurred, dimmed
  cockpit. Escape, Ctrl+Enter, backdrop-click dismiss, focus trap and the open/close motion behave as in the dialog
  variant.
- Only the palette uses the variant; the other 30 dialogs keep today's markup and solid panel.
- Verification adds steps for the variant: the palette opens and closes with its motion, a click on the scrim closes
  it, Escape closes it, and focus stays in it.

### 4. Toasts measured first (answer 2)

The build measures frame time with a toast showing over a streaming agent terminal. If the frosted toast stutters,
toasts keep a solid fill and every other overlay stays frosted.

**Agent's call (builder question 2):** the check compares like with like, not against the fixed 20 ms bar, which main
already misses (p95 26.7 ms, `scripts/cdp/scenarios-chat-redesign.mjs:18-22`). In one run, the same terminal flood
plays with a frosted toast and with a solid toast, 3 passes each; the frost stays if its frame p95 is within 2 ms of
the solid toast's. The builder measures once during the build and commits the fill; the scenario only checks that the
committed fill draws, so the Final never re-decides the fill on a noisy, shared-machine timing.

### 5. Legibility

Check text contrast on the frost over the busiest background (a streaming terminal). DESIGN.md's muted text floor
(4.5:1) applies to the frosted panel as it does to a solid one.

**Agent's call (builder question 3):** the check covers every built-in theme (all are dark; light mode was declined,
`themes.ts:14`), computed for muted text on `--color-panel` composited over the backdrop the blur actually shows. A
theme that misses 4.5:1 gets its `--color-panel` alpha raised in `themes.ts` just enough to pass. Chat's suggestion
panel shares the token and gets the same fix, which only makes it more legible.

**Revised at plan review (2026-11-14):** the backdrop is not the brightest terminal colour itself but what an 18px blur
makes of a screen of it: the theme's terminal background mixed with its brightest terminal colour at **20% coverage**
(monospace glyph ink fills roughly 10-20% of a cell, and the blur averages several cells; the brightest colour keeps
the case conservative). Composited over the bare brightest colour, every built-in theme sat at 1.4-2.2:1 at alpha 0.6
and needed 0.84-0.98, which turns the frost into a solid panel and leaves the board. Measured with the 20% model:
graphite 0.66, claude 0.66, midnight 0.82, slate 0.70, carbon 0.72, nocturne 0.80, spider 0.66, onedark, monokai and
christmas stay at 0.60. The default theme's palette panel is then `surfaceRaised` at 66% where the board drew 60%.

## DESIGN.md

- The frosted panel moves from a Chat-only exception ("Chat's floating box") to a rule for overlays: palette panel,
  context menus, popovers, menus and toasts draw on the frost class; the blur is static.
- Name the two exceptions: the palette keeps the dialog scrim, and tooltips and title tips stay solid.
- Chat's 22px box, its functional fade and its 16px panel radius stay Chat-only.

## Verification

- A CDP scenario (e.g. `overlays-frost`) opens each overlay kind over a working agent and screenshots it: the palette,
  a context menu, a popover (e.g. the Jobs popover), a picker dropdown and a toast. Final runs it.
- The same scenario checks the toast draws the fill the build committed (section 4); it does not re-measure.
- Existing scenarios that open these overlays keep passing.
- `task check:ts` and vitest pass.

## Left to the builder

- Inventory the overlay sites as section 2 says.
- The class's name, and the name and shape of the palette-only ModalShell variant (section 3).
- The toast frame check and the contrast check.
- The DESIGN.md edit and the CDP scenario steps.
