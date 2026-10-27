# Port Kael's Brainstorm mode: fix round 1

Fix round 1 of run 6631d157, for the two defects the final stage and Task 9 found on the merged result. The
run's plan is `docs/superpowers/plans/2026-10-27-port-brainstorm-mode.md`; its Verify, Check and Final apply unchanged.

### Task 1: Brainstorm scenarios no longer open the Jarvis popup by a mouse click

**Depends on:** none

The final stage failed `brainstorm-hints` steps 1b (`{"opened":false}`) and 3 (`{"footer":"ctrl+p palette"}`),
with 180 of 182 steps passing. The cause is in the scenarios, not the app. `bsMouseClick` (`scripts/cdp/scenarios.mjs`,
about l.27909) presses the mouse at the centre of its element. In `brainstorm-mode` step 7c2, the line box
(`[data-brainstorm-line-box] textarea`) sat under main's Jarvis creature (`petview.tsx`, `fixed z-[60]`, wandering at
the bottom of the window), so the press clicked the creature, which opened the Jarvis popup ("Nothing waiting on
you"). The popup counts as a modal (`dispatcher.ts`, `petPeekOpenAtom`): from then on the new-agent chord did nothing
and the footer kept only `ctrl+p palette`. It stayed open through every later scenario (see the final shots
`brainstorm-mode-10.png`, `brainstorm-approve-run.png`, `brainstorm-hints-1.png`).

- `bsMouseClick` hit-tests before it presses. If `document.elementFromPoint(x, y)` at the centre is not the element or
  inside it, it does not press the mouse there. It either picks a visible point of the element that is its own, or
  falls back to `el.focus()` plus `el.click()`, and says which in its return value. A press must never land on
  another element.
- Every brainstorm scenario's arrange starts with the Jarvis popup closed: `closePeek` through its close button
  (`[data-pet-peek] button[aria-label="Close Jarvis panel"]`, as another scenario already does), or Escape when it is
  open. Use one helper for this, called from `bsArrangeAgent`, `brainstorm-mode`'s own arrange and
  `brainstorm-hints`'s assert before step 1.
- Run `brainstorm-hints` with the popup closed. If step 3 still fails, look at what has focus when the pane opens
  (the answer box `autoFocus`es, and `b` is the pane's key only outside a field), and make the step put the focus
  where the step's text says, "with the pane focused". Don't loosen the step's assertion.

**Files:** `scripts/cdp/scenarios.mjs`

**Acceptance:** `node scripts/cdp/final-verify.mjs brainstorm-mode brainstorm-hints brainstorm-approve-run` passes
with no Jarvis popup in any of their shots. Steps 1b and 3 of `brainstorm-hints` pass.

### Task 2: The brainstorm pane fits a narrow width, beside the details rail

**Depends on:** Task 1

The person's call (2026-10-27): the details rail stays beside a brainstorm, as it does beside a canvas, and the pane's
rows fit a narrow width, so the pane holds at any window size. At the dev window's 1600×950 with the rail open, the
pane is about 514 px wide, and Task 9 found three places that break:

- **Confirm the design** (the `design` view, `brainstormpane.tsx`): a decision row's value column wraps one word per
  line (`brainstorm-review-skim-ready.png`: "Left to the builder" / "The strength formula, where…").
- **The check review** (`brainstormcheck.tsx` / `brainstormreview.tsx`): each changed row's buttons ("Keep the change",
  "Put mine back") take most of the row, so its text wraps one word per line, and the cause line measured zero width
  (`[542,358,0,158]`, `brainstorm-check-review-open.png`).
- **The approve bar**: its text wraps one word per line and "Approve and start run" is clipped at the pane's edge
  (`brainstorm-approve-run-1.png`).

Fix the layout, not the content. Below a width threshold, a row stacks its label, value and buttons instead of
squeezing them side by side: use a container query or a measured width, never the window's width, because the rail
and the tree decide the pane's width. A button's text never wraps or clips. Keep the wide layout as it is now. Follow
`DESIGN.md` (tokens, no raw colours, no animated size changes). Take the narrow rule from the pane's own components,
not from a new shared one.

The scenarios' rail workaround goes: `brainstorm-mode` step 2l3 and `brainstorm-check-review` step 3 hide the details
rail through `bsRail` while they read and click. They now run with the rail open. Add assertions where those steps and
`brainstorm-approve-run` read these rows. Every changed row's text is wider than its buttons, the cause line has a
non-zero width, and the approve button lies wholly inside the pane. Measure with `getBoundingClientRect`.

**Files:** `frontend/app/view/agents/brainstormpane.tsx`, `frontend/app/view/agents/brainstormcheck.tsx`,
`frontend/app/view/agents/brainstormreview.tsx` (and the pane's other `brainstorm*.tsx` only where a row lives there),
`scripts/cdp/scenarios.mjs`

**Acceptance:** `node scripts/cdp/final-verify.mjs brainstorm-mode brainstorm-review-skim brainstorm-check-review brainstorm-approve-run`
passes with the rail open. The shots show the design rows, the check review and the approve bar readable at about
514 px, with no one-word-per-line wrapping and no clipped button.
