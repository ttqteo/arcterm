# Board cells: final-stage fix round 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the three failures that hold the board-cells run's land. None comes from the board work; all three are on the base and show on this Mac.

**Architecture:** Three independent fixes in separate files: final-verify's tree link on posix, the arc mod's PowerShell hooks against Claude Code types that have no PowerShell tool, and the agent-grid scenario's fullscreen steps.

**Tech Stack:** Node scripts (vitest), the Claude Code mod (TypeScript, `scripts/check-mods.mjs`), CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-11-22-board-cells-design.md` (unchanged; this round fixes the checks around it)

**Verify:** `node scripts/verify.mjs ./skills/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs boards-split boards-chat boards-library chat-board-ref agent-grid surface-smoke`

Evidence, from the round-1 final stage on commit 9270de3 (macOS):
- Verify: the whole vitest suite has 2 failures, both in `scripts/cdp/final-verify.test.mjs`: `linkTree > points the link at each tree in turn…` (line 407, `linkTree(link, b)` returns null; log line `ENOTDIR: not a directory, rmdir '<tmp>/link-tree-…/tree'`) and `final-verify.mjs > starts the dev app on its own vite port, target dir, store and no global install` (line 205, `FAKE_DEV_CWD` is the tree's own `/private/var/…/final-cwd-…` path, not `<localappdata>/arc-final/tree`).
- Check: the frontend tsc passes; `check:mods` fails on `claude/arc-mod/hooks/register.ts:1110-1125` (TS2322 `"PowerShell"` not a tool name, TS2339 `command` / `run_in_background`), against `~/.arc/claude-mod/.claude-plugin/types/claude-code/index.d.ts` written 2026-11-21, which names no PowerShell tool.
- t-4 found `agent-grid` steps 9 and 9d failing: they click `[data-agent-header] button[title^="Fullscreen terminal"]`, which is off by default (`DEFAULT_HEADER_BUTTONS` in `frontend/app/view/agents/headerbuttons.ts:13`, `fullscreen: false`).

### Task 1: final-verify links the slot's tree on macOS and Linux

**Depends on:** none
**Files:** `scripts/cdp/final-verify.mjs`, `scripts/cdp/final-verify.test.mjs`

- [ ] **Step 1:** Reproduce: `npx vitest run scripts/cdp/final-verify.test.mjs` shows exactly the two failures above.
- [ ] **Step 2:** Fix `linkTree` (`scripts/cdp/final-verify.mjs:307`): on posix a symlink is removed with `unlinkSync`, not `rmdirSync` (which only works on a Windows junction), the same split `unlinkBuildJunctions` just above already makes. Keep the rule that a real directory in the link's place is never touched and returns null.
- [ ] **Step 3:** Find why the dev-app test's `FAKE_DEV_CWD` is the tree's own path (linkTree fell back, or the dev command's cwd is not the link). Read the test's stdout for a `could not link` line. Likely causes: the slot dir's parent does not exist yet when linkTree runs, or the same rmdir bug on a link left from a previous slot. Fix the script, not the test, unless the test's expectation is what is wrong on posix (for example a `/var` vs `/private/var` realpath difference: then compare real paths on both sides and say so in Differs).
- [ ] **Step 4:** `npx vitest run scripts/cdp/final-verify.test.mjs`: all pass (the one skipped stays skipped). The Windows paths keep their behaviour: no change to the win32 branch.
- [ ] **Step 5:** Commit. No CHANGELOG line (build script internals).

### Task 2: the arc mod's PowerShell hooks typecheck when Claude Code's types have no PowerShell tool

**Depends on:** none
**Files:** `claude/arc-mod/hooks/register.ts`

Decision (lead, autonomous run): keep both PowerShell hooks. Windows' Claude Code has the tool and the guards matter there. Only change how they are typed, so `check:mods` passes against types that name the tool and against types that do not (this Mac's).

- [ ] **Step 1:** Reproduce: `node scripts/check-mods.mjs` prints `arc-mod FAILED` with the errors at `register.ts:1110-1125`.
- [ ] **Step 2:** Make the two `on(…, { tool: "PowerShell" }, …)` registrations typecheck without the tool in the union. For example, type the tool name through a small local cast and read the event's input through a local `{ command: string; run_in_background?: boolean }` type. The hooks' behaviour must not change: the same `verifyGateAsk`, `refusal`, `goalposts`, `withJobSlot`, `withUiCheck` and `.catch(passOn)` / `.catch(shellGuardFailed)` choices. Avoid `any` and `@ts-ignore` / `@ts-expect-error`: an expect-error breaks on Windows, where the types do have the tool. Add a one-line comment saying why.
- [ ] **Step 3:** `node scripts/check-mods.mjs`: arc-mod ok, arc-view-mod ok, skim-mod ok. `claude plugin validate claude/arc-mod` still passes. `npx vitest run claude/arc-mod` passes.
- [ ] **Step 4:** Commit. No CHANGELOG line (no behaviour change).

### Task 3: agent-grid turns the header's Fullscreen button on before steps 9 and 9d

**Depends on:** none
**Files:** `scripts/cdp/scenarios.mjs`

- [ ] **Step 1:** In the `agent-grid` scenario (`scripts/cdp/scenarios.mjs`, `name: "agent-grid"` near line 40073; steps 9 to 9d near line 40326), switch the header's Fullscreen button on before step 9 clicks it, the way `scripts/cdp/scenarios-agent-header.mjs` does with `setHeaderButtons` (line 90) and the way boards-split step 8c turns Split on (`headerButtonsAtom`, localStorage `agent.header.buttons`). Make sure `agent.header.buttons` is restored at teardown (add it to the scenario's restored keys if it is not there).
- [ ] **Step 2:** Run it against a browser app: `task dev:browser` in the background, wait for its `browser app ready:` line (with a deadline), then `node --experimental-websocket scripts/cdp/verify.mjs agent-grid`; every step passes, 9, 9c and 9d included. Stop the background shell after.
- [ ] **Step 3:** Commit. No CHANGELOG line (test only).
