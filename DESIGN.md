---
version: alpha
name: arcterm Cockpit
description: Design system of the Tauri agent-cockpit frontend. Tokens mirror frontend/tailwindsetup.css @theme values (Graphite default); prose explains how they are applied. The code is authoritative when this file disagrees.
colors:
  # core surfaces
  background: "#101010"
  surface: "#161616"
  surface-raised: "#1c1c1c"
  surface-hover: "#252525"
  surface-code: "#0c0c0c"
  surface-selected: "#2d2d2d"
  panel: "rgba(28, 28, 28, 0.6)"
  lane: "#141414"
  modalbg: "#1c1c1c"
  # text (ink ramp)
  foreground: "#d6d6d6"
  white: "#d6d6d6"
  primary: "#d6d6d6"
  secondary: "#cccccc"
  muted-foreground: "#c9c9c9"
  ink-hi: "#e3e3e3"
  ink-mid: "#a2a2a2"
  muted: "#8e8e8e"
  ink-faint: "#666666"
  # borders (edge ramp)
  border: "#1f1f1f"
  edge-mid: "#2a2a2a"
  edge-strong: "#3d3d3d"
  edge-faint: "#1a1a1a"
  # accent (blue, with a periwinkle ramp)
  accent: "#5e9cff"
  accent-50: "#e8ecff"
  accent-100: "#cdd6ff"
  accent-200: "#aebfff"
  accent-300: "#8da3ff"
  accent-400: "#5e9cff"
  accent-500: "#5f74e0"
  accent-600: "#4f61c4"
  accent-700: "#3f4ea0"
  accent-800: "#2f3b7a"
  accent-900: "#232c5c"
  accenthover: "#8da3ff"
  accent-soft: "#aebfff"
  accentbg: "rgba(94, 156, 255, 0.12)"
  # status
  error: "#e0726c"
  error-soft: "#f0a9a4"
  warning: "#e6b450"
  asking: "#e6b450"
  warning-soft: "#f0d79f"
  success: "#54c79a"
  working: "#54c79a"
  success-soft: "#bfe6d6"
  on-warning: "#1a1306"
  askingbg: "rgba(230, 180, 80, 0.12)"
  pill: "rgba(255, 255, 255, 0.05)"
  # identity (theme-agnostic by design)
  skill: "#c58cff"
  conn-1: "#53b4ea"
  conn-2: "#aa67ff"
  conn-3: "#fda7fd"
  conn-4: "#ef476f"
  conn-5: "#497bf8"
  conn-6: "#ffa24e"
  conn-7: "#dbde52"
  conn-8: "#58c142"
  graphlane-1: "#7c95ff"
  graphlane-2: "#54c79a"
  graphlane-3: "#e6b450"
  graphlane-4: "#c9a4ff"
  graphlane-5: "#e0726c"
  graphlane-6: "#5cc8d8"
  graphlane-fold: "#6b7178"
  rt-claude: "#d97757"
  rt-codex: "#ececec"
  rt-opencode: "#a78bfa"
  rt-pi: "#ececec"
  rt-terminal: "#9aa3ad"
  # neutral overlays (kept raw across themes)
  hover: "rgba(255, 255, 255, 0.1)"
  hoverbg: "rgba(255, 255, 255, 0.2)"
  highlightbg: "rgba(255, 255, 255, 0.2)"
  # syntax highlight for transcript code blocks
  syntax-keyword: "#aebfff"
  syntax-string: "#7fd6ab"
  syntax-number: "#e6b450"
  syntax-comment: "#6b7178"
  syntax-punct: "#8b939d"
  syntax-ident: "#cdd3da"
  code-inline: "#d7b981"
  # git diff added/removed lines and +N/-N counts
  diff-added: "#3fb950"
  diff-removed: "#f85149"
  # the light matte under a note's image in the Doc review view
  imagematte: "#e9ecef"
typography:
  font-sans:
    fontFamily: "Inter, system-ui, sans-serif"
  font-mono:
    fontFamily: "JetBrains Mono, monospace"
  text-xxs:
    fontSize: 10px
  text-xxxs:
    fontSize: 8.5px
  text-default:
    fontSize: 14px
  text-title:
    fontSize: 18px
  markdown-text:
    fontSize: 14px
  markdown-mono:
    fontSize: 12px
