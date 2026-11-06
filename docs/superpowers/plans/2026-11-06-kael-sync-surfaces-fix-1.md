# Kael sync (surfaces), Final fix round 1

**Verify:** `node scripts/verify.mjs ./pkg/orchestrate/... ./pkg/jarvis/... ./pkg/jarvisstate/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs code-image-zoom code-blame-draft diff-file-keys brainstorm-board-pick palette-brainstorm-resume brief-act-blocked`

Final round 1 failed in Verify on one vitest case: `claude/embedcopy.test.ts` > "cmd/wsh/cmd/claude-view-mod matches
claude/arc-view-mod". It lists the 24 `testdata/*.txt` fixtures Task 2 added under `claude/arc-view-mod/testdata/` as
stale in the copy.

Decision, and why:

- **What failed:** Task 2 made `sync:claudemod` (`Taskfile.yml:347`) strip `testdata/` from each embedded copy, as the
  plan required: the fixtures are test inputs, not part of the mod `wsh` installs. The embed copy test has its own
  list of what the sync leaves out (`synced()` in `claude/embedcopy.test.ts`: `.claude-plugin/types/` and
  `hooks/*.test.ts`) and was not told. So it expects the fixtures in the copy, and the copy is right not to hold them.
- **Fix:** teach `synced()` the same rule: a path under `testdata/` is not synced. The test then mirrors the Taskfile
  line again, and its comment says so.
- **Not chosen:** dropping the `testdata` strip from the Taskfile would ship 24 fixture files inside every `wsh`
  binary to satisfy a test that only lagged behind.

### Task 1: The embed copy test leaves out testdata, as the sync does
**Depends on:** none

**Files:** `claude/embedcopy.test.ts`

- In `synced(rel)`, also return false when `rel` starts with `testdata/`. Update the comment above it so it names the
  three things the sync leaves out (types, hook tests, `testdata/`), matching `Taskfile.yml`'s `sync:claudemod`.
- Do not change `Taskfile.yml`, the mod, or the copy under `cmd/wsh/cmd/`.

**Acceptance:** `npx vitest run claude/embedcopy.test.ts` passes all three cases. `git status --short
cmd/wsh/cmd/claude-view-mod` is clean (no fixture copied in).
