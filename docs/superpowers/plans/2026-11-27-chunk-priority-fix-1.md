# Chunk priority, fix round 1: the stale rail and link scenarios, and the rail step's order

**Spec:** `docs/superpowers/specs/2026-11-27-chunk-priority-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/waveobj ./pkg/jarvis ./pkg/jarvisstate ./pkg/dume ./pkg/wavevault ./cmd/wsh/cmd`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chunk-priority chunk-priority-rail jarvis-initiative-sheet rail-initiative-tab initiative-link`

Round 1's Final failed 16 of 33 steps. The full step details are in
`<data dir>/final-shots/80fa0a7a-d7ca-4d28-8872-6ddb0b7fd643/1/shots.json`, and the
screenshots are in `cdp-shots/` beside it. `chunk-priority`, `chunk-priority-rail` and `jarvis-initiative-sheet` passed
in full. `rail-initiative-tab` passed 4 of 17 steps and `initiative-link` 3 of 7. Both of those passed in full on
2026-11-20 (final-shots `051d5084…/2`), before two base commits:

- `8c547fd79` (2026-11-21): a letter typed while the focus is off every field goes into the focused agent's chat box.
- `9819ff687` (2026-11-21): in Chat the bare-letter agent keys stand down (`chatTakesLetters` in
  `frontend/app/store/keybindings/bindings.ts`), and each one gains an Alt twin. `Alt+I` is `agent:initiative-alt`.

What the step details show:

- `rail-initiative-tab` step 1: after `focusSurface` and `press(h, "i")` the selected tab is still `overview`, and the
  bubbles of step 4 show the typed drafts. The `i` went into the chat box.
- Steps 2–9, 12 and 15 build on the tab opened by `i` and fail as a cascade. For example, step 12 reads "3 to review"
  because step 8's Accept never ran.
- `initiative-link` 3c and 4 press `i` the same way: the keyboard does not reach the tab in 3c, and no picker opens in 4.

This run's own code does not touch the keys, the rail pane or the link handler beyond `nextChunk`
(`git diff 18beabeb7 748c55e`). The scenarios are stale against the base, and they still hold the land.

### Task 1: The rail and link scenarios drive the Initiative keys the way the app takes them now, and the rail step checks 4 then 3
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios-rail-brainstorm-initiative.mjs`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-chunk-priority.mjs`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/view/agents/agentrailpanel.tsx`, `frontend/app/view/agents/agentrailtabs.ts`

This run's agents run no CDP (`ARC_RUN_AGENT`), so Final is the only live check. Work from the code and the step
details in `shots.json` above, and say in the report which fixes are read from code rather than seen.

- **`rail-initiative-tab`** (`scripts/cdp/scenarios-rail-brainstorm-initiative.mjs`):
  - Every place that means "open the tab from the surface" while the agent is in Chat (`openTab`, step 1, and any
    other `press(h, "i")` that is not already inside the tab) must reach `agent:initiative`. Use one of these:
    - the Alt twin `Alt+I`;
    - the way `scenarios-chunk-priority.mjs` step 1 does it, which passed: blur the active element, focus
      `[data-cockpit-surface-wrap]`, then send a key with its `code`, `text` and `windowsVirtualKeyCode`.
  - Pick whichever `buildAgentBindings` / `chatTakesLetters` really let through in Chat today.
  - Keep each step's `rec` text true. If a step now presses `Alt+I`, the text says `Alt+I`, not `i`.
  - Step 10 ("i goes back" with the keyboard in the tab) and step 13 (Terminal view) passed. Leave them as they are.
  - After the key fix, re-read steps 12 and 16 against the code. Step 12 expects "2 to review" after step 8's Accept,
    so it should hold once step 8 runs. In step 16 everything held except `onRow:false`: the tab's head did not read
    "Run the scenario" after the done chip carried the agent there. Decide whether that is a cascade or a real gap, fix
    the scenario or the code, and say which and why.
- **`initiative-link`** (the `initiative-link` scenario in `scripts/cdp/scenarios.mjs`, about lines 69700–69800):
  - Steps 3c and 4 get the same key fix.
  - Step 3 failed only on `chip3.selected === "false"`, and step 3b failed for the same reason: after picking an
    initiative in the picker, the rail's Initiative tab is already selected. The link handler in `agentheader.tsx`
    (`LinkToInitiative.link`) selects no tab. Find what selects it. Check the rail's tab state in `agentrailpanel.tsx` / `agentrailtabs.ts`, or
    the step before running in the wrong focus, for example a typed `i` landing somewhere.
    - If the step's own keys caused it, fix the scenario.
    - If a base commit after 2026-11-20 made the tab open on link on purpose, the commit message will say so. Update
      the expectation to match and cite the commit.
    - Otherwise the selection is an accident. Fix the code so that linking leaves the selected tab alone, as the
      scenario says.
- **`chunk-priority-rail`** (`scripts/cdp/scenarios-chunk-priority.mjs`, lines 503–506): this is the end-review finding.
  Task 3's `bandRows` now puts the window's next rows in order of work (`initiativeband.ts` ~116–124), and
  `railinitiativepane.tsx` renders `rows.window` as-is. Make the step check that the `next` rows deep-equal
  `[R.crit, R.unset]` in DOM order, and not the sorted pair. Fix the step's comment and the file header (~lines 20–21),
  which still say the window is in plan order.
- **Acceptance:**
  - `node --check` passes on each scenario file you touch.
  - `task check:ts` is clean if any `.tsx` changed.
  - Any `.tsx` change keeps its own unit tests passing (`npx vitest run` on the files beside it).
  - The report lists, for each failed step above, the cause found and the fix: scenario or code.
  - Final passes every step of all five scenarios.
