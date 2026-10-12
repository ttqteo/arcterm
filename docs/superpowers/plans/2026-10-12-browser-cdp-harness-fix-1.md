# Browser CDP Harness, Fix Round 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The run's Final, `surface-smoke agent-grid` in the browser app on a Mac, passes. Round 1 failed only on
agent-grid steps 8b, 9, 10b and 13. That scenario was written on 2026-10-06 against an Agent tree and a Ctrl+Tab that
have changed since, and none of the four failures comes from the browser. This round brings those steps up to date.

**Architecture:** Test code only: two steps of the `agent-grid` scenario in `scripts/cdp/scenarios.mjs` act as a user
does today. The open-issues row Task 3 wrote about these failures is removed, or narrowed to whatever still fails.

**Tech Stack:** the CDP scenario harness (`scripts/cdp/`), Node scripts, headless Chrome through `task dev:browser`.

**Spec:** none. The parent plan is `docs/superpowers/plans/2026-10-12-browser-cdp-harness.md`, and its Goal holds.

**Verify:** `node scripts/verify.mjs ./pkg/web`

**Final:** `node scripts/cdp/final-verify.mjs surface-smoke agent-grid`

## Global Constraints

- Nothing under `frontend/` changes. A step that still fails after this fix because the app does not do what the step's text promises is an app bug: keep its assertion, report it under Found not fixed with the step's dump, and leave it in the open-issues row (Step 4).
- Never run prettier on `scripts/*.mjs`: they are hand-formatted with 4 spaces, and `.editorconfig` leaves `.mjs` out.
- Stop wavesrv, vite or Chrome by PID, never by image name: the person's own arcterm and Chrome are running.
- This Mac's node is v20: a hand run of `scripts/cdp/verify.mjs` needs `node --experimental-websocket`. `final-verify.mjs` already passes that flag.
- No `CHANGELOG.md` line: this is test code.
- Comments explain why, in the plain lowercase style of the file around them.

## Review Focus

1. Step 8b still checks the rule it names: clicking an agent that already has a cell focuses that cell and leaves the grid order alone (D, B, A). It is not weakened into a check that something was clicked.
2. Step 13 still asserts that the selection moved, that the grid keeps 4 cells, and that the keyboard is in the newly focused cell. The only change is the keyup that lets the switcher pick.

### Task 1: agent-grid's split-row and tab-switcher steps match the current app

**Depends on:** none
**Files:** `scripts/cdp/scenarios.mjs`, `docs/open-issues.md`

Why the four steps fail, from the round-1 Final:

- **8b** clicks `gridRow(D)`, which is `[data-agent-row="<D>"]`. The Agent tree now draws the agents the grid shows as one split row at the top of Active, a segment per cell, and a click on a segment focuses that cell (`frontend/app/view/agents/agenttree.tsx`, the split row near line 1638 and `splitActive` near line 2116). An agent that has a cell therefore has no `data-agent-row`, and its segment is `[data-agent-split-cell="<id>"]`. The click finds nothing, so B stays focused.
- **9 and 10b** fail only because 8b left B focused instead of D.
- **13** dispatches a single keydown, Tab with `ctrlKey`. Since b9808ce6d (2026-10-11), Ctrl+Tab opens the tab switcher anywhere on the Agent surface (`frontend/app/store/keybindings/bindings.ts`, around line 185), and the switcher picks only when its modifier is released. `tabswitcherview.tsx` listens for keyup on the window in capture phase and calls `openFromSwitcher` when `releasesSwitcher(s, e.key)` holds, which for the ctrl switcher means `key === "Control"`. Ctrl+Tab is the same chord on a Mac, so this is not a Mod key: keep `ctrlKey`.

- [ ] **Step 1: 8b clicks the split row's segment**

Add a selector next to `gridRow` (near line 23701 of `scripts/cdp/scenarios.mjs`):

```js
// an agent the grid shows has no row of its own: the tree draws the split as one row with a segment per cell
const gridSplitCell = (id) => `[data-agent-split-cell="${id}"]`;
```

In step 8b, replace `await click(gridRow(D));` with `await click(gridSplitCell(D));`. Keep the assertion
(`order(lay) === want(D, B, A) && cellAt(lay, D).focused === true`). Rename the step to
`"8b. the split row's segment for an agent that has a cell focuses that cell and leaves the list alone"`. Rewrite the
`// 8. the focus rule from the tree` comment only if it no longer reads right.

- [ ] **Step 2: 13 lets go of Ctrl so the switcher picks**

Add a keyup helper next to `ahKey` (near line 12629):

```js
// the keyup that lets go of a modifier: the tab switcher picks on it, not on the keydown that opened it
const ahKeyUp = (h, key, code) =>
    h.ev(
        `(document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keyup", ${JSON.stringify({ key, code, bubbles: true, cancelable: true })}))`
    );
```

In step 13, right after `await ahKey(h, "Tab", "Tab", { ctrlKey: true });`, add `await ahKeyUp(h, "Control", "ControlLeft");`.
Keep the assertion as it is. Change the comment above step 13 to say that Ctrl+Tab opens the switcher, letting go of
Ctrl picks the next agent, and the surface then hands the keyboard to the newly focused cell.

- [ ] **Step 3: Run the round's Final**

Run: `node scripts/cdp/final-verify.mjs surface-smoke agent-grid` (give it a long timeout: it builds and starts the browser app).
Expected: exit 0. Every agent-grid step passes. surface-smoke's "steer input visible on a pi session card" stays its own skip.
If a step still fails, read its dump before changing anything:
- A selector or timing slip in the scenario: fix it in `scripts/cdp/scenarios.mjs`.
- The app not doing what the step promises, for example the keyboard staying in the old cell after the switcher picks: that is an app bug. Report it as the Global Constraints say.

- [ ] **Step 4: The open-issues row**

In `docs/open-issues.md`, find the row Task 3 added that starts with `` | (arcterm) `agent-grid` fails 4 steps in the browser app ``.
If Step 3 passed, delete it. If a step still fails, rewrite the row so it names only those steps and the app bug behind each.

- [ ] **Step 5: Commit**

```bash
git add scripts/cdp/scenarios.mjs docs/open-issues.md
git commit -m "test(cdp): agent-grid clicks the split row's segment and lets go of Ctrl for the tab switcher"
```
