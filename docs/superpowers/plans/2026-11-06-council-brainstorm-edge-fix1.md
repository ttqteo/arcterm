# Council Brainstorm edge — final-stage fix round 1

**Spec:** docs/superpowers/specs/2026-11-06-council-brainstorm-edge-design.md

**Verify:** `node scripts/verify.mjs ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/...`

**Check:** `go vet ./pkg/council/... ./pkg/wshrpc/wshserver/ ./cmd/wsh/cmd/`

The final stage's frontend tests failed on two files the run never touched. Both failures are already on the base
(commits 340421e50 and c5709843c), and either one holds the land. Each task fixes one; they share no file.

### Task 1: The embedded skim mod copy matches claude/skim-mod

**Depends on:** none

**Files:** `cmd/wsh/cmd/claude-skim-mod/hooks/fold-core.ts`, `cmd/wsh/cmd/claude-skim-mod/hooks/highlight-core.ts`

`claude/embedcopy.test.ts` fails "cmd/wsh/cmd/claude-skim-mod matches claude/skim-mod": `hooks/fold-core.ts` and
`hooks/highlight-core.ts` in the copy are stale. `claude/skim-mod/` is the source (AGENTS.md: edit `claude/`, never the
copy). Bring the copy up to date with `task sync:claudemod` (or copy those two files from `claude/skim-mod/hooks/`), and
leave `claude/skim-mod/` itself unchanged. Commit only the copy's files; if the sync changes anything else in
`cmd/wsh/cmd/claude-mod` or `claude-view-mod`, say so in the report.

**Acceptance:** `node node_modules/vitest/vitest.mjs run claude/embedcopy.test.ts` passes.

### Task 2: The office palette test allows the Christmas mark's own token

**Depends on:** none

**Files:** `frontend/app/view/office/officepalette.test.ts`

`officepalette.test.ts` "maps the Christmas roles to the xmas tokens…" asserts that every `--color-xmas-*` token in
`frontend/tailwindsetup.css` is one the office scenery reads. `--color-xmas-pine-lit` (tailwindsetup.css:123) was added
for the app bar's Christmas mark (`frontend/app/view/agents/christmasmark.tsx:34`, `fill-xmas-pine-lit`), not the office,
so the assertion fails. Keep the test's intent (no xmas token is declared that nothing reads): the declared set must
equal the office's xmas tokens plus the tokens the Christmas mark reads, with `--color-xmas-pine-lit` named as the
mark's. Do not add the token to the office palette (`officepalette.ts`), and do not change the stylesheet or the mark.

**Acceptance:** `node node_modules/vitest/vitest.mjs run frontend/app/view/office/officepalette.test.ts` passes.
