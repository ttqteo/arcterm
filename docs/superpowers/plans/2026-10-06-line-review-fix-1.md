# Line review — fix round 1

Final (`node scripts/cdp/final-verify.mjs line-review git-history diff-compare code-diff surface-smoke`) failed on
the merged result: `line-review` steps 13, 14, 16, 17, 18 and all four `code-diff` steps. Spec:
`docs/superpowers/specs/2026-10-06-line-review-design.md`. Plan: `docs/superpowers/plans/2026-10-06-line-review.md`.
The screenshots of the failed run are in `cdp-shots/` (`line-review-13-tray.png`, `code-diff.png`).

### Task 1: line-review step 13 — back to Uncommitted after compare

**Depends on:** none

Step 13 (`scripts/cdp/scenarios.mjs`, `toUncommittedReview`, around line 10657) clicks the first history row's button
to return to Uncommitted after step 12 entered compare and left it with Escape. The selection did not move:
`line-review-13-tray.png` still shows commit 37eacf9 selected in the history and its files in Review, so
`cards13` is 0 and `back13` is false (the README header never shows). Steps 14, 16, 17 and 18 fail only because of
this: their `comment(...)` clicks a `+` on a README row that is not on screen, so no comment is made. The tray itself
read `3 comments on 2 files` / `Send 3 comments`, and step 15 (sending the 3 kept comments) passed.

Find why the click on the Uncommitted row does not select it after leaving compare: an app bug (for example
leaving compare restoring the earlier commit selection after the click, or `selectCommit` ignoring the working-tree
row in that state, in `filessurface.tsx` / `githistorystore.ts` / the compare store), or the scenario clicking before
the history pane is back. If it is an app bug, fix the app, since a user clicking Uncommitted right after leaving
compare would hit it too, and add a unit test where the logic is pure. If it is only the scenario's timing, make
`toUncommittedReview` wait for the history pane and then confirm the Uncommitted row is selected before going on. Do
not weaken any step's assertions. Acceptance: `line-review` steps 13-20 pass under Final, along with steps 1-12.

### Task 2: code-diff arranges its own project with a changed file

**Depends on:** none

`code-diff` (`scripts/cdp/scenarios.mjs`, around line 4310) has an empty `arrange` and relies on a registered project
that already has a file changed from HEAD. Final starts a dev app on a fresh store, so there is no project
(`code-diff.png`: "No registered projects"), and all four steps fail (`path=(none)`, `no path bar`, ...), including
the steps that predate this run. Make `arrange` create a throwaway git repo with one committed file that is then
modified in the working tree, register it with `h.rpc("createproject", ...)` and `waitForProjectInConfig`, the way
`arrangeLineReview` does, and have `assert` pick that project in the Code surface's project picker by name, not
whichever row comes first. `teardown` removes the project it registered and the temp repo. Keep every existing step
and its assertion, including "the path bar has no Send to agent or Copy reference". Acceptance: all four `code-diff`
steps pass under Final.
