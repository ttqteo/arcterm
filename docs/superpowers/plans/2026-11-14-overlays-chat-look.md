# Overlays in the Chat look: the frosted fill

**Effort:** effort:7655bf18-619e-40cf-8805-5f4a6e5ac85e
**Spec:** `docs/superpowers/specs/2026-11-14-overlays-chat-look-design.md`
**Verify:** `node scripts/verify.mjs`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs overlays-frost-palette overlays-frost-menus overlays-frost-chat overlays-frost-agents overlays-frost-jarvis overlays-frost-toast context-menu notification-toasts notify-toast palette-scope-indicator modal-focus-home jobqueue-chip route-picker-flat consumers-popover initiative-popover tools-picker`
**Prototype:** .superpowers/design/overlays-chat-look/project/B-todays-scrim.dc.html

The spec leaves several calls to the builder. These are made here, with why, and every task follows them.

- **The class is `frost`**, a Tailwind 4 `@utility` in `frontend/tailwindsetup.css`: `background-color:
  var(--color-panel)` and a static `backdrop-filter: blur(18px)`. One word, reads as what it does, and it does not
  collide with any existing class (`grep -rn "\bfrost\b" frontend` finds only the `look: "frosted"` value). A site
  swaps its `bg-surface-raised` / `bg-surface` / `bg-modalbg` for `frost` and drops the old `bg-*`; radius, border,
  shadow and motion stay as they are (spec, Scope).
- **Where the class goes: on the outermost element of the floating panel**, preferably the `PopoverReveal`
  `className` itself when the caller puts its panel classes there. An element with `opacity < 1`, `filter`,
  `backdrop-filter`, `mask`, `clip-path` or `mix-blend-mode` is a backdrop root in Chromium/WebView2: a `frost` element
  nested inside one samples only what that root paints. `PopoverReveal`'s own opacity animation makes its motion.div a
  backdrop root while it fades, so a frosted child of it shows the real frost only once the fade ends; on the motion
  element itself the frost is real throughout. A panel nested inside another frosted panel (a submenu inside its
  menu) moves out of it, to a sibling or a portal, so each level frosts what is behind it (spec 2).
- **ModalShell's palette-only variant is a boolean prop `frosted`**, dialog variant only, not a third `ModalVariant`
  value: `ModalVariant` also types `registerModal` (`modalstack.ts`), where the palette must stay a plain dialog for
  Escape ownership and `anyDialogOpen`. With `frosted`, the scrim (`bg-black/60 backdrop-blur-sm`, `modalBackdrop`
  motion, mousedown-to-dismiss) renders as a sibling layer behind a `pointer-events-none` positioning container that
  holds the panel (`pointer-events-auto`, `frost` in place of `bg-modalbg`), so the panel's blur samples the dimmed,
  blurred cockpit. Without `frosted`, the markup is byte-for-byte today's.
- **The tray stays solid.** `frontend/tauri/tray.tsx` draws in its own OS window, with nothing of the app behind it
  to frost; a `backdrop-filter` there would show the window's transparent background.
- **Tooltips and title tips stay solid** (spec, Scope: `element/tooltip.tsx`, `element/titletiphost.tsx`,
  `view/term/term-tooltip.tsx`).
- **A popover inside a solid ModalShell dialog** (the New agent dialog's pickers) still takes `frost`: the scrim is
  its backdrop root, so it frosts the dialog panel behind it, which is the frost there is to have. That is not the
  nested-frost case above.
- **The panel alpha is computed, not hand-set per theme** (spec 5, as revised at plan review): `--color-panel` becomes
  `rgba(surfaceRaised, panelAlpha(palette))`, where `panelAlpha` returns the smallest alpha, starting at today's 0.6
  and stepping up by 0.02, at which muted text on the panel reaches 4.5:1 composited over the blurred backdrop: the
  theme's terminal background mixed with its brightest terminal colour at 20% coverage. One function covers every
  built-in theme and every custom one, and a theme that passes at 0.6 is unchanged (onedark, monokai, christmas).
  Chat's suggestion panel and the markdown blocks that read `--color-panel` (`markdown.scss:165,170`) get the same
  fix. `tailwindsetup.css`'s static `--color-panel` default follows the default theme's computed value.
- **Not overlays, so they stay solid:** `translatepanel.tsx`'s translate rail (a docked tool panel with its own
  body, a sheet in the spec's terms) and `code/codeviewer.tsx`'s line comment box (an inline editor card anchored to
  a line). The tray (below) and tooltips likewise.
- **No changed overlay ships without a Final step.** A task that frosts a site writes the arrange that opens it in its
  own `overlays-frost/<area>.mjs` (it may reuse `scenario(name)` and the helpers the existing scenarios import, such as
  `agent-page-fixtures.mjs`); a `skip` is not allowed for a changed site. Read a reused scenario's `arrange` before
  relying on it: some open their overlay in `assert` instead (`context-menu`'s arrange is a no-op).
- **`chat-redesign` is not in Final** although Task 2 edits the slash panel it checks: its step 16 (frame timing)
  already fails on main under load (initiative chunks 12 and 18), which would hold the land on noise. The slash
  panel's frost is checked by `overlays-frost-menus` step 4 instead.
- **The scenarios are one group, `overlays-frost-*`, one file per area** under `scripts/cdp/overlays-frost/`, so the
  tasks that run at the same time each own their own file. Task 1 lays down the registry and the shared check; each
  later task fills its own file. Final runs every `overlays-frost-*` scenario plus the existing scenarios that open
  these overlays.
- **The toast fill is measured once by the builder** (spec 4) with a timing scenario, `overlays-frost-toast-timing`,
  that Final does not run: the same terminal flood with a frosted and a solid toast, 3 passes each, frost kept if its
  frame p95 is within 2 ms of the solid toast's. The committed `overlays-frost-toast` scenario only checks the
  committed fill draws.

### Task 1: The frost class, the shared frost check, the scenario registry, DESIGN.md
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/tailwindsetup.css`, `DESIGN.md`, `CHANGELOG.md`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-overlays-frost.mjs`, `scripts/cdp/overlays-frost/frostcheck.mjs`, `scripts/cdp/overlays-frost/frostcheck.test.mjs`, `scripts/cdp/overlays-frost/palette.mjs`, `scripts/cdp/overlays-frost/menus.mjs`, `scripts/cdp/overlays-frost/chat.mjs`, `scripts/cdp/overlays-frost/agents.mjs`, `scripts/cdp/overlays-frost/jarvis.mjs`, `scripts/cdp/overlays-frost/toast.mjs`

- Add `@utility frost` to `frontend/tailwindsetup.css` (header decisions): `--color-panel` fill, static 18px
  `backdrop-filter` blur, tokens only, never animated. Confirm Tailwind generates it (a class used in a `.tsx` builds).
- `scripts/cdp/overlays-frost/frostcheck.mjs` exports the check every overlay task uses, and its signature is the
  interface they rely on:
  - `frostProbe(selector: string): string` returns a page expression for `h.ev` that evaluates to
    `{ found, backdropFilter, background, panel, blockedBy }`: the element's computed `backdrop-filter` and
    `background-color`, the computed value of `--color-panel` resolved to a color (read through a probe element, as
    `scenarios-agent-subagents.mjs:67` does), and `blockedBy`, a short `tag.class` description of the nearest ancestor
    that is a backdrop root (opacity < 1, `filter`, `backdrop-filter`, `mask`, `clip-path`, `mix-blend-mode` other
    than normal), or null.
  - `frostVerdict(r): { ok: boolean, detail: string }`: ok when found, the blur is `blur(18px)`, the background equals
    the panel color, and `blockedBy` is null; `detail` names what failed.
  - `solidVerdict(r)` the same for a solid fill (no blur, a background other than the panel), for the toast's solid
    fallback and the tooltips.
  - Unit-test `frostVerdict` / `solidVerdict` on hand-built results in `frostcheck.test.mjs` (vitest, run with
    `npx vitest run scripts/cdp/overlays-frost/frostcheck.test.mjs`; if vitest's config does not pick up
    `scripts/`, follow how `scripts/cdp/report.test.mjs` is run).
- `scripts/cdp/scenarios-overlays-frost.mjs` default-exports `(kit) => [...palette(kit), ...menus(kit), ...chat(kit),
  ...agents(kit), ...jarvis(kit), ...toast(kit)]`, importing each `overlays-frost/<area>.mjs`, each of which
  default-exports `(kit) => []` for now with a header comment naming the task that fills it and the scenario name it
  will hold (`overlays-frost-palette`, `-menus`, `-chat`, `-agents`, `-jarvis`, `-toast`). Register it in
  `scripts/cdp/scenarios.mjs` the way `scenarios-chat-redesign.mjs` is (import, spread with a kit). The kit is
  `CR_KIT` plus one lookup, `scenario(name)`, returning the registered scenario object of that name (resolved lazily,
  at call time, from the exported list), so a later task's step can run an existing scenario's `arrange` / `teardown`
  (the `consumers-popover`, `jobqueue-chip`, `notify-toast` fixtures) without editing `scenarios.mjs`, which this
  task owns until Task 3 (the only later task that may touch it, for palette selectors). `task verify:ui` with every overlays-frost area still empty must still
  run.
- DESIGN.md: move the frosted panel from the "Chat's floating box" exception to a rule for overlays (palette panel,
  context menus, popovers, menus, toasts use `frost`; the blur is static; a nested panel renders outside its frosted
  parent), name the two exceptions (the palette keeps the dialog scrim; tooltips and title tips stay solid), and keep
  Chat's 22px box, its functional fade and its 16px panel radius Chat-only. Update the "Modals" bullet to mention the
  palette's `frosted` ModalShell.
- CHANGELOG.md: one `Changed` line under the top `Unreleased` section (open one if the top section has a date): menus,
  popovers and the command palette are frosted like Chat's suggestion panel. Toasts are left out of the line; Task 8
  adds them if its measurement keeps them frosted.

Acceptance: `npx vitest run scripts/cdp/overlays-frost/frostcheck.test.mjs` passes; `task check:ts` passes;
`node --input-type=module -e "await import('./scripts/cdp/scenarios.mjs')"` loads the registry without error.

### Task 2: Context menus and picker dropdowns
**Depends on:** Task 1
**Model:** opus
**Files:** `frontend/app/element/contextmenu.tsx`, `frontend/app/view/agents/pickerlist.tsx`, `scripts/cdp/overlays-frost/menus.mjs`

- `contextmenu.tsx`: `PANEL` takes `frost` in place of `bg-surface-raised` (its 28 callers need nothing). The submenu
  today renders inside its parent's `PANEL` (`MenuRow`, `submenuOpen`), which makes the parent its backdrop root:
  render each submenu outside the parent panel (a sibling layer under the same floating container, or its own
  `FloatingPortal`), placed beside its row as today (`flipLeft`, `top-[-5px]`). Hover, the arrow keys (Right opens,
  Left closes), Enter, Escape, click-outside dismiss and focus behave exactly as today; the existing `context-menu`
  scenario keeps passing. Put the frost on the `PopoverReveal` element (header decisions).
- `pickerlist.tsx`: both looks draw on `frost`. The frosted look's spelled-out `bg-panel … backdrop-blur-[18px]`
  becomes `frost`; the plain look's two `bg-surface` panels (`pickerlist.tsx` ~295 and ~323) become `frost`. The
  split then differs in placement and radius only. Row highlight classes stay as they are unless the contrast on the
  frost reads worse than on the solid panel: then the plain look takes the frosted look's highlight.
- Fill `scripts/cdp/overlays-frost/menus.mjs` with scenario `overlays-frost-menus`, over a working agent (reuse the
  fixtures `scenarios-chat-redesign.mjs` uses): step 1 opens a context menu itself, the way the `context-menu`
  scenario's `assert` does (its `arrange` is a no-op), with a menu that has a submenu, and runs `frostVerdict` on its panel; step 2 opens a submenu, checks both levels with `frostVerdict` (each
  `blockedBy` null) and that the submenu is not a descendant of the parent panel; step 3 moves through the submenu with
  the keys and closes it with Left then Escape; step 4 opens Chat's slash panel (frosted look) and step 5 a plain-look
  PickerList (the launcher's or another list outside Chat), each through `frostVerdict`. Each step screenshots.

Acceptance: `overlays-frost-menus` and `context-menu` pass in a dev app of the task's own
(`node scripts/cdp/final-verify.mjs overlays-frost-menus context-menu`); `task check:ts` passes.

### Task 3: The command palette frosted over today's scrim
**Depends on:** Task 1 (uses the `frost` class and the frost check)
**Model:** opus
**Files:** `frontend/app/modals/modalshell.tsx`, `frontend/app/cockpit/command-palette.tsx`, `scripts/cdp/overlays-frost/palette.mjs`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-modal-focus-home.mjs`, `scripts/cdp/scenarios-palette-brainstorm-resume.mjs`

