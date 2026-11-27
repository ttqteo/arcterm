---
name: design
description: Make a multi-artboard .dc.html design canvas locally, in a gitignored scratch folder, in the Claude Design format. Use when the user asks to /arc:design (or /design-local) something, or for a UI mockup or prototype of a new screen or a redesign, and whenever you are about to draw a UI mockup (ASCII included) or offer the user options that differ in UI, in any session.
---

# Design, local

A design canvas you write to a scratch folder and serve to the user's browser. It is scaffolding:
it settles a design before code, and once the feature ships the code is the design. So a canvas
lives outside git and is deleted when its feature lands. Nothing is published to claude.ai.

## When to use

Decide per question, not per session: would the user understand this better by seeing it than
reading it? Layouts, visual options side by side, states of a screen, polish: draw it. This holds
in a plain chat as much as in a brainstorm. Whenever you are about to draw a UI mockup, or ask the
user to choose between options that differ in UI (a layout, where something sits, a click flow),
draw boards (**Options**, below), never ASCII boxes in your reply. A small mockup
that fits in a few lines (a status line, one button, a label) is the exception: first ask "draw a
board, or keep it as text?". Scope, trade-offs and conceptual choices with no layout stay in the
terminal: a question about a UI topic is not automatically a visual question.

## Clickable or static

Once you draw, decide per question whether the person should be able to click through it:

- **A flow, a state or an interaction** (a menu that opens, steps in order, a toggle or tab that
  changes what the screen shows): draw a **clickable prototype**. The person tries it in the pane
  (**Try**) and leaves feedback on the live screen (**Mark**); a flow shown as separate frames has
  to be imagined.
- **Layout or look** (where things sit, density, hierarchy, color, type): static boards.
- A prototype costs several times a static board (a four- or five-screen flow is roughly 20–30k
  tokens of output, written once), so draw one for a question that is about the flow, not to dress
  up a layout choice.
- **The person may ask for one.** When they ask to try it, or for a clickable version, draw the
  prototype on the same canvas even where you chose static boards.

A prototype is stateful screens: menus, tabs, toggles and inputs work and change state, and screens
link to each other. It has no motion between states and no reactive fake data (add, delete, typing
that updates a list); a change whose motion matters gets a board of its own that plays it
(`reference/craft.md`, Motion). It is a main board plus one child file per screen;
`reference/format.md` ("Prototypes and variant slots") has the rules and the full markup. A small
one, three files:

```
project/
  Main.dc.html     state: screen; mounts each screen in its own <sc-if>, passes go="{{ go }}"
  Inbox.dc.html    root: data-dc-screen="Inbox"; a button calls this.props.go?.('snoozed')
  Snoozed.dc.html  root: data-dc-screen="Snoozed"; holds the slot data-dc-slot="list", variants A and B
```

and their entries in `canvas.json` (`boards` and `order`):

```json
{
  "boards": {
    "Main.dc.html": {"x":0,"y":0,"w":880,"h":560,"title":"Inbox flow, clickable","is_interactive":true},
    "Inbox.dc.html": {"x":960,"y":0,"w":880,"h":560,"title":"Inbox screen","part_of":"Main.dc.html"},
    "Snoozed.dc.html": {"x":1920,"y":0,"w":880,"h":560,"title":"Snoozed screen","part_of":"Main.dc.html"}
  },
  "order": ["Main.dc.html","Inbox.dc.html","Snoozed.dc.html"]
}
```

Arc shows that as one board: a `part_of` file is no tab, no gallery board and no option of a
question. In your reply say that the board is clickable and name its screens.

## Starting a canvas

1. Before naming `<topic>`, list the canvases already there: the `title` in each
   `.superpowers/design/*/project/canvas.json`. `<topic>` is a short kebab-case name from the brief;
   `<root>` is `.superpowers/design/<topic>/project/` in the working directory.
