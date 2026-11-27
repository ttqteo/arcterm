# Clickable prototypes: try the flow, swap A/B/C in place, mark feedback on the live screen

Brainstorm: `.superpowers/brainstorm/prototype-feedback/brainstorm.json` (2026-11-27).
Canvas: `.superpowers/design/prototype-feedback/project/` (`D-slot-chip.dc.html`, `A-mode-toggle.dc.html`).

## Problem

When a brainstorm or a design talk shows boards, the person often still cannot picture how the feature plays
out: the boards are static screens, so a flow (open a menu, flip a tab, step to the next screen) has to be
imagined from separate frames. Feedback is hard to give for the same reason. Options A/B/C that differ in one
region are drawn as whole separate boards, so comparing them means jumping between frames and losing the
place you were at.

## Intent (answer 1)

Let the person **try the whole flow** of a feature before it is built: click and see screens change, menus
open and states appear, instead of looking at static screens.

## What exists today (context)

- `CanvasPane` (`frontend/app/view/agents/canvaspane.tsx`) has per-board tabs, zoom and marking: drag a box,
  write a note, send to the agent as one line plus a cropped image saved to
  `.superpowers/design/<topic>/feedback/NNN.png` (`canvasmarks.ts`, `canvassend.ts`). The line is
  `marks on <board>: 1 …` (`canvasHandoffLine`) and says nothing about which screen or variant was showing.
- The `.dc.html` format already supports state, events, `<sc-if>` branches and links between artboards
  (`skills/design/reference/format.md`), and `canvas.json` has `is_interactive`. Each artboard keeps its own
  state (format.md "Links between artboards").
- `data-props` supports an `enum` editor; Arc draws no tweak controls (format.md:115-127).
- `support.js` can override props without rebuilding a board, keeping its state: `setProps(name, overrides)`
  sets `propOverrides` and calls `registry.bump` (`skills/design/support.js:1756-1758`). Its `message`
  listener knows only `__dc_theme` and `__dc_probe` (`support.js:1407-1419`).
- Options that differ in UI are one board per option (`skills/design/SKILL.md` "Options"); the brainstorm
  rail lists them beside the question and ties each to its option row by `optionHoverAtom`
  (`brainstormrail.tsx:77`). Rail tiles are `pointer-events-none` iframes (`brainstormrail.tsx:634`).
- Measured board sizes (271 boards under `.superpowers/design/*/project`): median 10 KB (about 3k output
  tokens), p90 22 KB. A stateful 4–5 screen flow costs roughly 20–30k output tokens, written once; later
  feedback edits are cheap.

## Decisions

### How alive a prototype is (answer 2)

**Stateful screens.** Inside one screen, menus, tabs, toggles and inputs work and change state; screens link
to each other. No motion between states and no reactive fake data (add, delete, typing that updates lists).

### A/B/C inside the prototype: variant slots (answer 3)

An option question whose options differ in one **region** of a screen is drawn as **one** prototype with a
**variant slot** on that region: the agent marks the region as a slot with one branch per option. Arc
overlays a floating **A/B/C chip** right on the slot region, like swapping a component instance in Figma.
Picking a letter swaps only that region; the rest of the screen, and the screen the person has navigated to,
stay as they are. Board: `D-slot-chip.dc.html`.

**A prototype is one frame with one child file per screen (answer 6; was an agent's call on builder question
1):** a main board holds the shared state and the slots; each screen is a child `.dc.html` mounted with
`<dc-import>` (format.md:152), so editing one screen reads only that screen's file (2–4k tokens) instead of a
whole prototype that grows to 10–20k tokens and then sits in context for every later turn. Each screen
declares a screen name (a new attribute), and the board reports the current screen to Arc through a new
`support.js` message. Child files are listed in `canvas.json` too, as format.md requires. Links between artboards keep working for static boards but carry no slot picks. A slot
pick holds across the whole prototype: a slot with the same id on another screen keeps the chosen letter.

**Chip and option rows (builder question 3):** in a brainstorm, picking a chip letter only previews: it swaps
the variant and highlights the option row with the same letter (as `optionHoverAtom` does today). The answer
is still given by picking the option row. **Agent's call:** under an opened board, the single "pick this
option" becomes "pick the option whose letter the chip shows".

**Agent's call (builder question 3, mapping):** each brainstorm question ties to exactly one slot; other slots
on the board are preview-only and map to no option row.

### Feedback on a live prototype: two modes (answer 4)

A toggle on the prototype's frame switches between **Bấm thử** (try: clicks run the prototype) and **Góp ý**
(feedback): in feedback mode the prototype freezes and a drag draws a mark box with a note, as marking works
today. Board: `A-mode-toggle.dc.html`.

