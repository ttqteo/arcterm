# Fix round 1: make `diff-log-tab` pass

The run's final stage passed `diff-commit-tab`, `diff-sync` and `diff-compare`, and failed every step of `diff-log-tab`.
Task 1 reproduced the same failure on the base `92f01162`, so this run did not cause it, but the Final names the
scenario. There are two defects, one in the app and one in the scenario.

### Task 1: A clean project opens on Log, and the agent-row lookup finds the row

**Depends on:** none

**Files:** `frontend/app/view/agents/filessurface.tsx`, `frontend/app/view/agents/difflayout.ts`, `frontend/app/view/agents/difflayout.test.ts`, `scripts/cdp/scenarios.mjs`

- **App: the panel tab is picked from the wrong list.** `filessurface.tsx:227-245` picks Commit or Log once per subject
  through `panelTabToApply(…, listLoaded, …, dirtyCount)`, with `dirtyCount = state?.changes?.files.length ?? 0`.
  When the scenario's fixture agent works in the same repository, `listLoaded` is already true just after the project is
  picked, but `state` is still the agent's session-anchored read (a.txt, b.txt). That read counts as dirty, so a clean
  project opens on Commit (final run: `tab1: "commit"`).
  - Fix: count only a working-tree read. `commitTabCount(state)` (`difflayout.ts:120`) already returns null for a
    ref-anchored read. Use it for the count, and treat the list as loaded for a project's working scope only once
    `commitTabCount(state)` is not null. Keep `panelTabToApply`'s contract, or extend it if that is cleaner.
  - Add a `difflayout.test.ts` case for this: a session-anchored list for the same repository does not pick Commit for a
    project.
- **Scenario: the agent-row lookup never matches.** `scenarios.mjs:3483-3489` looks for a `div` leaf whose text is the
  agent's name. `ParentRow` renders the name in a `span` (`agenttree.tsx:640`), so step 2 returns "no agent row in the
  tree". Steps 3–7 then start from the wrong state, and the run stops on `getBoundingClientRect` of null.
  - Fix the lookup so it matches the name leaf whatever its tag. The same helper is copied at `scenarios.mjs:14685`
    and once more; fix every copy. One shared helper is fine if it stays inside `scenarios.mjs`.
  - Don't weaken any step's assertions.
- Verify: `npx vitest run frontend/app/view/agents/difflayout.test.ts`, then
  `node scripts/cdp/final-verify.mjs diff-log-tab diff-commit-tab`. Every `diff-log-tab` step must pass, and
  `diff-commit-tab` must still pass all 7 steps (its step 1 relies on a dirty project opening on Commit). If a step
  still fails for a reason outside these two defects, report it under Found not fixed with the step's JSON.
- No CHANGELOG line: the user saw this only as a racy first tab, and the Commit-tab line already covers the panel.
