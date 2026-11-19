# Boards fix round 1: Library's footer chip test

Goal: the final stage's Verify failed on the merged result in 4 tests of `frontend/app/cockpit/footer-visible.test.ts`
("Library chips"): they expect the tab chip `1 2 3 tab`, and Task 9 rightly made it `1 2 3 4 tab` when Library gained
its fourth tab, Boards (`frontend/app/cockpit/footerhints.ts:78`, ids `library:tab-1` to `library:tab-4`). The code is
right and the test is stale; fix the test, not the chip.

Principles: simple and direct; one source of truth; no abstraction for a single use; never weaken an assertion beyond
the glyph change.

**Spec:** `docs/superpowers/specs/2026-11-19-kael-boards-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/boardstore/... ./pkg/boardforward/... ./pkg/boarddrawer/... ./pkg/agentsessions/... ./pkg/wps/... ./pkg/tsgen/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs boards-split boards-chat boards-library`

### Task 1: Library chips expect the four tab keys
**Depends on:** none
**Files:** `frontend/app/cockpit/footer-visible.test.ts`

Decisions:
- In the "Library chips" describe block, every expected `"1 2 3 tab"` becomes `"1 2 3 4 tab"` (lines ~291 to ~317, nine
  occurrences). Nothing else in those expectations changes.
- Add one test in the same block for the Boards tab: with `libraryTabAtom` set to `"boards"` (the key Task 9 added to
  `LIBRARY_TABS` in `frontend/app/view/library/librarystore.ts`; check the exact key there) and nothing open, the chips
  are the tab chip `1 2 3 4 tab` first. Assert the exact list the code produces for that state; if it holds more than the
  tab chip, each extra chip must come from a binding live on that tab, which the test's name says. The `afterEach`
  already resets the tab.
- Do not edit `footerhints.ts`: its `1 2 3 4` glyph is the correct one.

Acceptance:
- `npx vitest run frontend/app/cockpit/footer-visible.test.ts` passes, all tests (29 before, 30 after). If it fails in a
  junctioned tree with `Denied ID …material-icon-theme…?url` before any test runs, run it as
  `node node_modules/vitest/vitest.mjs run frontend/app/cockpit/footer-visible.test.ts`, which the lead saw pass in a
  junctioned tree, and say which form ran.
- `grep -rn '"1 2 3 tab"' frontend` finds nothing.
