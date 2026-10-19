# The .dc.html authoring format — full rules and syntax card

Read this when an artboard needs more than SKILL.md's skeleton.
Everything the format supports is stated here — never design around a
presumed gap ("I'll make the swatches static because I can't verify
event syntax"): events, state and conditionals all work.

## Authoring an artboard

A Design Component is one self-contained HTML file. Arc's canvas pane
renders it with `support.js`; claude.ai Design imports it unchanged and
adds an editor on top. Notes marked "claude.ai" below matter only after
such an import. Shape:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Hello</title>
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    a { color: #b45309; } a:hover { color: #92400e; }
  </style>
</helmet>
<div style="padding: 32px">
  <h1>{{title}}</h1>
  <sc-for list="{{items}}" as="item">
    <div>{{item.label}}</div>
  </sc-for>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"title":{"editor":"text","default":"Hello"}}'>
class Component extends DCLogic {
  renderVals() {
    return { title: this.props.title ?? 'Hello', items: [{ label: 'One' }] };
  }
}
</script>
</body>
</html>
```

Rules beyond SKILL.md's "Rules that bite":

- `lang` on `<html>` is the copy's language (`en` here); change it
  when the design's text is not English.
- `<title>` names the screen for accessibility; give each artboard its own, in a few words.
- Layout containers: a STACK is a flex `<div>` — inline
  `display: flex` plus `flex-direction`, `gap`, `justify-content`,
  `align-items`, with `flex-grow` / `align-self` on children. A GRID
  is a CSS-grid `<div>` — `display: grid` plus
  `grid-template-columns: repeat(N, minmax(0, 1fr))` and `gap`;
  children flow into the cells in document order. Author equal tracks
  in exactly the `repeat(N, minmax(0, 1fr))` shape (claude.ai: its
  properties panel reads that shape as a track count).
- Multi-frame design explorations are ARTBOARDS: put each frame in
  its own `.dc.html` entry and lay them out with `canvas.json`. Arc
  draws every listed board at its frame, scaled to fit the pane. A
  clickable prototype is one artboard per screen, joined by links
  (Links between artboards, below). Give every artboard whose content
  really works (handlers, inputs, navigation) `"is_interactive": true`
  in its canvas.json entry (claude.ai: only those get a Play button);
  leave it off static comps.

## Quick syntax card (a syntax demo; `{{title}}` etc. are placeholders)

- **Holes**: `{{ path }}` is a dotted lookup only (`{{ user.name }}`,
  `{{ $index }}`, literals like `{{ true }}`) — never an expression
  (`{{ a + b }}`, `{{ !x }}`, `{{ fn() }}` fail silently). Compute in
  `renderVals()` and expose the result by name.
- **Attributes**: `x="literal"` → string; `x="{{ path }}"` → the raw
  value (number, function, ref); `x="a {{p}} b"` → interpolated
  string. `class`/`for` auto-map to `className`/`htmlFor`.
- **Events ARE supported**: whole-value attrs with JSX camelCase —
  `onClick="{{ pick }}"` — where `pick` is a function returned from
  `renderVals()`. Interactive selected-states (clickable swatches,
  size pills) are the house pattern: keep the selection in `state`,
  and for per-item handlers attach one to each loop item in
  `renderVals()` — `items: xs.map((x) => ({ ...x, pick: () =>
  this.setState({ picked: x.id }) }))` — then bind
  `onClick="{{ item.pick }}"` inside the `<sc-for>`.
- **Control flow**: `<sc-if value="{{ cond }}"
  hint-placeholder-val="{{ true }}">…</sc-if>` branches;
  `<sc-for list="{{ items }}" as="item" hint-placeholder-count="3">`
  repeats with `{{ item.x }}` and `{{ $index }}` in scope. Always set
  the `hint-*` attrs (they render while values stream in).
- **Links between artboards**: `<a href="Cart.dc.html">View cart</a>`
  opens that artboard (in Arc, inside the clicked board's frame;
  claude.ai: Play moves to it). The href is the target's path relative to this
  artboard's; a leading `/` means the canvas root (`/sub/Cart.dc.html`).
  Style the `<a>` itself as the button: a `<button>` or input inside
  it swallows the click. `href="#id"` scrolls within the artboard;
  `https://…` opens a tab. Each artboard keeps its own `state`, so a
  flow that must share state across screens is ONE artboard: its
  handlers set a `state` field, `renderVals()` returns one flag per
  screen from it, and each screen sits in its own `<sc-if>`.
- **Conditional styling in a loop**: precompute the varying piece per
  item in `renderVals()` (e.g. each item carries `ringStyle` or
  `selected`) and either branch with `<sc-if>` or bind the computed
  value — a style hole is acceptable for live, state-driven values
  (selection highlights) and for a declared tweak prop (`{{accent}}`),
  just never for other static theme tokens, which belong inline so they
  paint while streaming.
- **Logic class**: plain classic JS, no TypeScript, no import/export;
  must be `class Component extends DCLogic`. You get `this.props`,
  `state`/`setState`/`forceUpdate` and React class lifecycle
  (`componentDidMount`…), minus `render()`. `renderVals()` returns the
  template's inputs: flat values, arrays, handlers, refs.
- **`data-props` editors** (on the `<script type="text/x-dc" data-dc-script>` tag):
  per-prop `{"editor": "text"|"color"|"int"|"float"|"range"|"boolean"|
  "enum"|null, "default": …, "tsType": "…"}` plus `options` for enum,
  `min`/`max`/`step`/`unit` for numbers/range, `section` to group;
  on color, `options` as a 3–4-item list of hex strings renders swatches.
  `editor: null` for callbacks/objects. Arc shows no tweak controls;
  claude.ai turns each editable prop into a control in its Tweaks tab.
  `default` seeds that control only — fall back
  with `this.props.x ?? …` in `renderVals()`.
  `$preview: {"width", "height"}` sets the preferred preview size for
  sized fragments.
- **Tweaks are levers, not copy.** Declare few, deliberate ones:
  behavioral switches (a dark or density toggle, a variant enum, an
  item count) and values that cut across the design in many places
  (one accent or tint color, a spacing or type scale). No tweak for
  label or body copy unless the user asks — write copy as literal text
  in the markup (not a prop, and not a `renderVals()` binding unless it
  is genuinely data) — and none for a color used in a single place.
- **`data-props` escaping**: it is a normal HTML attribute — the
  runtime reads it with `getAttribute` and then JSON-parses, so HTML
  entities decode first: write `&amp;` for `&`, `&#39;` for a
  literal single quote, and JSON
  `\"` for double quotes inside strings. Single-quote the attribute
  itself (`data-props='…'`) — every example assumes it, and a
  double-quoted attribute changes which characters need escaping.
  Those three escapes are the complete list: raw UTF-8 (em-dashes,
  middle dots, accented letters) is safe as-is, no numeric entities
  needed.
- **Editable text, including multi-line**: a `{{hole}}` bound to a
  `data-props` entry with `{"editor": "text"}` renders as a TEXT
  node — HTML in the value is escaped, so `<br>` will not work. For
  multi-line text, pair `\n` in the JSON default with
  `white-space: pre-line` (or `pre-wrap`) in the bound element's
  inline style — without it HTML collapses the newline to a space
  and the lines run together (a real shipped bug: a two-line band
  lineup rendered as one merged line). For rich per-line layout,
  split into multiple props, one element each.
- **Child DCs**: `<dc-import name="Card" item="{{ it }}"
  hint-size="100%,120px"></dc-import>` mounts the sibling file
  `Card.dc.html` (which is also an artboard of its own); every other
  attribute becomes a prop on the child (kebab→camel, read as
  `this.props.item` — declare it in the child's `data-props` with
  `"editor": null` when it is an object or callback; avoid a prop named
  `name`, which selects the component); `hint-size="W,H"` (CSS lengths)
  is the placeholder box shown until the child renders, so match the
  child's root size; works inside `<sc-for>`; never self-close and
  never use capitalized tags (`<Card/>`). claude.ai shows every
  `.dc.html` as an artboard, so list the child in `canvas.json` too
  (`w`,`h` = its `$preview`).