**Agent's call (builder question 4):** the toggle **replaces today's Mark button** in `CanvasPane` and the
brainstorm rail (`canvaspane.tsx:185`, `brainstormrail.tsx:720`) and keeps its key `m`; no `C` key (`c` is
already bound on several surfaces in `bindings.ts`). A static board shows only Góp ý, as Mark today; the Bấm
thử half shows on `is_interactive` boards. One marking UI, not two.

### When the agent draws a clickable prototype (answer 5)

The agent decides per question: a question about a **flow, state or interaction** (a menu, several steps, a
toggle) gets a clickable prototype; a question only about **layout or look** gets static boards. The person
can still ask for a prototype when the agent chose static.

### Feedback carries its context (confirmed)

Each mark line sent to the agent also names the screen the person was on and the variant picked in each
slot, for example `marks on Later.dc.html, màn "Để sau", khe danh sách = B: 1 …`. **Agent's call (builder
question 1):** the screen is named by its declared name, not a position like "2/3".

**Marks across screens (builder question 5):** unsent marks are kept when the person switches to Bấm thử,
navigates to another screen or swaps a variant. Each mark remembers the screen and slot picks it was drawn
on (the board is captured when the mark is drawn). One send makes one cropped image per screen that has
marks, and the handoff line gives the context for each group of marks. The A/B/C chip is Arc's overlay,
so the cropped image does not capture it.

### Where it runs (confirmed)

Try mode and slot chips work everywhere a board opens large: the brainstorm rail's Boards when a board is
opened, `CanvasPane`, and the Canvas gallery. Feedback mode is only where an agent is attached (the brainstorm
rail and `CanvasPane`); the Canvas gallery has no Góp ý, since it is tied to no agent (builder question 2:
`canvasgalleryview.tsx:828` keeps `marking: false`). Small thumbnails stay static and take no pointer
input. It applies in plain chat sessions as well, not only inside `arc:brainstorm`.

## Left to the builder

- The slot syntax in `.dc.html` (a new attribute documented in `format.md` and understood by `support.js`),
  and how Arc learns each slot's position inside the iframe to place its chip (a new `message` type beside
  `__dc_theme` / `__dc_probe`).
- Swapping a variant keeps the current screen's state (`setProps` or an equivalent path that does not rebuild
  the board).
- New Options rule in `skills/design/SKILL.md` and the board-to-option pairing in `brainstormmodel.ts`.
  **Agent's call:** keep two paths: options that differ in one region → one board with a slot whose
  letters map to the question's option rows; options that differ in the whole screen → one board per option
  as today.
- A section in `arc:design` telling the agent when to draw clickable (answer 5), and how to ask for one.
- Screen child files are artboards in `canvas.json`: the Canvas gallery, the rail's board-per-option pairing
  and "the canvas as a spec" (a scenario step per `.dc.html` in `project/`) must treat them as parts of their
  prototype, not as separate boards or options.

## Builder decisions (lead, 2026-11-27, autonomous run)

Each decision below settles an item "Left to the builder" or a gap the code reading found; the why follows each.

### Syntax in `.dc.html`

- **Screen:** the root element of a screen's child file carries `data-dc-screen="<name>"` (the name in the
  design's language, e.g. `data-dc-screen="Để sau"`). The current screen is the first `[data-dc-screen]`
  element in document order that has a box (`getClientRects().length > 0`); none means no screen. Why: a
  plain attribute survives support.js's template walker onto the DOM and claude.ai ignores it.
- **Slot:** a real box element (never `display: contents`, which has no rect for the chip) carries
  `data-dc-slot="<id>"` and optional `data-dc-slot-label="<label>"` (default: the id). Its direct children
  with `data-dc-variant="<letter>"` are the variants, letters in DOM order (`A`, `B`, `C`…). With no pick the
  first variant shows. Why: attributes keep the board a valid DC for claude.ai, which shows every variant
  stacked (format.md says so); that is acceptable, since the swap is Arc's feature.
- **Prototype layout:** the main board holds the shared state (`screen` in `state`) and mounts each screen with
  `<dc-import name="Later" go="{{ go }}">` inside its own `<sc-if>`; a screen navigates by calling a callback
  prop. Each child file is listed in `canvas.json` with `"part_of": "<main board file>"`; the main board has
  `"is_interactive": true`. Why: one explicit field in the index, read by both Arc's TS and Go sides, is the
  single source of "this file is a screen of that prototype".

### Arc learns slots and swaps variants: in arcterm's injected board script, not in support.js