spacing:
  base: 4px
  appbar: 46px
  rail-wide: 78px
  rail-narrow: 56px
  stage-min: 640px
  container-w600: 600px
  container-w450: 450px
  container-w350: 350px
  container-xs: 300px
  container-xxs: 200px
  container-tiny: 120px
  # shadow scale (recipes tokenized from former hand-rolled classes; see Elevation & Depth)
  shadow-popover: "0 20px 56px rgba(0, 0, 0, 0.55)"
  shadow-popover-sm: "0 10px 28px rgba(0, 0, 0, 0.5)"
  shadow-popover-md: "0 12px 34px rgba(0, 0, 0, 0.5)"
  shadow-popover-lg: "0 14px 36px rgba(0, 0, 0, 0.5)"
  shadow-popover-xl: "0 18px 44px rgba(0, 0, 0, 0.55)"
  shadow-popover-2xl: "0 24px 56px rgba(0, 0, 0, 0.55)"
  shadow-popover-soft: "0 20px 50px rgba(0, 0, 0, 0.35)"
  shadow-popover-line: "0 1px 3px rgba(0, 0, 0, 0.4)"
  shadow-inset-highlight: "inset 0 1px 0 rgba(255, 255, 255, 0.28)"
rounded:
  sm: 6px
  md: 8px
  lg: 12px
  full: 9999px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.background}"
    rounded: "{rounded.md}"
  button-primary-hover:
    backgroundColor: "{colors.accenthover}"
  panel:
    backgroundColor: "{colors.surface-raised}"
    borderColor: "{colors.edge-mid}"
    rounded: "{rounded.md}"
  status-working:
    color: "{colors.working}"
  status-asking:
    color: "{colors.asking}"
  status-error:
    color: "{colors.error}"
---

# Wave Terminal (arcterm fork) — Design System

## Overview

Wave Terminal's cockpit is a dark, dense, keyboard-first AI-agent workspace. It
is terminal-native: information density is high, chrome is thin, and every
interactive element answers to the keyboard before the mouse (the app is
designed to be operated entirely from the keyboard; the mouse is a fallback).

The visual identity is **graphite**: neutral greys with no hue, layered in a
tonal surface ramp so regions are separated by tone rather than by lines. Text
rides an ink ramp that steps from `ink-faint` through `muted` to near-white.
The blue accent (`#5e9cff`) is used sparingly (the primary CTA, focus, links
and the running state) so it still reads as a signal. Status is semantic and
never color-alone: amber = asking, green = working, red = error.

Typography is **Inter** throughout the UI, with **JetBrains Mono** reserved for
the terminal, code and diff bodies, keycaps, and verbatim machine tokens (SHAs,
ids, config keys) — never for file paths, names or labels. Motion is functional-first: it exists only
to make state changes more legible, honors `prefers-reduced-motion`, and draws
exclusively from shared motion tokens.

The whole cockpit re-skins at runtime by overriding `--color-*` custom
properties on `<html>` — no component edits, no `.dark` class, no
ThemeProvider. `graphite` is the default palette and is guaranteed to equal
the `@theme` literals in `frontend/tailwindsetup.css` (guarded by
`themes.test.ts`).

## Colors

All colors come from `@theme` tokens in `frontend/tailwindsetup.css`; **raw
hex/rgba never appears in component `className` or `style`**. Values below are
the Graphite defaults, verbatim from that file.

### Surface ramp (layering, not shadows)

Backgrounds step from the app backdrop up to hovered/selected rows:

- **`background` `#101010`** — app canvas.
- **`surface` `#161616`** — base containers.
- **`surface-raised` `#1c1c1c`** — cards, panels, modals, app-bar buttons.
- **`surface-hover` `#252525`** — hover state for raised elements.
- **`surface-code` `#0c0c0c`** — diff/terminal body, one step *below* surface.
- **`surface-selected` `#2d2d2d`** — persistent selected row; a grey fill, not
  an accent tint.
- **`panel` `rgba(28,28,28,0.6)`** — translucent overlay panels.
- **`lane` `#141414`** — agent-card lane fill.