- Add `frosted?: boolean` to `ModalShell` (header decisions; dialog variant only, ignored for a sheet). With it, the
  scrim is a sibling `motion.div` behind the positioning container, not its parent; the scrim keeps
  `modalBackdrop`, `bg-black/60 backdrop-blur-sm` and the backdrop-click dismiss (`dismissOnBackdrop`); the positioning
  container is `pointer-events-none` (so a click outside the panel reaches the scrim) and keeps `align` / `topClass`;
  the panel keeps `modalPanel`, `role="dialog"`, `aria-modal`, `panelRef`, `tabIndex`, the Christmas lights and the
  Esc / Ctrl+Enter / focus-trap behaviour, and draws `frost` in place of `bg-modalbg`. AnimatePresence plays both
  layers' exits. Without `frosted`, today's markup is unchanged, so the other 30 ModalShell users are untouched.
- `command-palette.tsx`: pass `frosted` to its `ModalShell`. Check every scenario that reaches the palette's scrim or
  its dialog through the DOM tree (`grep -n "palette" scripts/cdp/*.mjs` for `parentElement`, `role="dialog"`,
  `bg-black`, backdrop clicks) and keep them passing; if one walks the old parent/child shape, change its selector
  (the scenario files that can hold such a walk are on this task's Files line; touch only the palette's selectors in
  them).
