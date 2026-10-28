# Palette scope tab indicator Implementation Plan

> **For agentic workers:** each task below is one worker's. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The command palette's active-scope underline slides from the old tab to the new one on every scope
change while the palette is open, and appears in place (no slide) when the palette opens.

**Architecture:** A new `indicatorSlide` transition lands in the motion token module. `PaletteScopeTabs` drops the
inset box-shadow and renders a `motion.span` with `layoutId="palette-scope-indicator"` inside the active button,
wrapped in a `LayoutGroup` whose id changes once per open, so no open can slide from an earlier open's (or the
stale first render's) snapshot. A CDP scenario samples the bar's rect per animation frame to prove the slide, the
landing, the no-slide open and reduced motion.

**Tech Stack:** React 19, `motion/react` (Framer Motion), Tailwind 4, vitest, CDP scenarios.

**Spec:** `C:\Users\kael02\IdeaProjects\waveterm\docs\superpowers\specs\2026-10-28-palette-scope-indicator-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/util/envutil`
**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit && node --check scripts/cdp/scenarios.mjs`
**Final:** `node scripts/cdp/final-verify.mjs palette-scope-indicator palette-actions surface-smoke`

## Decisions beyond the spec, and why

- **D1. The per-open guard is a `LayoutGroup` id keyed on an open counter.** `CommandPalette` keeps
  `const [openGen, setOpenGen] = useState(0)` and bumps it inside the existing open effect
  (`command-palette.tsx`, the effect that calls `setNav({ ...initialNav(...) })`), in the same effect call as that
  `setNav`, so both land in one render. `PaletteScopeTabs` wraps its buttons in
  `<LayoutGroup id={`palette-scope-${openGen}`}>`. Why: `nav` survives a close (the component stays mounted), so the
  first render after open shows the *previous* open's scope, and the effect then switches it; that switch is a
  layoutId change and would slide. Framer prefixes a `layoutId` with its group id, so the render that applies the
  fresh `nav` also mounts the bar under a new id with no snapshot, and it appears in place. The stale render uses the
  old id and is never animated to. A `key` alone would not do it (a remounted `layoutId` animates from the previous
  element's snapshot), and gating the `transition` would need a second "first settled render" flag in the strip. The
  same group answers the spec's isolation question: the strip's layout ids cannot pair with any other layout
  animation in the modal.
- **D2. Leaving a note draft does not bump `openGen`.** The strip remounts on the same scope and group, so the bar
  draws in place (spec, agent's call). Only the open effect bumps it.
- **D3. The bar keeps today's exact position: `absolute inset-x-0 bottom-0 h-[2px]` inside the `relative` button,
  no negative offset, no z-index.** The inset shadow it replaces paints the button's bottom 2px, which sits directly
  on top of the strip's `border-b` (the border is outside the buttons' box). Same box, same pixels; the spec's
  "unchanged at rest" governs.
- **D4. The bar carries `data-palette-scope-indicator`** so the scenario can find it; `aria-hidden` per the spec.
- **D5. `indicatorSlide` is typed `Transition` from `motion/react`**, value
  `{ duration: MOTION.durMacro, ease: MOTION.easeFluid }`, passed as the `motion.span`'s `transition` (it governs
  the layout animation, so position and width move together).
- **D6. The scenario samples in-page.** One `Runtime.evaluate` dispatches the key and records the bar's and the
  target button's `getBoundingClientRect()` on every `requestAnimationFrame` for ~600 ms, then returns the array
  (`h.ev` awaits promises). A CDP round trip per sample is too slow to catch a front-loaded 360 ms ease. Rects are
  compared bar-to-button in the same frame, so the modal's open scale does not skew them.
- **D7. Reduced motion is checked live** with `Emulation.setEmulatedMedia` (`prefers-reduced-motion: reduce`),
  reset in teardown: `MotionConfig reducedMotion="user"` in `ModalShell` is the spec's mechanism, and a frame
  sample is the only proof it reaches layout animations.

## Global Constraints

- Timing: `MOTION.durMacro` (0.36 s) with `MOTION.easeFluid` (`[0.22, 1, 0.36, 1]`); import from
  `frontend/app/element/motiontokens.ts`, never inline values.
- At rest: a 2px `bg-accent` bar along the active tab's bottom edge, full tab width; active label `text-primary`,
  others `text-muted hover:text-secondary`, switched instantly. The Needs you count is untouched.
- Literal `layoutId="palette-scope-indicator"`; no other tab strip changes.
- No raw colors (`bg-accent` token only); no new tokens.
- Non-goals: other tab strips, hover preview, animating label text, animating the results swap.

## Review Focus

1. Reopening the palette on a different scope than it closed on (close on Runs, reopen on Code, which opens on
   Files): the bar must be under Files from the first sampled frame, never sliding from Runs. Scenario step 5.
2. Holding Tab (several Tab presses a frame apart): no queued slides; the bar lands under the last tab within one
   `durMacro` of the last press. Scenario step 4.
3. Backspace on an empty query in a narrowed scope drops to All and slides (spec, agent's call). Scenario steps 2 and 3.
4. Reduced motion: the bar snaps, no intermediate frame. Scenario step 6.
5. Width between tabs of different width (click Go to, then click Files): the settled width equals the target
   button's width, not the source's. Scenario step 3; every step asserts width, not only x.

---

### Task 1: `indicatorSlide` motion token
**Depends on:** none
**Files:** `frontend/app/element/motiontokens.ts`, `frontend/app/element/motiontokens.test.ts`, `docs/reference/motion-system.md`

**Interfaces:**
- Produces: `export const indicatorSlide: Transition` in `frontend/app/element/motiontokens.ts` (Task 2 imports it).

- [ ] **Step 1: Write the failing test** in `motiontokens.test.ts` (append; do not rewrite the file):
  `describe("indicatorSlide")` → `it("moves a shared-layout indicator on the macro duration and the fluid ease")`
  asserting `expect(indicatorSlide).toEqual({ duration: MOTION.durMacro, ease: MOTION.easeFluid })` and
  `expect(indicatorSlide.duration).toBeCloseTo(0.36)`.
- [ ] **Step 2:** `npx vitest run frontend/app/element/motiontokens.test.ts` → FAIL (no export).
- [ ] **Step 3: Implement** the token next to `paneReveal`, with a lower-case "why" comment: a shared-layout
  indicator moving between siblings; `durMacro` because `easeFluid` front-loads the travel, so the bar arrives in
  the first frames and the rest is settle, where `durMicro` over a long jump reads as a snap. Named for the pattern
  so a later tab strip reuses it.
- [ ] **Step 4:** the same vitest command → PASS.
- [ ] **Step 5: Docs.** `docs/reference/motion-system.md`: add `indicatorSlide` to the `motiontokens.ts` row's
  preset list in the "Shared foundation" table, and add a moments-table row (next number after the last) "Active-tab
  indicator slide | Framer | `indicatorSlide` on a `layoutId` bar (command palette scope tabs)".
- [ ] **Step 6:** run the Check line; commit.

### Task 2: The sliding bar in the scope strip
**Depends on:** Task 1 (imports `indicatorSlide`)
**Files:** `frontend/app/cockpit/palette-chrome.tsx`, `frontend/app/cockpit/command-palette.tsx`

**Interfaces:**
- Consumes: `indicatorSlide` from `@/app/element/motiontokens`.
- Produces (DOM contract Task 3's scenario relies on): the active scope button (`[data-palette-scope=<id>]`,
  `aria-pressed="true"`) contains exactly one `span[data-palette-scope-indicator]`; no other button contains one;
  the button no longer has the inset box-shadow class.
- `PaletteScopeTabs` gains a required prop `openGen: number`.

- [ ] **Step 1: `palette-chrome.tsx`.** Per D1, D3, D4, D5: wrap the mapped buttons in
  `<LayoutGroup id={`palette-scope-${openGen}`}>`; the button gets `relative`; the active class becomes `text-primary`
  only; the active button renders
  `<motion.span layoutId="palette-scope-indicator" data-palette-scope-indicator aria-hidden transition={indicatorSlide} className="absolute inset-x-0 bottom-0 h-[2px] bg-accent" />`.
  Inactive classes and the Needs you count stay as they are.
- [ ] **Step 2: `command-palette.tsx`.** Per D1, D2: add `openGen` state, bump it in the open effect beside its
  `setNav` call (only there), and pass it to `<PaletteScopeTabs openGen={openGen} … />`.
- [ ] **Step 3:** run the Check line → exit 0. Run `npx vitest run frontend/app/cockpit` → PASS (no palette model
  test changes; this proves nothing regressed in the pure palette logic).
- [ ] **Step 4: Acceptance** is proven in Final by Task 3's `palette-scope-indicator` scenario: steps 1-3 (slide
  and landing on Tab, Shift+Tab wrap, Backspace, a click, a prefix), step 4 (held Tab), step 5 (reopen on a
  different scope shows no slide), step 6 (reduced motion snaps). This tree does not hold that scenario; the live
  check is left to Final.
- [ ] **Step 5:** commit.

### Task 3: `palette-scope-indicator` CDP scenario
**Depends on:** none
**Files:** `scripts/cdp/scenarios.mjs`

**Interfaces:**
- Consumes: the DOM contract in Task 2's Interfaces block, and the existing palette helpers in `scenarios.mjs`
  (`PALETTE_INPUT`, `PALETTE`, `paletteKey`, `openPalette`, `setInputExpr`, `PEEKS_ESC`, `polishWaitFor`,
  `MODELS_VIEWPORT`). Do not edit Task 2's files; this task is written against the contract and proven in Final.
- Produces: scenario `palette-scope-indicator`, registered in `SCENARIOS` next to `paletteActions`.

Place it beside the palette-actions block, with a header comment naming the spec. `surface: "jarvis"`; pin the
viewport with `MODELS_VIEWPORT` first. No arrange data is needed (scopes render without rows). Keep the file's
4-space hand formatting; never run prettier on it.

Add a helper (D6), e.g. `sampleIndicator(h, actionExpr, targetScope, ms = 600)`, that evaluates one in-page
promise: run `actionExpr`, then on each animation frame push
`{ t, bar: rect of [data-palette-scope-indicator], target: rect of [data-palette-scope=<targetScope>] }` until `ms`
elapses, and resolve the array. "Matches" below means `|bar.left - target.left| <= 1` and
`|bar.width - target.width| <= 1`; "mid-flight" means a frame where `bar.left` is strictly between the source and
target buttons' left edges (more than 2px from each).

Steps (each a `rec(step, ok, detail)` with the sampled numbers in `detail`; shots to `cdp-shots/palette-scope-indicator-*.png`).
A prefix narrows only from All with an empty query (`typeQuery`, `palette-scope.ts`), so every prefix below is typed
from All; each step states the scope it starts on.

- [ ] **1.** Open the palette with `openPalette` (Jarvis opens on All). Tab → Needs you: at least one mid-flight
  frame; the last frame matches Needs you; exactly one indicator in the dialog, inside the `aria-pressed="true"`
  button. Shot at rest after it settles.
- [ ] **2.** From Needs you, Shift+Tab → All (sampled: last frame matches All). Shift+Tab again wraps All →
  Commands, the far jump: at least one mid-flight frame, last frame matches Commands. Backspace on the empty query
  (`paletteKey("Backspace")`) → All: at least one mid-flight frame, last frame matches All. Then the mid-slide shot:
  dispatch Shift+Tab (All → Commands) and call `h.shot` at once, recording in `detail` the bar's left at capture and
  both buttons' lefts. The shot is illustrative; this step passes on the sampled frames, not on the shot. Backspace
  back to All and let it settle.
- [ ] **3.** From All, click the Go to tab and let it settle, then click the Files tab (sampled): last frame matches
  Files, width included, and differs from Go to's width. Backspace → All. Type `f:` with `setInputExpr` into the
  empty query (sampled): scope is Files (`data-palette-token` reads Files), at least one mid-flight frame, last frame
  matches Files. Backspace → All.
- [ ] **4.** Held Tab, from All: dispatch Tab four times, one per animation frame, inside one sample; within 600 ms
  of the last press the bar matches Runs (All → Needs you → Go to → Agents → Runs), and no frame after the last press
  has the bar moving away from it.
- [ ] **5.** Reopen with `openPalette` (it closes the open palette first; Jarvis opens on All), type `r:` → Runs,
  close it (`PEEKS_ESC`), `h.goto("code")`, reopen: start sampling from the toggle, wait for the indicator; on every
  frame where both exist, the bar matches Files (Code opens on Files), never Runs. Shot after it settles.
- [ ] **6.** `Emulation.setEmulatedMedia` with `prefers-reduced-motion: reduce`; Tab once: no mid-flight frame, the
  first frame with the new `aria-pressed` already matches. Teardown resets the media emulation and closes the
  palette whatever failed.
- [ ] **7.** Run the Check line; confirm `palette-scope-indicator` is in `SCENARIOS`. Its live pass is proven in
  Final (it fails before Task 2 lands). Commit.
