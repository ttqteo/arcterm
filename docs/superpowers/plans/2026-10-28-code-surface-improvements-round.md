# Code surface improvements: fix round

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two open issues the run left in the feature it built: blame errors in a repository with no commits, and the comment marker's hover note is not shown by any scenario.

**Spec:** `docs/superpowers/specs/2026-10-28-code-surface-improvements-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/gitinfo ./pkg/wshrpc/...`
**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit && go vet ./pkg/gitinfo ./pkg/wshrpc/...`
**Final:** `node scripts/cdp/final-verify.mjs surface-smoke code-diff code-blame code-plain-dir code-review`

## Decisions

1. A repository with no commits has no committed history for any file, so `gitinfo.Blame` reports it the way it reports an untracked file: `IsRepo: true, Untracked: true`, nil error. The `BlameResult` comment already defines Untracked as "a file with no committed history", and the frontend already draws that as one "not committed" entry, so no wire or frontend change is needed. Detection: `git rev-parse --verify -q HEAD` fails inside a work tree. Check it only after blame fails, so the common path costs no extra git launch.
2. The hover note is checked by extending the existing `code-review` scenario, not by adding a new one. Monaco shows a decoration's `hoverMessage` in `.monaco-hover` when the mouse rests on the line's text.

### Task 1: blame in a repository with no commits

**Depends on:** none

**Files:** `pkg/gitinfo/blame.go`, `pkg/gitinfo/blame_test.go`

**Interfaces:** none change; `Blame(ctx, cwd, path) (*BlameResult, error)` keeps its signature.

- [ ] **Step 1: Write the failing test** `TestBlameNoCommits`: `git init` a temp repo (reuse `initRepo`), write and `git add` a file without committing, and call `Blame(ctx, dir, "<file>")`. Assert the error is nil, `IsRepo` is true, `Untracked` is true and `Hunks` is empty. Add a second case in the same test with an unstaged file in the same no-commit repo, which must give the same result.
- [ ] **Step 2: Run** `go test ./pkg/gitinfo -run '^TestBlameNoCommits$'`. Expected: FAIL, because blame returns an error for the staged file.
- [ ] **Step 3: Implement** the decision-1 check in `Blame`'s failure branch, before the `ls-files` check: when `rev-parse --verify -q HEAD` fails, return `&BlameResult{IsRepo: true, Untracked: true}, nil`. The context-deadline check stays first.
- [ ] **Step 4: Run** `go test ./pkg/gitinfo`. Expected: PASS, including all existing `TestBlame*` tests.

**Acceptance:** `TestBlameNoCommits` passes and no existing gitinfo test changes.

### Task 2: show the comment marker's hover note in the code-review scenario

**Depends on:** none

**Files:** `scripts/cdp/scenarios-code.mjs`

Edit only the `code-review` scenario, and never run prettier on this file.

**Interfaces:** none.

- [ ] **Step 1:** In `code-review`, after the step that asserts the review count is 2 and before the `cdp-shots/code-review.png` shot is taken (or right after it, if the shot must keep its current view), add a step:
  - Scroll the first commented line into view.
  - Read the bounding rect of that line's text in the editor's `.view-lines`, inside the Code surface's editor container rather than through a document-wide query.
  - Hover its middle with CDP `Input.dispatchMouseEvent` `mouseMoved`.
  - Wait up to 3000 ms for a visible `.monaco-hover` whose text contains that comment's note.
  - Take the shot `cdp-shots/code-review-hover.png`.
  - Fail the step with a message naming the missing note when it times out.
  - Move the mouse away afterwards, so the later Clear and Send steps start from the same state as before.
- [ ] **Step 2: Run** the scenario against a dev app (`CDP_PORT=<port> task verify:ui -- code-review`, or `node scripts/cdp/final-verify.mjs code-review`). Expected: PASS, and `code-review-hover.png` shows the note in the hover.

**Acceptance:** `code-review` passes with the new hover step, and its screenshot shows the marker's note.
