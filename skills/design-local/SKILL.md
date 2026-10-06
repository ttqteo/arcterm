---
name: design-local
description: Make a multi-artboard .dc.html design canvas locally, in a gitignored scratch folder, in the Claude Design format. Use when the user asks to /design-local something, or for a UI mockup or prototype of a new screen or a redesign.
---

# Design, local

A design canvas you write to a scratch folder and serve to the user's browser. It is scaffolding:
it settles a design before code, and once the feature ships the code is the design. So a canvas
lives outside git and is deleted when its feature lands. Nothing is published to claude.ai.

## When to use

Decide per question, not per session: would the user understand this better by seeing it than
reading it? Layouts, visual options side by side, states of a screen, polish: draw it. Scope,
trade-offs, conceptual A/B choices: stay in the terminal. A question about a UI topic is not
automatically a visual question.

## Starting a canvas

1. `<topic>` is a short kebab-case name from the brief; `<root>` is
   `.superpowers/design/<topic>/project/` in the working directory.
2. `git check-ignore -q .superpowers/design`. Not ignored: tell the user and ask to add
   `.superpowers/` to `.gitignore` before writing anything.
3. Copy `support.js` from this skill's directory to `<root>/support.js`, so each artboard's
   `./support.js` line resolves.
4. Read the design system (below) before choosing any look.

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
   requested changes stay small.

Hand over and stop. Render, screenshot or re-read the files only when the user asks.

## Cleaning up

When the feature a canvas designed ships, delete its `.superpowers/design/<topic>/` folder in the
same session. A canvas is never committed.

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
  `{"v":3,"createdOnFiles":{"v":1,"at":"<now, RFC 3339>"},"title":"<canvas name>","launch":{"view":"canvas"},"pages":[],"boards":{"Main.dc.html":{"x":0,"y":0,"w":1440,"h":900,"title":"<what it shows>"}},"order":["Main.dc.html"],"notes":{},"designSystems":[]}`.
  One `boards` entry and one `order` slot per artboard, `Main.dc.html` first. `x`,`y`,`w`,`h` are
  the frame in CSS px: 80 px between frames in a row, 120 between rows. Add `"is_interactive":
  true` to an artboard with working controls. When revising, keep every key you are not changing.
- **`<root>/<Name>.dc.html`**, one self-contained file per artboard. Names start with a letter,
  digit or `_`, then only those and `.` `-`; no spaces. Sizes: desktop 1280–1440 wide, phone
  390×844.
- An image or font an artboard uses goes under `<root>/` and is linked by a relative path.

## One artboard: the skeleton

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
body{margin:0;font-family:Georgia,serif;background:#faf9f5}
a{color:#b45309}a:hover{color:#92400e}
</style>
</helmet>
<div style="width: 880px; height: 560px; box-sizing: border-box; padding: 64px; display: flex; flex-direction: column; gap: 24px">
<h1 style="margin: 0; font-size: 56px; color: {{accent}}">Spring at Meridian</h1>
<div style="padding: 20px; background: #ffffff; border: 1px solid {{accent}}; border-radius: 12px">Pea &amp; mint soup</div>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"accent":{"editor":"color","default":"#d97757"},"$preview":{"width":880,"height":560}}'>
class Component extends DCLogic {
renderVals() {
return { accent: this.props.accent ?? '#d97757' };
}
}
</script>
</body>
</html>
```

Rules that bite (each fails silently):

- Keep the `<script src="./support.js"></script>` head line exactly.
- Close every non-void element and quote every attribute.
- Give the root element a fixed size equal to the board's `w`/`h`, and the same `$preview`.
- Inline `style="…"` for the design; `<helmet><style>` only for page basics and `a`/`a:hover`.
- Lay out sibling groups with flex or grid plus `gap`.
- `{{hole}}` is a dotted lookup into `renderVals()`, never an expression.
- Always include the `<script type="text/x-dc" data-dc-script>` block: classic JS,
  `class Component extends DCLogic`, no imports.
- All UI is `<x-dc>` markup (`<sc-for>`, `<sc-if>`, `<dc-import>`), never script-built.
- `data-props` (single-quoted JSON) declares tweaks, which are levers, not copy.
- Network: only a Google Fonts `css2` `<link>` in `<helmet>`. Icons: inline stroke SVG.
- No `<iframe>`, `<object>`, `<embed>` or global keydown handlers.

Events, state, repeats, branches, child components and links between artboards
(`<a href="Other.dc.html">`): `reference/format.md`. Read it before a first artboard.

## Designing well

The long form, for pushback on a design call or a specific kind of piece: `reference/craft.md`.

- Real copy; a missing fact becomes a placeholder like `[RUN NAME]`. No lorem ipsum, invented
  stats or filler.
- Rationale and option notes go in your reply; an artboard's `title` names what it shows.
- Options differ in layout and treatment of what the brief asks for. A control, step or section
  the brief did not ask for is a question in your reply, not an artboard.
- Plain surfaces: no gradient washes, left-border cards or emoji; no Inter, Roboto or Arial.
- Accessible as drawn: real `<button>`, `<a href>`, `<input>` + `<label>`; `aria-label` on
  icon-only buttons. Text 4.5:1 (3:1 at 24px+); colors that must be told apart also differ in
  lightness. Touch targets ≥44px.
- Before handing over, check each artboard for the defaults a model reaches for: only the success
  state drawn (no loading, empty or error); a second accent, radius rule or theme creeping in;
  shared parts of side-by-side cards misaligned; an uppercase label over every heading; decorative
  dots and section numbers; "Oops!" errors, filler verbs and stock names (`Acme`, `John Doe`). The
  design system overrides any of these. Full list: "AI tells to design past" in
  `reference/craft.md`; a marketing piece also takes the list under "Landing pages" there.
