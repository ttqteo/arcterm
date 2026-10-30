# Palette scope tab indicator: design

## Intent and why

When the command palette's scope changes (Tab / Shift+Tab, a prefix such as `r `, or a click), the
active underline travels from the old tab to the new one instead of vanishing and reappearing.
Across a strip of ten tabs, a far jump (Shift+Tab wrapping from All to the last scope, or a prefix
jump) is easy to miss when it snaps; a slide shows direction and destination. It passes the motion
system's test (`docs/reference/motion-system.md`): it makes a state change, which scope is active,
more legible.

**Non-goals:** other tab strips, a hover preview, animating the label text, animating the results
swap.

## What exists today

`PaletteScopeTabs` (`frontend/app/cockpit/palette-chrome.tsx:115`) renders `SCOPES`
(`frontend/app/cockpit/palette-scope.ts:36`) as buttons. The active one gets `text-primary` plus
`shadow-[inset_0_-2px_0_var(--color-accent)]`; the rest are `text-muted hover:text-secondary`.
Tab / Shift+Tab call `cycleScope` (`command-palette.tsx:440`); scope prefixes (`n`, `g`, `a`, `r`,
`s`, `re`) jump directly. The palette renders inside `ModalShell`, which already animates the
panel. No other tab strip uses this underline, and no component uses `layoutId` yet.
`motiontokens.ts` holds `durMicro` 140ms, `durMacro` 360ms, `easeFluid`.

## Visual treatment

Unchanged at rest: a 2px `bg-accent` bar along the active tab's bottom edge, full tab width, the
active label `text-primary`. The inset box-shadow on the button is removed. The active button
renders a `motion.span` (absolute, `inset-x-0`, `bottom-0`, `h-[2px]`, `bg-accent`, `aria-hidden`)
with `layoutId="palette-scope-indicator"`; the button gets `relative`. The bar sits on the strip's
`border-b` exactly as the shadow does today.

Labels keep their instant `text-primary` / `text-muted` switch: the moving bar carries the change,
and a color fade on ten labels adds nothing. The Needs you count is untouched.

## Timing and interruption

The slide runs on `MOTION.durMacro` (360ms) with `easeFluid`. `easeFluid` front-loads the travel, so
the bar reaches the new tab in the first frames and the rest is settle; it reads as immediate,
where `durMicro` over a long jump reads as a snap (the same reason `paneReveal` uses `durMacro`).
Framer retargets a layout animation from its current position when the scope changes mid-flight,
so holding Tab never builds a queue. Width animates with position, since tabs differ in width.

## The motion primitive

Per DESIGN.md, the new primitive lands in the token module first: `indicatorSlide` in
`frontend/app/element/motiontokens.ts`, a transition object
`{ duration: MOTION.durMacro, ease: MOTION.easeFluid }`, with a "why" comment (a shared-layout
indicator moving between siblings; `durMacro` because `easeFluid` front-loads the travel).
`motiontokens.test.ts` guards its values as it does the others. `docs/reference/motion-system.md`
lists it in the shared-foundation table. It is named for the pattern, not the palette, so a later
tab strip can reuse it.

## Open, reopen and reduced motion

Opening the palette shows the bar already under its scope, with no slide, even when the scope
differs from the last open (Code opens on Files): only a change while the palette is open animates,
matching the no-entrance-cascade rule. Reduced motion: the existing `MotionConfig
reducedMotion="user"` covers layout animations, so the bar snaps as it does today; `ModalShell` already
wraps its children in it.

Agent's call: leaving a note draft remounts the strip on an unchanged scope, so the bar draws in
place with no slide. Agent's call: backspace-to-All (`backspaceEmpty`) is a scope change and slides
like Tab or a prefix.

## Verification

A CDP scenario in `scripts/cdp/scenarios.mjs`:

1. Open the palette, press Tab; sample the indicator's bounding rect mid-animation (x strictly
   between the two tabs) and after it settles (x and width match the new tab's button).
2. Jump with a prefix to a distant scope; check the landing.
3. Close and reopen on a different scope; check the bar is under the active tab on the first frame.

Shots at rest and mid-slide. A vitest case in `motiontokens.test.ts` covers the new token.

## Left to the builder

- How to keep the first frame after open from sliding (Framer can animate a `layoutId` from a stale
  snapshot of the previous open). Agent's call: the open effect sets `nav` after the first render,
  so the guard must cover that render too, not only the mount. Options: a key on the strip per open, a `LayoutGroup` id, or gating, as
  the scenario proves.
- Whether the strip needs its own `LayoutGroup` to stay isolated from other layout animations in
  the modal.
- Exact stacking so the bar draws over the strip's `border-b`.