2. When the new canvas redraws a screen one of those designed, it is that canvas's next version: write
   `"replaces": "<that topic>"` in the new `canvas.json` at once, naming the newest canvas of that screen (one no
   other canvas's `replaces` names yet: versions form a line, never a fork). Say one line in your reply ("this canvas
   replaces `<topic>`"; the person undoes a wrong link with × in the gallery viewer's header). A new question about
   the same feature adds boards to its canvas (**Options**) instead.
3. `git check-ignore -q .superpowers/design`. Not ignored: tell the user and ask to add
   `.superpowers/` to `.gitignore` before writing anything.
4. Copy `support.js` from this skill's directory to `<root>/support.js`, so each artboard's
   `./support.js` line resolves.
5. Read the design system (below) before choosing any look.

## The loop

1. Write every artboard and `canvas.json` for the change in ONE message, with the Write tool.
2. Inside arcterm (`wsh` is on PATH), run `wsh ui reveal canvas:<topic>` from your terminal. arcterm
   serves the folder itself and attaches the canvas to you on the Agent surface without switching
   the user to it; they open it when ready, mark it, and send the marks back to you as one line.
   Start no server. If the command fails or `wsh` is missing, serve the folder yourself, on
   `127.0.0.1`, never `localhost` (on Windows it can resolve to a different listener). Probe from
   port 8766 up:
   `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<port>/<topic>/project/Main.dc.html`.
   - `200`: already served; use this port.
   - `000` (nothing listening): run
     `python -m http.server <port> --bind 127.0.0.1 --directory .superpowers/design` in the
     background and probe again until `200`.
   - Any other code: a stale server with another root holds the port; try the next one.
   One server serves every topic.
3. Tell the user which artboards you added or changed, `Main.dc.html` first, with a line on what
   each shows and the assumptions you made. Outside arcterm, give each one's URL
   (`http://127.0.0.1:<port>/<topic>/project/<Name>.dc.html`). When the brief asks for states,
   derive the state list from the component and its stores, not the brief, and map each state to
   the artboard that draws it; name any state left undrawn. End your turn.
4. On feedback, read the files you will change, edit them in place, and go back to step 2. Small
   requested changes stay small. A mark line from a prototype names a screen and each slot's letter
   (`screen "Snoozed", slot list = B`): the screen is its `data-dc-screen` value, so search `project/`
   for it to find the file, and change that screen's file, not the whole prototype.

Hand over and stop. Render, screenshot or re-read the files only when the user asks.

## Options

When a choice is between options that differ in UI, take the path that fits how much they differ:

- **They differ in one region of a screen** (a list, a header, a card): ONE board, with a variant slot
  on that region and one variant per option, in the order of the options (`data-dc-variant` `A`, `B`,
  `C`…; syntax in `reference/format.md`, "Variant slots"). Arc puts an A/B/C chip on the region, so the
  person flips between the options in place and keeps their spot in the screen. Name the file for
  what it shows (`Inbox.dc.html`; a prototype's main board is `Main.dc.html`), give it a `title`
  that says the region and the letters (`Inbox: the list, options A–C`), and put it first in
  `order`. In a prototype, open the main board on the screen that holds the slot. Draw no chip or
  switch of your own.
- **They differ in the whole screen**: one artboard per option, named by its label: `A-<slug>.dc.html`,
  `B-<slug>.dc.html`, …, `title` `Option A: <what it is>`, and in that order in `canvas.json`'s `order`,
  so the labels, the files and the order agree. The options lead the canvas; they need no
  `Main.dc.html`.
- Either way, every option draws the same content: they differ in layout and treatment only
  (**Designing well**).
- In a plain session, `<topic>` names the feature under discussion (`council-rooms`), not the
  question; a later question about the same feature adds its boards to the same canvas.
- Draw, run `wsh ui reveal canvas:<topic>` as **The loop** says, then ask the question in your reply,
  one line per option led by its label (its letter on a slot), and end the turn. The user answers
  with the label.
- Once the user picks, on the board-per-option path move the boards of the options not chosen to
  `.superpowers/design/<topic>/unchosen/`, beside `project/`, and drop their entries from
  `canvas.json` (`boards` and `order`). The files stay on disk but leave the Canvas gallery, and no
  run reads them as its spec (**The canvas as a spec**). On the slot path rewrite the board without
  the slot instead: keep the picked variant's markup, delete the other variants and drop the
  `data-dc-slot` and `data-dc-variant` attributes.
- In an `arc:brainstorm`, its **Options as boards** rule lists the board or boards on the question's
  part: one board per option in the options' order, or the one board with the slot, whose id the
  question names in `question.slot`.

## Cleaning up

Keep a canvas after the feature it designed ships, unless `wsh canvas policy` prints
`delete-on-ship`: then delete its `.superpowers/design/<topic>/` folder in the same session. On
`keep`, an error, or no `wsh`, keep it. When the person asks to tidy up, list the topics whose
feature has shipped (folder, last change, what shipped it) and delete only the ones they pick;
they can also clean up in arcterm's Agent → Canvas gallery. A canvas is never committed.

## The canvas as a spec

A canvas can settle a run's design: Build this… on the canvas, or a plan's `**Prototype:**` line,
makes the plan reviewer read it as the spec and the final verifier check the built UI against
every board; the reviewer wants a scenario step for every `.dc.html` in `project/`, whatever its
title, except a screen file (its entry has `part_of`), which its prototype's step covers. So before
a canvas becomes a spec, move the boards of the options not chosen to `unchosen/` and drop them
from `canvas.json`, and collapse a slot to the picked variant (**Options**): each board left in
`project/` then shows one screen or state the built UI can reach, and its `title` says which.

## The design system

A repo design doc (`DESIGN.md` or the like) and its token source ARE the design system: read the
doc in full, do's and don'ts included, and match it over any craft guidance. Copy token values
from the token source itself (e.g. `@theme` in a Tailwind CSS file), never from memory or an
older canvas. When an artboard redraws a screen or component that already exists, read its source
and copy sizes, spacing, icons and primitives (buttons, toggles, key chips) from its classes: the
doc gives the rules, the code gives the numbers. With no design system, commit to a small one:
1–3 typefaces (a distinctive display face over a refined body face), a toned neutral ground, 0–2
accents sharing chroma and lightness. State the look you chose in a line.

## The files

- **`<root>/canvas.json`**, the index, which keeps the canvas importable into claude.ai Design:
  `{"v":3,"createdOnFiles":{"v":1,"at":"<now, RFC 3339>"},"title":"<canvas name>","replaces":"<older topic, if it redraws one>","notreplaces":[],"launch":{"view":"canvas"},"pages":[],"boards":{"Main.dc.html":{"x":0,"y":0,"w":1440,"h":900,"title":"<what it shows>"}},"order":["Main.dc.html"],"notes":{},"designSystems":[]}`.
  One `boards` entry and one `order` slot per artboard, `Main.dc.html` first. `x`,`y`,`w`,`h` are
  the frame in CSS px: 80 px between frames in a row, 120 between rows. Add `"is_interactive":
  true` to an artboard with working controls (a prototype's main board), `"part_of": "<main board
  file>"` to a prototype's screen file, and `"expand": "fill"` to a fluid one. Arc reads the frame,
  `title`, `order`, `is_interactive`, `part_of`, `createdOnFiles.at`, `replaces` and `notreplaces`;
  the other keys take effect when the canvas is imported into claude.ai Design. A prototype's screens
  follow their main board in `boards` and `order`. `at` is when the canvas was made (Arc orders
  versions by it): set it once, never on a rewrite. Leave `replaces` out unless
  the canvas redraws an older one (**Starting a canvas**); `notreplaces` lists the topics the
  person said are not older versions of this canvas: Arc writes it, you keep it. When revising,
  keep every key you are not changing, those two included: the gallery's Link and × write them
  too, so read the file before you rewrite it.
- **`<root>/<Name>.dc.html`**, one self-contained file per artboard. Names start with a letter,
  digit or `_`, then only those and `.` `-`; no spaces. Sizes: desktop 1280–1440 wide, phone
  390×844.
- An image or font an artboard uses goes under `<root>/` and is linked by a relative path.

## One artboard: the skeleton

Its grey is a placeholder: the look comes from the design system.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Spring Menu</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
body{margin:0}
a{color:#666}a:hover{color:#333}
</style>
</helmet>
<div style="width: 880px; height: 560px; box-sizing: border-box; padding: 64px; display: flex; flex-direction: column; gap: 24px">
<h1 style="margin: 0; font-size: 56px; color: {{accent}}">Spring Menu</h1>
<div>Pea soup</div>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"accent":{"editor":"color","default":"#666666"},"$preview":{"width":880,"height":560}}'>
class Component extends DCLogic {
renderVals() {
return { accent: this.props.accent ?? '#666666' };
}
}
</script>
</body>
</html>
```

Rules that bite (each fails silently):

- Keep the `<script src="./support.js"></script>` head line exactly.
- Close every non-void element and quote every attribute.
- Root: fixed at the board's `w`×`h` for a device mockup, poster or print piece; fluid for a
  page or app screen (no px width, a `max-width` container, %/rem/fr; at narrow widths menus
  stack, toolbars wrap and wide tables scroll in a box), with `"expand": "fill"` on its board
  entry and `h` its height at `w`. `$preview` is `w`×`h` either way.
- Inline `style="…"` for the design; `<helmet><style>` only for page basics and `a`/`a:hover`.
- Lay out sibling groups with flex or grid plus `gap`.
- `{{hole}}` is a dotted lookup into `renderVals()`, never an expression.
- Always include the `<script type="text/x-dc" data-dc-script>` block: classic JS,
  `class Component extends DCLogic`, no imports.
- All UI is `<x-dc>` markup (`<sc-for>`, `<sc-if>`, `<dc-import>`), never script-built.
- `data-props` (single-quoted JSON) declares tweaks, which are levers, not copy.
- Network: only a Google Fonts `css2` `<link>` in `<helmet>`. Icons: inline stroke SVG.
- No `<iframe>`, `<object>`, `<embed>` or global keydown handlers.

Events, state, repeats, branches, child components, links between artboards
(`<a href="Other.dc.html">`), prototype screens and variant slots: `reference/format.md`. Read it
before a first artboard.

## Designing well

The long form, for pushback on a design call or a specific kind of piece: `reference/craft.md`.

- Real copy; a missing fact becomes a placeholder like `[RUN NAME]`. No lorem ipsum, invented
  stats or filler. Include at least one detail only this subject has (its real units, terms or
  data shapes), as content, not ornament.
- Rationale and option notes go in your reply; an artboard's `title` names what it shows.
- Options differ in layout and treatment of what the brief asks for. A control, step or section
  the brief did not ask for is a question in your reply, not an artboard. Start from the simplest
  design the brief allows: no multi-step flows, merged controls or extra variants unless asked.
- When an artboard redraws an existing screen, every piece of information it shows today (cost,
  time, tokens, counts) stays visible. Moving one behind a tooltip or dropping it is a question in
  your reply, not a design choice.
- Plain surfaces: no gradient washes, left-border cards or emoji; no Inter, Roboto or Arial.
- With no design system, avoid the looks AI design clusters around: warm cream with a serif
  display and a terracotta accent; near-black with one acid-green or vermilion pop; broadsheet
  hairline rules over dense columns; a purple-to-blue gradient hero; Space Grotesk as the safe
  face; everything centred; one large radius on every box.
- Over-tall beats clipped: grow a board's `h` rather than cut content off.
- Accessible as drawn: real `<button>`, `<a href>`, `<input>` + `<label>`; `aria-label` on
  icon-only buttons. Text 4.5:1 (3:1 at 24px+); colors that must be told apart also differ in
  lightness. Touch targets ≥44px.
- Before handing over, check each artboard for the defaults a model reaches for: only the success
  state drawn (no loading, empty, error or longest-content case); a second accent, radius rule or theme creeping in;
  shared parts of side-by-side cards misaligned; an uppercase label over every heading; decorative
  dots and section numbers; "Oops!" errors, filler verbs and stock names (`Acme`, `John Doe`). The
  design system overrides any of these. Full list: "AI tells to design past" in
  `reference/craft.md`; a marketing piece also takes the list under "Landing pages" there.