### Ink ramp (text)

Stepped for readability, with a documented contrast floor (see Do's and
Don'ts): `ink-faint 3.31:1 < muted 5.81:1 < secondary 11.85:1 < text 13.09:1`
against `background`; `muted` on a hovered row (`surface-hover`) is 4.68:1.

- **`foreground` / `primary` / `white` `#d6d6d6`** — primary text.
- **`secondary` `#cccccc`** — secondary text; **`muted-foreground`
  `#c9c9c9`** sits just below it.
- **`ink-hi` `#e3e3e3`** — high-emphasis body text.
- **`ink-mid` `#a2a2a2`** — tool badges, secondary button text.
- **`muted` `#8e8e8e`** — captions/meta; clears WCAG AA (4.5:1) on background
  and on a hovered row.
- **`ink-faint` `#666666`** — gutters/separators; clears the 3:1 non-text
  minimum but is not for body text.

### Edge ramp (borders)

- **`border` `#1f1f1f`**, **`edge-faint` `#1a1a1a`**, **`edge-mid` `#2a2a2a`**,
  **`edge-strong` `#3d3d3d`** — faint for dividers, strong for hover/focus
  outlines. Prefer a tone step over a border where the surface ramp already
  separates two regions.

### Accent ramp (blue, used sparingly)

- **`accent` `#5e9cff`** — the main accent: the primary CTA, focus rings,
  links, the running state. Selection and hover are grey, not accent.
- **`accent-50…900`** — full ramp (`#e8ecff` → `#232c5c`) for gradients and
  emphasis tiers.
- **`accenthover` `#8da3ff`**, **`accent-soft` `#aebfff`**, **`accentbg`
  `rgba(94,156,255,0.12)`** — hover, soft text on tinted backgrounds, and
  tinted fills.

### Status (semantic, never color alone)

- **`working` / `success` `#54c79a`** (green), **`asking` / `warning`
  `#e6b450`** (amber), **`error` `#e0726c`** (red), each with a `-soft`
  variant for tinted fills; **`on-warning` `#1a1306`** for text on filled
  amber badges, **`askingbg` `rgba(230,180,80,0.12)`** for asking-tint fills
  (theme-derived like `accentbg`), and **`pill` `rgba(255,255,255,0.05)`**
  for faint pill/chip overlays (preserved across themes with the neutral
  overlays). Status is always paired with an icon, label, or dot — color
  alone never carries meaning.

### Identity palettes (theme-agnostic by design)

These stay at `@theme` defaults across all runtime themes so identity stays
recognizable: **commit graph lanes** `graphlane-1..6` + `graphlane-fold` (positional, never
identity), **runtime accents** `rt-claude` `#d97757` / `rt-codex` `#ececec` /
`rt-opencode` `#a78bfa` / `rt-pi` `#ececec` / `rt-terminal` (with `-soft` and
`-line` variants), **memory note types** (`mem-project` blue, `mem-reference`
green, `mem-feedback` amber, `mem-user` purple), **jarvis graph node kinds**
(`graph-task/decision/memory/run/semantic`), **connection status icons**
(`conn-1..8`), and **provider brand dots**
(`provider-*`). Neutral white overlays (`hover`, `hoverbg`, `highlightbg`,
`pill`) are also preserved across themes.

### Syntax + ANSI

- **Syntax tokens** (`syntax-keyword` `#aebfff`, `syntax-string` `#7fd6ab`,
  `syntax-number` `#e6b450`, `syntax-comment` `#6b7178`, `syntax-punct`,
  `syntax-ident`) color transcript code blocks. **`code-inline` `#d7b981`**
  (a warm gold) colors inline code in markdown and transcript narration.
- **Diff tokens** (`diff-added` `#3fb950`, `diff-removed` `#f85149`) color
  git diff bands, inline diff lines, and every `+N` / `−N` count. They are
  not `success` / `error`: a removed line is not a failure. Theme-agnostic
  like the syntax tokens.
- **`imagematte` `#e9ecef`** is the light matte a markdown note's image sits on
  in the Doc review view: a diagram exported with a transparent background and
  dark ink (Mermaid's default) is unreadable on the dark ground. Theme-agnostic,
  like the image it frames; not in `themes.ts`.
- **`--ansi-*`** literals are fallbacks only: `buildThemeVars` in
  `frontend/app/view/agents/themes.ts` derives ANSI + terminal palettes from
  the active theme at runtime so CSS and the live terminal cannot drift. Do
  not edit the literals to change terminal colors.

### Runtime theming

`themes.ts` (`THEMES`: graphite (default), midnight, slate, carbon, nocturne,
onedark, monokai) maps each base palette to the full `--color-*` override set and writes
them as inline styles on `document.documentElement` — highest specificity,
beats `:root`, re-skins everything with zero component edits. Subtle greys
(`muted-foreground`, `ink-mid`, `lane`, `feed-*`) and the identity palettes
stay at defaults, safe across all dark themes. `DEFAULT_THEME_PRESET` in
`themes.ts` must equal the `@theme` literals for the surface, ink, edge and
status tokens (guarded by `themes.test.ts`). All dark only — light mode
(Paper) was declined 2026-08-24 (see `docs/deferred.md`); an unknown preset
id falls back to the default. Someone who already picked a preset keeps it
(it is stored in localStorage), so a user who once reverted to the old
default stays on Midnight.

## Typography

- **`font-sans` — Inter** (bundled) for all UI: labels, headings, badges,
  buttons, names, and every number, count, cost, duration and timestamp. It is
  the body default, so most elements carry no font class at all. Falls back to
  `system-ui, sans-serif`. Rendered markdown uses it too.
- **`font-mono` — JetBrains Mono** (the variable full-charset file
  `public/fonts/jetbrains-mono-variable.woff2`) stays ONLY for:
  1. code and diff BODIES (code blocks, diff/patch lines, file-content snippets,
     grep match lines, shell command lines and their output, tool-detail bodies),
     the terminal, the code editor, and inline `code` inside rendered markdown;
  2. keycaps, `<kbd>` and shortcut hints;
  3. raw machine tokens meant to be copied verbatim and read character by
     character: git commit SHAs, UUID / run-id / session-id fragments, hashes,
     env var names and config keys shown as such, JSON / TOML / YAML snippets.

  Everything else is Inter — simply carry no `font-mono`: file names and file
  PATHS in lists, rows, headers, breadcrumbs and chips, branch names, worktree
  names, model names, project names, runtime names, labels, counts, durations,
  timestamps, tab titles, verbs, badges and placeholders. A file path is mono only
  when it is part of a code line (a diff, grep or read body row); as a row title,
  header, chip or list item it is Inter. A shell command (the `$ cmd` line, a bash
  tool's target) is mono; a non-shell tool's target (a file path, a pattern label)
  is Inter. It is also the terminal default.
- **Numbers** in Inter get `tabular-nums` wherever they align or update (usage
  meters, token and cost tables, durations, timestamps, diff stats) so columns do
  not jitter.

Fonts are registered via `FontFace` in `frontend/util/fontutil.ts`
(`loadFonts()` at boot). The settings font picker offers Inter / Hanken
Grotesk / System UI (sans) and JetBrains Mono / Hack / Fira Code (mono);
`applyFontVars` re-fonts the whole app by overriding `--font-sans` /
`--font-mono` on the root. A bundled face must cover Vietnamese: the bundled
Hanken Grotesk, Hack and Fira Code do not.

Size tokens are sparse on purpose — most sizes are arbitrary values in
components: `text-xxxs` 8.5px (micro badges/eyebrows — the former
`text-[8px]`/`text-[8.5px]` tiers unified), `text-xxs` 10px, `text-default`
14px (the body size), `text-title` 18px; markdown text 14px with 12px mono.
Weights come from Tailwind defaults
(`font-medium/semibold/bold`); no weight or leading tokens exist — do not
invent them.

## Layout

Flexbox everywhere; grid only for card grids. The recurring chrome combo is
`flex flex-col min-h-0 flex-1 overflow-hidden`; content regions always carry
`min-w-0` so they can shrink. Fixed widths belong to rails and sidebars only;
content is always fluid.

- **App bar** — fixed 46px row, `data-tauri-drag-region` for window drag;
  left logo + switchers, center search (max 520px), right primary CTA +
  window controls.
- **Nav rail** — fixed 78px wide (56px on narrow windows via
  `navRailCollapsed(windowWidth)` in `navrailwidth.ts`).
- **Agent surface tree** — a "Conversation History" row (New agent is the app
  bar's, not repeated here), then three sections (Active, Terminals, Conversations), each a counted header
  that folds it, holding collapsible project folder rows of one-line rows
  (status dot or mark, name, meta). The selected row is a grey fill
  (`bg-surface-selected`). Asking is a word in the row, not a filled row: an
  amber fill would make the list shout.
- **Details rail** — the tab strip counts the agent's lists after its tabs,
  an icon and a number each in one fixed order (Subagents, Files changed,
  Artifacts, Uploads, Servers, Background tasks), dimmed at 0, so the rail keeps one
  shape as work arrives; a count opens its section, an empty Uploads
  attaches. The body opens on a one-line status (a context ring with its
  percent and tokens, then the session's spend), then Needs you, the counted
  sections that hold something, Run/Task, and Token usage and Details,
  closed by default (Details' header reads project · branch while closed).
  The footer is the session's state and cache with Resume or Stop. Each
  figure shows once.
- **Surfaces** — absolutely stacked (`absolute inset-0`) under a
  `relative min-w-0 flex-1` shell; each surface is `flex flex-col bg-background`.
  The Agent surface stays mounted-but-hidden across nav switches so its xterm
  never remounts; other surfaces unmount on switch.
- **Modals** — `fixed inset-0 z-[70]` overlay with backdrop; focus is
  trapped (`modalfocus.ts`).
- **Z-index** — tokenized: `--z-window-drag: 100`; legacy `--zindex-*` vars
  remapped for old SCSS modules.

Spacing uses the Tailwind default scale (4px basis: `px-1` … `gap-4` …) plus
occasional arbitrary values (`px-[7px]`, `gap-[10px]`) — there is no custom
spacing scale, and one should not be introduced. Container widths are
tokenized (`container-w600` 600px, `w450` 450px, `w350` 350px, `xs` 300px,
`xxs` 200px, `tiny` 120px).

## Elevation & Depth

Depth is **tonal, not shadow-based**: hierarchy comes from the surface ramp
(`surface` → `surface-raised` → `surface-hover`) and edge-ramp borders.
Shadows are reserved for floating chrome and come from the tokenized popover
scale: `shadow-popover` (the default recipe, `0 20px 56px rgba(0,0,0,0.55)`)
plus `shadow-popover-sm/md/lg/xl/2xl` (lighter popovers), `shadow-popover-soft`
(diffuse), `shadow-popover-line` (1px micro-shadows), and
`shadow-inset-highlight` (the white top-edge highlight on filled CTAs). Do
not hand-roll new shadow recipes in `className`/`style` — reuse the scale.
Legacy modals use `--modal-box-shadow` (`0 8px 24px` at 0.8 black).

## Shapes

Radius tokens: `rounded` 8px (default), `rounded-sm` 6px, `rounded-lg` 12px,
`full` for pills/avatars. Note `rounded-md` (widely used) is the Tailwind
default (6px), not a theme token. Arbitrary radii 5–14px are pervasive in
components; small radii on small elements are accepted. The shape language is
softly rounded — not pill-heavy, not sharp.

## Components

All primitives are built in-house in `frontend/app/element/` (button, toggle,
input, modal, popover, tooltip, segmented, skeleton, collapsiblerail,
errorboundary) — **no shadcn components** (only its vendored `cn()` helper).
Icons are `lucide-react` named imports (size 20, `strokeWidth 1.8` in nav);
runtime logos stay image assets, and so do file-type icons — the Material Icon
Theme set, via `element/fileicon.tsx` (`<FileIcon path dir expanded />`).

- **Buttons** — primary = `bg-accent text-background hover:bg-accenthover`;
  secondary = `bg-surface-raised border-edge-mid text-muted hover:border-edge-strong
  hover:bg-surface-hover` (see `cockpit/app-bar.tsx`).
- **Tooltips** — give the control a `title`, with its shortcut in trailing
  parentheses (`Hide the review (Esc)`). `element/titletiphost.tsx` shows every
  title immediately in the app's own chip, the shortcut muted at the right,
  revealed in 90 ms from the side facing the control (`tooltipReveal`) and gone
  at once; `data-tip-placement` overrides where it opens.
- **Status indicators** — dot + color + pulse (`pulse-dot` on `bg-working`/`bg-asking`;
  `pulse-dot-slow`, `pulse-soft` for the slower curves); status is never color alone.
  The pulse is drawn at 12fps by `element/pulsedriver.tsx`, not a CSS animation:
  an infinite CSS animation holds the page at display rate while it is on screen.
- **Panels/cards** — `bg-surface-raised border-edge-mid rounded-md`; selected
  rows `bg-surface-selected` (grey, never an accent tint).
- **Focus** — a prominent accent ring on the active region + highlighted
  cursor row; the keyboard replaces the mouse, so focus must be visible.
- **Motion** — `motion/react` only; shared variants/timing from
  `element/motiontokens.ts` (`MOTION.durMacro` ~360ms on
  `cubic-bezier(0.22,1,0.36,1)`, micro ~140ms, exits ~280ms); card entrances
  animate opacity + scale, never x/y; `MotionConfig reducedMotion="user"`.
- **Modals** — `modalshell.tsx` with `role="dialog"` + `aria-modal`, Escape
  to close, focus trap; rendered centrally via `ModalsRenderer`.
- **Accessibility** — `aria-label` on every icon-only control; `aria-live`
  on feed/result regions; `focus-visible` treatment on every interactive
  control.

## Do's and Don'ts

- Do use `@theme` token utilities (`bg-surface-raised`, `text-accent`,
  `border-edge-mid`, …) for every color. Never raw hex/rgba in
  `className`/`style`; when a token is missing, add `--color-*` to
  `frontend/tailwindsetup.css` first, then use the generated utility.
- Do keep `@theme` the single source of truth. No parallel token namespaces,
  no token renames, no new SCSS (Tailwind only; surviving SCSS is legacy).
- Don't invent new color tokens without an actual reason — reuse the
  existing vocabulary (`accent`, `surface-*`, `ink-*`, `edge-*`, status,
  identity palettes) first. When a new token is genuinely needed, add it to
  `@theme` with a "why" comment documenting the reason, and mirror it in
  `themes.ts` if it must re-skin.
- Don't edit the `--ansi-*` / `--color-syntax-*` literals to change terminal
  colors — they are fallbacks overridden at runtime by `buildThemeVars`.
- Do respect the contrast floor: text ≥ 4.5:1 (WCAG AA), non-text ≥ 3:1
  against its background; keep the ink ramp stepping `ink-faint < muted <
  secondary < text`.
- Do keep status semantic: pair amber/green/red with an icon, label, or dot.
  Never color alone.
- Do use the accent sparingly: the single most important action per screen
  (the primary CTA is `bg-accent` on `background`-toned text), focus, links
  and the running state. Separate regions by tone, and mark selection and
  hover in grey, not accent.
- Do keep identity palettes (avatar, graphlane, rt-*) at `@theme` defaults —
  they must survive any theme.
- Do keep the keyboard first: visible focus ring, roving cursor, regions;
  never shadow the terminal's own keys.
- Do extract testable logic into pure `.ts` with `.test.ts` beside it; keep
  `.tsx` thin. No jsdom render/snapshot tests — verify visually with
  `task verify:ui -- <scenario>`.
- Do draw motion from `element/motiontokens.ts`; a candidate animation must
  make a state change more legible or it does not ship. Reduced motion is
  not optional. No entrance cascades; no cross-surface container
  transitions.
- Don't introduce a new design vocabulary per surface — reuse tokens,
  motion moments, and patterns; add a new primitive to the token module
  first.
- Do comment "why", never "what"; lowercase; minimal. KISS/YAGNI/DRY;
  single source of truth.
- Don't hand-edit generated files (`store/wshclientapi.ts`,
  `types/gotypes.d.ts`, …) — edit Go, run `task generate`.

## Copy

- A button says exactly what happens ("Save changes", not "Submit"), and an action keeps
  its verb through the flow: "Publish" produces a "Published" toast.
- Name things by what the user manages, not how the system is built.
- Errors say what happened and how to fix it; they don't apologize and are never vague.
- Sentence case, plain verbs, no filler; each piece of text does one job.

## Mockups (prototypes)

UI changes get a validated high-fidelity HTML mockup before implementation — prototype
first, always. The mockup is the design proposal; it must be seen and approved before
code is written.

- Build it with the `design-local` Claude Code skill: a `.dc.html` canvas under the gitignored
  `.superpowers/design/<topic>/`, which arcterm serves and shows on the Agent surface. This file is its design system — every rule
  above applies to the mockup as it will to the code.
- Token values come from `frontend/tailwindsetup.css` `@theme`, never from memory or an
  older canvas.
- A mockup is scaffolding, never committed: once its feature ships the code is the design, so
  delete the topic folder. The canvases already under `docs/prototype/` predate this rule and
  stay only because code comments and specs cite them.

## Architecture & Patterns

The cockpit's structural conventions (state, component shape, theming
engine):

- **Pure logic + thin render.** Testable logic lives in pure `.ts` files
  (`agentsviewmodel.ts`, `cardgridlayout.ts`, `difflayout.ts`,
  `navrailwidth.ts`) with `.test.ts` beside them; `.tsx` components render.
  169 test files, zero render/snapshot tests. Files carry a react-freedom
  header comment ("Pure view-model logic … No React, no Wave runtime
  imports").
- **State: jotai + WOS + event bus.** One global store
  (`store/jotaiStore.ts`, `<Provider store={globalStore}>`); global atoms in
  `store/global-atoms.ts`; backend objects cached via the Wave Object Store
  (`store/wos.ts`, `useWaveObjectValue`, version-staleness-guarded updates);
  server events via `store/wps.ts` subscriptions.
- **ViewModel pattern.** A `ViewModel` class owns a cluster of atoms and is
  passed down as a `model` prop (`AgentsViewModel` in `view/agents/agents.tsx`);
  components read with `useAtomValue(model.x)` and write through model
  methods. Orchestration reads/writes go through `globalStore`.
- **Persistence.** `atomWithStorage` (jotai/utils) for localStorage-backed
  atoms: `themePresetAtom`, cockpit prefs, rail state.
- **Keybindings.** Registry in `store/keybindings/` is the single source of
  truth (`docs/keyboard-shortcuts.md` mirrors it and is stale when they
  disagree); two postures from focus (Navigate vs Type), leader `g` chords
  with a which-key hint bar, `?` cheat sheet.
- **Theming.** Tailwind v4 `@theme` tokens → `var(--color-*)` utilities →
  `themes.ts` `buildThemeVars` inline overrides on `<html>`. The default
  (Graphite) must equal the `@theme` literals (golden-tested). ANSI/terminal derived from the
  same palette.
- **File organization.** `view/<family>/` holds everything for a surface
  (flat); `element/` shared primitives; `modals/` global overlays; `store/`
  atoms + wshrpc client + WOS; lowercase filenames, PascalCase named exports,
  one component family per file. Legacy terminal-era subsystems (`block/`,
  `monaco/`, parts of `element/`) keep their old conventions —
  new code follows the `view/agents/` style.

## Authoritative Sources

| Concern | File |
|---|---|
| Color/type/radius/spacing tokens | `frontend/tailwindsetup.css` (`@theme` block) |
| Runtime theming engine | `frontend/app/view/agents/themes.ts` (+ `themes.test.ts`) |
| Theme persistence/apply | `frontend/app/view/agents/themestore.ts` |
| Motion tokens | `frontend/app/element/motiontokens.ts` (+ test), `docs/reference/motion-system.md` |
| Keybinding registry | `frontend/app/store/keybindings/` (`bindings.ts`) |
| Keyboard design spec | `docs/superpowers/specs/2026-07-03-keyboard-operability-design.md` |
| Fonts | `frontend/util/fontutil.ts`, `frontend/app/view/agents/fonts.ts` |
| Repo working rules | `AGENTS.md` |