wavesrv already appends a script after every board page it serves (`pkg/canvasserve` `heightScript`, which
reports `arc-canvas-height`). That script, moved to an embedded `pkg/canvasserve/boardscript.js`, also:

- posts `{type: "arc-canvas-proto", screen: string|null, slots: [{id, label, letters: string[], picked: string,
  rect: {x, y, w, h}}]}` to the parent on load and whenever it changes (MutationObserver on the body subtree,
  attributes included, plus ResizeObserver; one rAF per burst; sent only when the JSON differs from the last
  one sent). `rect` is the slot's first visible element in page CSS px; `picked` is the letter showing.
- applies `{type: "arc-canvas-slot-pick", picks: {[id]: letter}}` from the parent by rewriting one `<style>`
  in `<head>`: a default rule hides every variant after the first in each slot not picked, and for each picked id
  a rule `[data-dc-slot="<id>"] > [data-dc-variant]:not([data-dc-variant="<L>"]) {display: none !important}`.

Why here: it works with every canvas's copy of `support.js` (each canvas has its own old copy), swaps without
re-rendering anything, so the screen's state is kept for free; a pick by id holds on every screen of the
prototype, including screens mounted later; and fixture boards for the CDP scenarios can be plain HTML.
support.js changes only if its walker turns out to drop `data-dc-*` attributes (spec said "understood by
support.js"; this equivalent path is the deviation, recorded).

### Arc side

- **Picks have one owner:** a jotai atom per board keyed by the board's URL without query or hash (the serve
  token is stable per folder, so the gallery and the agent's pane share picks). The frame posts the whole map
  to the iframe when it changes, and again whenever a report shows a slot whose `picked` differs from the stored
  pick (the board reloaded after an edit).
- **Chips are drawn by `BoardFrameView`**, which all three large views share (CanvasPane, the rail's opened
  board, the gallery viewer): no call site changes. A chip sits on the slot's top-right edge, straddling it as
  in board D; hovering the chip outlines the slot region dashed. Chips stay clickable in Mark mode (above the
  mark layer, and a press on one starts no mark). Rail tiles and gallery thumbnails don't use BoardFrameView
  and stay static.
- **Copy stays English**, as all of arcterm's UI: the toggle reads **Try | Mark** (Mark is today's word and key
  `m`); the sent line reads `marks on Later.dc.html, screen "Để sau", slot danh sách = B: 1 …`. Screen and slot
  names come from the board in the design's language. Why: arcterm has no Vietnamese UI (initiatives decision of
  2026-10-13), and Bấm thử/Góp ý were the brainstorm's working names.
- **Try** on an interactive board in the rail removes the click-to-close cover over the opened board (close stays
  on X and Esc). A static board keeps the single Mark button and the cover, as today.
- **Marks keep their context:** each mark stores its `MarkContext` (screen + each slot's id, label and
  letter at draw time) and a clean picture of the board: when a mark is drawn, the frame gets
  `data-canvas-capturing`, every Arc overlay in it (marks, draft, chips, the layer's outline) hides for that
  frame, the window is captured and cropped to the board's visible part, then the overlays come back. At send,
  marks are grouped by context in order of first appearance; each group's newest picture gets the group's boxes
  and numbers drawn onto it (accent color read from the theme token) and is written as its own `NNN.png`; one
  line names each group's picture and context, groups joined by ` | `. Why compose at send: removing a mark or
  renumbering after the capture never leaves a stale box in the picture.
- **Marks survive Try:** turning Mark off keeps unsent marks (today it drops them); the tray shows while marking
  or while any mark is unsent. Switching to another board, closing the rail's board dialog, and leaving the
  canvas still drop them, as today. The mark layer draws only the marks of the context on screen; numbering
  is across all marks; the tray names each mark's context when marks span more than one.
- **Header readout** in CanvasPane's meta line: `<screen> · <slot label> <letter>` before the time and zoom.
- **Brainstorm mapping:** a question ties to a slot with a new optional `question.slot` (the slot id) in
  `brainstorm.json`; option *i* is letter *i*. A chip pick on that slot in the rail's opened board previews:
  it sets `optionHoverAtom` to that option. The opened board's pick bar offers the option whose letter the chip
  shows. Slots not named by the question map to no option. Why a field: guessing the slot from counts is the
  kind of guess `railBoardHeads` already refuses.
- **Screens are parts, not boards:** `boardsFromCanvasJson` drops entries with `part_of` (so tabs, the gallery
  viewer and the rail never show a screen as a board), the Go gallery listing (`pkg/storage/canvases.go`) leaves
  them out of a canvas's boards, the skill tells the agent never to list a screen file in a part's `boards`, and
  the plan reviewer's board item excepts a file with `part_of` (the prototype's step covers it).
