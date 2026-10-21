# Rail Changes commits — fix round 1

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Spec:** `docs/superpowers/specs/2026-10-21-rail-changes-worktree-commits-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/gitinfo`

**Final:** `node scripts/cdp/final-verify.mjs rail-changes-commits rail-commit-mode agent-rail-tabs`

**Goal:** The final stage of run fb9eca52 failed on two stale tests that already fail on the base, and Task 9 of the run
found a gap against the spec. This round fixes the three so Verify and Final pass on the merged result.

**Rules that bite here (AGENTS.md):** run `npx prettier --write` and `npx eslint` on the `.ts` / `.tsx` files you
touch, never prettier on `scripts/*.mjs` and never on the tree. Commit with a pathspec
(`git commit -m "..." -- <paths>`). No Co-Authored-By trailer.

### Task 1: Commit… shows whenever the working tree has uncommitted files

**Depends on:** none
**Files:** `frontend/app/view/agents/agentdetailsrail.tsx`, `scripts/cdp/scenarios.mjs`

The spec (`### Commit mode`) says **Commit…** shows in both ranges "while the uncommitted list has a file". Today the
button lives in `FilesChangedList`'s footer (`agentdetailsrail.tsx`, `onCommit={full && uncommitted > 0 ? … }` near
line 1051), and that footer renders only when `listed.length > 0`. In the Session range, files that were uncommitted
before the session started and unchanged since leave `listed` empty while `uncommitted > 0`, and with no range (Session,
no start recorded) there is no Uncommitted row either: commit mode then has no way in.

1. When `full && uncommitted > 0` and `listed.length === 0`, keep the existing "No changes" / "No changes against
   <base>" line and draw the same **Commit…** button under it (same `data-rail-commit-open`, classes, title and
   `setRailCommitMode(agent.id, true)`), right-aligned like the footer's. Reuse the button rather than copying it: pull
   it into a small component both places render. View diff stays where it is (only with files listed). Overview
   (`full` false) is unchanged.
2. Add a step to the `rail-commit-mode` scenario (`agentRailCommitMode`, `scripts/cdp/scenarios.mjs`) that reaches an
   empty files list with uncommitted files (for example an agent whose Session range lists nothing while the worktree
   has an uncommitted edit, or one with no session start), asserts `[data-rail-commit-open]` is present, clicks it, and
   asserts commit mode opens (`[data-rail-commit-files]` or the box the scenario already checks), with a shot. Keep the
   scenario's teardown restoring everything it sets.
3. Run `node scripts/cdp/final-verify.mjs rail-commit-mode rail-changes-commits` and report the result.

### Task 2: Drop `global-atoms.test.ts`'s stale wos retry test

**Depends on:** none
**Files:** `frontend/app/store/global-atoms.test.ts`

`frontend/app/store/global-atoms.test.ts`'s `describe("wos reject-then-retry")` expects a failed first load to drop the
cache entry so a fresh `getWaveObjectValue` starts a new fetch. Main's `10e2041b3` ("fix(wos): retry a failed object
load into the entry its atoms read") changed that on purpose: a failed load now retries into the same entry with
backoff, and `wos.test.ts`'s `describe("wos failed first load")` tests the new contract. The old test fails on the run's
base (`expected null to be an instance of Promise`, line 38).

1. Remove the `wos reject-then-retry` describe block and the imports and `vi.mock` only it uses; keep the
   `global-atoms` describe. Do not change `wos.ts` or `wos.test.ts`.
2. Run `npx vitest run frontend/app/store/global-atoms.test.ts frontend/app/store/wos.test.ts`; both pass.

### Task 3: `agent-rail-tabs` expects the Changes tab

**Depends on:** Task 1
**Files:** `scripts/cdp/scenarios.mjs`

The `agent-rail-tabs` scenario (`scripts/cdp/scenarios.mjs`, from line ~29490; `railTabLabels` at ~29511, the asserts
at ~29676, ~29706, ~29727) still expects the rail's tab strip to be `Overview, Files`. Main's `f89238d5d` ("Changes tab
in the Agent panel") added a `Changes` tab, so steps 1, 2, 5 and 7 fail on the base (step 1 reads
`["Overview*","Files","Changes"]`, and step 5's → key moves Files to Changes, not to the File tab).

1. Update the expectations in steps 1, 2, 5 and 7 to the strip as it is now, with `Changes` in its place. Where step 5
   walks the tabs with →, assert the order it actually walks (including Changes) and keep the step's intent: reaching
   the File tab. Change only expectations and the keystrokes needed to reach the same tabs; no product code.
2. Run `node scripts/cdp/final-verify.mjs agent-rail-tabs` and report every step passing.