- Fill `scripts/cdp/overlays-frost/palette.mjs` with scenario `overlays-frost-palette`, matching the board
  `B-todays-scrim.dc.html` (the palette frosted over the dialog scrim, in front of a working agent): step 1 opens the
  palette over a working agent and screenshots; step 2 runs `frostVerdict` on the dialog panel (`blockedBy` null: the
  scrim is not its ancestor) and checks the scrim still draws black 60% with its blur; step 3 checks the open motion
  ran (the panel's opacity reached 1 from below 1); step 4 presses Tab several times and checks focus stays inside the
  panel; step 5 closes with Escape and checks the panel and scrim are gone; step 6 reopens and clicks the scrim
  outside the panel, which closes it; step 7 reopens, clicks inside the panel, which keeps it open.

Acceptance: `node scripts/cdp/final-verify.mjs overlays-frost-palette palette-scope-indicator modal-focus-home` passes;
`task check:ts` passes.

### Task 4: Chat and council popovers
**Depends on:** Task 1 (uses the `frost` class and the frost check)
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatfooter.tsx`, `frontend/app/view/agents/chatplusmenu.tsx`, `frontend/app/view/agents/chatinitiativecard.tsx`, `frontend/app/view/agents/councilchat.tsx`, `frontend/app/view/agents/councilmemory.tsx`, `frontend/app/view/agents/councilseats.tsx`, `frontend/app/view/agents/councilsetup.tsx`, `frontend/app/view/agents/linereviewtray.tsx`, `frontend/app/view/agents/sticktobottom.tsx`, `frontend/app/view/agents/docoutlineview.tsx`, `frontend/app/view/agents/harnesspicker.tsx`, `frontend/app/view/agents/routepicker.tsx`, `frontend/app/view/agents/councilsourcespanel.tsx`, `scripts/cdp/overlays-frost/chat.mjs`

- Each file above is a candidate; per the spec (section 2), a floating panel that is a menu or a popover takes
  `frost` in place of its `bg-*` fill, on its outermost element (header decisions); a card, sheet, strip or button
  that only carries `shadow-popover*` stays. Decide each site by that rule and list in the report which sites changed
  and which stayed, with why.
- Nested frost: `chatfooter.tsx`'s `SUBMENU` panels (effort, more models) render inside the `MENU` panel; move them
  out of it (a sibling under a wrapper with no fill) so each frosts what is behind it, keeping their placement beside
  the menu's right edge, bottoms level, and the keys and hover as today. Check every other site in this list for the
  same nesting.
- Fill `scripts/cdp/overlays-frost/chat.mjs` with scenario `overlays-frost-chat`: one step per changed site that opens
  it (reuse the fixtures of `scenarios-chat-redesign.mjs`, `scenarios-chat-council.mjs` and the existing route /
  harness picker scenarios), runs `frostVerdict` on its panel and screenshots; the chat footer's model menu and its
  effort submenu get a step each. A site no existing scenario opens gets its arrange written in `chat.mjs` (store
  sets or fixtures, as the existing scenarios do); no step for a changed site is a `skip`.

Acceptance: `node scripts/cdp/final-verify.mjs overlays-frost-chat route-picker-flat` passes; `task check:ts` passes.

### Task 5: Agent sidebar, launcher and Radar popovers
**Depends on:** Task 1 (uses the `frost` class and the frost check)
**Model:** sonnet
**Files:** `frontend/app/view/agents/agentrow.tsx`, `frontend/app/view/agents/projectswitcher.tsx`, `frontend/app/view/agents/machineserverspanel.tsx`, `frontend/app/view/agents/consumerspanel.tsx`, `frontend/app/view/agents/initiativepopover.tsx`, `frontend/app/view/agents/initiativechunkmenu.tsx`, `frontend/app/view/agents/launcheragentfields.tsx`, `frontend/app/view/agents/launchertoolfields.tsx`, `frontend/app/view/agents/refpicker.tsx`, `frontend/app/view/agents/toolpicker.tsx`, `frontend/app/view/agents/tabswitcherview.tsx`, `frontend/app/view/agents/usageleversbody.tsx`, `frontend/app/view/agents/sessionpeek.tsx`, `frontend/app/view/agents/backgroundtaskpeek.tsx`, `frontend/app/view/agents/radarfindingdetail.tsx`, `frontend/app/view/agents/radarsurface.tsx`, `frontend/app/view/agents/cockpitoffice.tsx`, `frontend/app/view/agents/launchermodal.tsx`, `frontend/app/view/agents/diffpane.tsx`, `frontend/app/view/agents/sourcepicker.tsx`, `frontend/app/view/agents/canvaslinkpicker.tsx`, `frontend/app/view/agents/docreviewnotesview.tsx`, `scripts/cdp/overlays-frost/agents.mjs`

- The same rule and report as Task 4 for each candidate above. `launcheragentfields.tsx` and `refpicker.tsx` draw on
  `bg-modalbg` inside the New agent dialog; they take `frost` too (header decisions: inside a solid dialog the scrim
  is the backdrop root, and the frost blurs the dialog panel behind them). Check each for a nested frosted panel.
- Fill `scripts/cdp/overlays-frost/agents.mjs` with scenario `overlays-frost-agents`: one step per changed site that
  opens it, runs `frostVerdict` and screenshots (reuse the fixtures of `consumers-popover`, `initiative-popover`,
  `tools-picker` and the Radar and sidebar scenarios in `scenarios.mjs`). A site no existing scenario opens gets its
  arrange written in `agents.mjs`; no step for a changed site is a `skip`.

Acceptance: `node scripts/cdp/final-verify.mjs overlays-frost-agents consumers-popover initiative-popover tools-picker`
passes; `task check:ts` passes.

### Task 6: Jarvis, Code and Jobs popovers
**Depends on:** Task 1 (uses the `frost` class and the frost check)
**Model:** sonnet
**Files:** `frontend/app/cockpit/jobqueuepanel.tsx`, `frontend/app/view/code/codereviewbar.tsx`, `frontend/app/view/code/codesurface.tsx`, `frontend/app/view/jarvis/autonomyladderview.tsx`, `frontend/app/view/jarvis/initiativepicker.tsx`, `frontend/app/view/jarvis/inlinetrackerview.tsx`, `frontend/app/view/jarvis/chunkview.tsx`, `frontend/app/view/jarvis/petbubble.tsx`, `frontend/app/view/jarvis/pethidemenu.tsx`, `frontend/app/view/jarvis/petpeek.tsx`, `frontend/app/element/search.tsx`, `scripts/cdp/overlays-frost/jarvis.mjs`

- The same rule and report as Task 4 for each candidate above. The Jobs popover (`jobqueuepanel.tsx`) is the spec's
  named popover example and must take `frost`. `frontend/tauri/tray.tsx` stays solid (header decisions) and is not
  edited.
- Fill `scripts/cdp/overlays-frost/jarvis.mjs` with scenario `overlays-frost-jarvis`: step 1 opens the Jobs popover
  over a working agent (the `jobqueue-chip` fixtures), runs `frostVerdict`, screenshots; then one step per other
  changed site, as in Task 4, with its arrange written in `jarvis.mjs` where no existing scenario opens it; no step
  for a changed site is a `skip`.

Acceptance: `node scripts/cdp/final-verify.mjs overlays-frost-jarvis jobqueue-chip` passes; `task check:ts` passes.

### Task 7: The panel alpha meets the muted-text floor in every theme
**Depends on:** Task 1
**Model:** sonnet
**Files:** `frontend/app/view/agents/themes.ts`, `frontend/app/view/agents/themes.test.ts`, `frontend/tailwindsetup.css`

- Add a pure, exported `panelAlpha(palette)` in `themes.ts` (header decisions): the smallest alpha from 0.6 upward in
  0.02 steps (capped at 1) at which the theme's muted text color reaches a WCAG contrast of 4.5:1 against
  `surfaceRaised` at that alpha composited over the blurred backdrop: the theme's terminal background (`p.bg`) mixed
  with its brightest terminal colour (the highest-luminance of the terminal foreground and the ANSI colors
  `deriveAnsi` gives) at 20% coverage (spec 5, revised). `--color-panel` (`themes.ts` ~498) uses it. The expected
  alphas, measured at plan review: graphite 0.66, claude 0.66, midnight 0.82, slate 0.70, carbon 0.72, nocturne 0.80,
  spider 0.66, onedark / monokai / christmas 0.60; a different result means the model was read differently, so check
  it against the spec before changing the test.
- `themes.test.ts` checks `--color-panel` against the literal in `frontend/tailwindsetup.css:19`: update that default
  to the default theme's computed value (graphite's) so the two stay one value. Reuse
  the file's existing color helpers (`rgba`, luminance or contrast helpers if present) rather than adding a second
  copy.
- `themes.test.ts`: every built-in theme's `--color-panel` passes 4.5:1 for muted text by the rule above; a theme that
  passes at 0.6 keeps 0.6; a hand-built low-contrast palette gets a raised alpha that passes and one step lower that
  does not. Report each built-in theme's alpha. `markdown.scss:165,170` read the same token and need no edit.

Acceptance: `npx vitest run frontend/app/view/agents/themes.test.ts` passes; `task check:ts` passes. The frost steps of
`overlays-frost-menus` (Task 2) show the panel this token draws.

### Task 8: Toasts: measure, commit the fill, check it draws
**Depends on:** Task 1 (uses the `frost` class and the frost check)
**Model:** opus
**Files:** `frontend/app/cockpit/notificationtoasts.tsx`, `scripts/cdp/overlays-frost/toast.mjs`, `DESIGN.md`, `CHANGELOG.md`

- Add scenario `overlays-frost-toast-timing` to `toast.mjs` (Final does not run it): over a streaming agent terminal
  (the terminal flood of `scripts/cdp/termflood.mjs` or the frame-timing step of `scenarios-chat-redesign.mjs`), show a
  toast and measure `requestAnimationFrame` intervals; in one run, 3 passes with the toast forced frosted and 3 with
  it forced solid (a class swap on the toast's panel, the `motion.div` parent of `[data-notification-toast]`, from the
  scenario is enough; no app flag). Report each pass's p95
  and worst frame.
- Run it once (`node scripts/cdp/final-verify.mjs overlays-frost-toast-timing`), and commit the fill: if the frosted
  p95 (median of its passes) is within 2 ms of the solid one, the toast in `notificationtoasts.tsx` swaps `bg-surface`
  for `frost`; otherwise it keeps `bg-surface`, and DESIGN.md's overlay rule names toasts as a third exception with the
  numbers. If frosted, add toasts to the CHANGELOG line Task 1 wrote. Either way, write the measured numbers, the date, the commit measured and the decision into
  `toast.mjs`'s header, the way `scenarios-chat-redesign.mjs:18-22` records its baseline.
- Add scenario `overlays-frost-toast` to `toast.mjs`: over a working agent, raise a toast (the way `notify-toast` /
  `notification-toasts` do), screenshot it, and run `frostVerdict` (or `solidVerdict` if the measurement kept it solid)
  on the toast's panel, which is the `motion.div` parent of `[data-notification-toast]` (the button inside carries no
  fill). It does not re-measure.

Acceptance: `node scripts/cdp/final-verify.mjs overlays-frost-toast notification-toasts` passes; the report gives the
measured numbers and the decision; `task check:ts` passes.
