# Session Lists Lazy Load — Final fix, round 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The run's Final (`node scripts/cdp/final-verify.mjs launcher-resume launcher-resume-older history-older agent-history`) passes on the merged result. Both tasks change scenario code only, never app code.

**Parent plan:** `docs/superpowers/plans/2026-10-17-session-lists-lazy-load.md` (Tasks 3–5 built what these scenarios check).

Round 1 Final, on commit 628b87c in headless Chrome on the Mac:
- `launcher-resume-older` step 0 failed with `TypeError: Cannot read properties of undefined (reading 'wshRpcCall') at <anonymous>:1:21`.
- `agent-history` failed steps 3, 3b, 6, 6a and 6b, then stopped with `setBarProject is not defined`. Workers t-4 and t-5 found the same result on the base (HEAD~1 of t-4), so this was already broken before this run. The parent plan named `agent-history` as the check that History still works after Task 4, so this run fixes it.

How to run a scenario here: `ARC_FINAL_OUT=<a folder that does not exist yet> node scripts/cdp/final-verify.mjs <scenario...>`. It starts its own browser build of the app and stops it afterwards. The build re-syncs `cmd/wsh/cmd/claude-skim-mod/hooks/highlight-core.ts` from `claude/skim-mod/`. Never commit that file, and leave it as you found it. No CHANGELOG line, since neither task changes anything a user sees.

### Task 1: The new scenarios wait for the app to boot

**Depends on:** none
**Files:** `scripts/cdp/scenarios.mjs`

Cause: `launcher-resume` runs just before `launcher-resume-older` in the Final, and its teardown ends with `location.reload()` (its "reload" step). `launcherResumeOlder.arrange` then calls `h.rpc("createproject", …)` straight away. `h.rpc` evaluates `window.TabRpcClient.wshRpcCall(…)` (`scripts/cdp/attach.mjs`, the `rpc` member), and `boot-core.ts` has not set `window.TabRpcClient` yet. `waitForAppBoot(h)` (the function declaration in `scenarios.mjs`, written for this exact case; see its comment) waits until `window.TabRpcClient` and the nav are both present.

- [ ] **Step 1:** In `launcherResumeOlder.arrange`, inside the `try`, make `await waitForAppBoot(h);` the first statement, before the loop that creates the projects.
- [ ] **Step 2:** In `historyOlder.arrange`, inside the `try`, add `await waitForAppBoot(h);` before its first page call, `historyOlderReload(h)`. It passed this time only because the scenario before it did not reload.
- [ ] **Step 3:** Run `launcher-resume launcher-resume-older history-older`, in that order: the order is what reproduces the failure. Expected: every step PASS. If a later step of `launcher-resume-older` fails (none has run yet), fix the scenario where it is wrong about the app, as Task 2 Step 4 says. If the app itself is wrong, stop and report it. Never loosen an assertion.
- [ ] **Step 4:** Commit: `fix(cdp): launcher-resume-older and history-older wait for the app to boot`.

**Shown by:** `launcher-resume-older` steps 1–6 and `history-older` steps 1–4, run right after `launcher-resume`.

### Task 2: agent-history runs to its end again

**Depends on:** Task 1
**Files:** `scripts/cdp/scenarios.mjs`

Two defects in the scenario source, both on the base:

1. **Lost regex escapes.** Some code that runs in the page sits in a JS template literal, and its regexes are written with one backslash. In a template literal `\d` and `\s` turn into plain `d` and `s`, so the page receives `/d+/` and `/s+/g`. Examples:
   - `ahList`'s `more:` row: `r.textContent.match(/\d+/)` reads no count, giving `"more:waveterm:"`.
   - Step 3b's `meta` and `run` reads: `.replace(/\s+/g, " ")` removes every letter s, giving `"✳hi tory  eed"`.
   
   `launcherOlderState` shows the right form: `/\\s+/g`. Regexes in Node-side code are correct as they are, for example step 5's `/^\d+m$/.test(age ?? "")`.
2. **`setBarProject` is undefined.** Commit 4b4e295c7 (2026-10-06, "the focus switcher, its filters and the divergence banner are gone") deleted the helper along with the `focus-reaims-surfaces` scenario. `agent-history` still calls it, in step 6c and in its teardown's "clear the project scope" step. The app-bar project switcher it drives was kept: `ProjectSwitcher` with `variant="bar"` in `frontend/app/cockpit/app-bar.tsx`, `data-project-switcher={variant}` in `frontend/app/view/agents/projectswitcher.tsx`. So restore the helper, don't drop the step. The old helper is in `git show 4b4e295c7^:scripts/cdp/scenarios.mjs` (search for `const setBarProject`).

Steps:

- [ ] **Step 1:** In `agent-history`, its `ah*` helpers and its `AH_*` snippet constants, find every regex inside a template literal or a string that runs in the page and has a single-backslash escape (`\d`, `\s`, `\w`, `\b`, `\.`, `\/`, …). Double the backslash. Change nothing in Node-side code.
- [ ] **Step 2:** Restore `setBarProject(h, name)` as a `const` above `agentHistory`, with the same body as the old helper. Use `ahNap(200)` in place of the removed `napFocus(200)`. Before running anything, check that `[data-project-option="<name>"]` is still the switcher's row attribute (`projectswitcher.tsx`). If it is not, use the attribute the switcher has now.
- [ ] **Step 3:** Run `agent-history` on its own. Steps 6c to 13 have not run since 2026-10-06.
- [ ] **Step 4:** Make every step PASS by fixing the scenario wherever it is wrong about the app:
   - **The app changed on purpose since the step was written:** update the assertion to the current behaviour and name the commit in the step's comment. Use `git log -S` or `git log -L` on the component the step reads to find it.
   - **The app looks broken:** leave the assertion as it is and report it under Found not fixed, with the step and its detail.
   - Never loosen an assertion just so it passes.
   - Step 9 ("Conversation History lists every session, down to the oldest seed") is the step that bears on this run's Task 4 (History pages its sessions). It must pass. If it fails, report what the list holds and what the sessions mock answered, whether or not the call had a `cursor`. `installAhMock` ignores `cursor` and `limit`.
- [ ] **Step 5:** Run the whole Final: `launcher-resume launcher-resume-older history-older agent-history`. Expected: every step PASS.
- [ ] **Step 6:** Commit: `fix(cdp): agent-history's in-page regexes keep their escapes, and setBarProject is back`.

**Shown by:** every step of `agent-history`, with 6c's app-bar switcher narrowing the sidebar and step 9's full History list.
