# Motion system — reference

The cockpit's shared motion layer: one vocabulary, one token source. Read this before adding
motion to any surface.

The app-wide revamp this came out of is finished — every surface landed between 2026-07-03 and
2026-07-04, so the rollout table that used to live here is gone (the per-surface detail is in the
design specs listed at the bottom, and in git). What remains is the part that still governs new
work: the north star, the shared primitives, the moments, and the guardrails.

## North star

- **Functional-first.** Motion must make a state change more legible. Rejection test for any
  candidate animation: *does it make a state change more legible?* If no, it does not ship.
  Delight only rides on top of functional motion, never standalone decoration.
- **Feel = fluid / calm.** Macro moments ~360ms on `cubic-bezier(0.22, 1, 0.36, 1)`; micro ~140ms;
  exits ~280ms (leave a touch quicker than they arrive).
- **No new vocabulary per surface.** Reuse the tokens and moment patterns below. If a surface
  genuinely needs a new primitive, add it to the token module first, then use it — never inline a
  one-off duration/ease/keyframe.
- **Reduced-motion is not optional.** Every surface honors it (`<MotionConfig reducedMotion="user">`
  for Framer + `motion-reduce:animate-none` on CSS loops).
- **No entrance cascade.** `initial={false}` at the `AnimatePresence`/list level, so mounting a
  populated view does not fire N staggered entrances — only items arriving *after* mount animate.

## Shared foundation

| Artifact | Role |
|---|---|
| `frontend/app/element/motiontokens.ts` | Durations (`durMacro`/`durMicro`/`durExit`), `easeFluid`, variant presets (`cardVariants`, `reorderLift`, `composerReveal`, `paneReveal`, `popoverReveal`, `microFade`, `reflowProps`, `indicatorSlide`), `turnTransition` (chevron turn timing), `settleClass` (moment 4), `computeEntrances` (no-cascade guard) + the `shouldFadeEntry` burst guard. **Import from here; do not inline motion values.** |
| `frontend/app/element/crossfade.tsx` | Micro cross-fade for a mark swapping in place (DAG state glyph, copy -> copied); never plays on mount. |
| `frontend/app/element/copyfeedback.ts` | `useCopyFeedback`: the one copy-to-clipboard outcome (copied / failed) and its hold, for every copy affordance. |
| `frontend/app/element/popoverreveal.tsx` | Shared dropdown/popover reveal. Wraps the panel only; callers own positioning + backdrop. Adopted across all live cockpit popovers. |
| `frontend/tailwindsetup.css` | CSS-only ambient loops: `@keyframes pulseDot`, `breatheGlow`, `settle`. Token-colored via `color-mix(... var(--color-*) ...)` — no raw hex. |
| `frontend/app/element/motiontokens.test.ts` | Guards token values + the burst-guard helper. |
| `frontend/app/element/collapsiblerail.tsx` | Reusable right-rail (icon strip ↔ 300px scroll panel); owns the rail-reveal moment and fixes titlebar/rail divider alignment by construction. |

Framer (`motion/react`, v12) is the default tool. CSS is the fallback **only** for perpetual ambient
loops (glow, pulse) and pre-existing hover/press micro-transitions.

## The moments

Designed and shipped on the Cockpit surface; every other surface maps its state changes onto this
same vocabulary rather than inventing one.

| # | Moment | Tool | Primitive |
|---|---|---|---|
| 1 | Item entrance | Framer | `cardVariants` (opacity+scale only — never x/y) |
| 2 | Item exit + list reflow | Framer | `<AnimatePresence mode="popLayout">` + `exit` variant + `layout` |
| 3 | Attention / "needs you" | CSS | `breatheGlow` (persistent, token-amber, until resolved) |
| 4 | Completion settle | CSS | `settle` (one-shot soft scale on finish) |
| 5 | Streaming text line | Framer | opacity-only fade + `shouldFadeEntry` burst guard |
| 6 | Inline reveal (composer strip) | Framer | `composerReveal` (height+opacity, micro) |
| 6b | Disclosure pane reveal | Framer | `paneReveal` (same signature, macro — micro reads as a snap over a few hundred px) |
| 7 | Status pulse + micro | CSS | `pulseDot` (unified 1.6s) + kept hover/press |
| 8 | Drag lift + drop | Framer | `reorderLift` (`whileDrag`) + `dragTransition` drop-settle |
| 9 | Active-tab indicator slide | Framer | `indicatorSlide` on a `layoutId` bar (command palette scope tabs) |

## Guardrails

- Read `motiontokens.ts` before adding motion to a surface. Reuse; don't reinvent.
- `layout` only on container elements, never on streaming text nodes. Animate transform/opacity
  only (perf).
- CSS keyframes must be token-colored (`var(--color-*)` + `color-mix`) — no raw hex.
- Any live-drag / 1:1-with-pointer interaction stays un-eased. Never animate the drag itself; only
  its aftermath — reflow, settle, snap.
- **No cross-surface container transition.** Each surface's own entrance reveal *is* the swap.
  `CockpitShell` swaps by plain conditional render — no `AnimatePresence`/`layoutId` at that level,
  because a container transition fights the per-surface entrances.

## Per-surface design specs

`docs/superpowers/specs/` — `2026-07-03-cockpit-motion-system-design.md`,
`2026-07-03-collapsible-rail-and-cockpit-motion-gaps-design.md`, `2026-07-03-sessions-motion-design.md`,
`2026-07-03-shared-modals-motion-design.md`, `2026-07-04-activity-motion-design.md`,
`2026-07-04-channels-motion-design.md`, `2026-07-04-cross-surface-ctrlp-motion-design.md`,
`2026-07-04-files-diff-motion-design.md`, `2026-07-04-memory-motion-design.md`,
`2026-07-04-settings-motion-design.md`, `2026-07-04-usage-motion-design.md`.

Baseline strip that prepped the revamp: commit `a1a2889d`. Cockpit motion system: commit `b3ccce07`.
