# Kael sync (agents and backend), fix round 1

The final stage's Verify failed on one vitest case, `claude/embedcopy.test.ts` > "cmd/wsh/cmd/claude-mod matches
claude/arc-mod": the embedded copy `cmd/wsh/cmd/claude-mod/hooks/memlint-core.ts` and `hooks/register.ts` lag their
source in `claude/arc-mod/hooks/`. The drift is on the base (commit 1d1ecae02 changed the source without re-syncing the
copy), not from this run's tasks; Tasks 4 to 9 each saw `task sync:claudemod` rewrite these two files and reverted them.

### Task 1: Re-sync the embedded Claude mod copy

**Depends on:** none

**Files:** `cmd/wsh/cmd/claude-mod/hooks/memlint-core.ts`, `cmd/wsh/cmd/claude-mod/hooks/register.ts`

Run `task sync:claudemod`, which copies `claude/arc-mod/` (minus tests) over `cmd/wsh/cmd/claude-mod/`. Commit only the
copy's changes; never edit `claude/arc-mod/` and never hand-edit the copy. If the sync touches any file other than the
two above, stop and report it instead of committing it.

**Acceptance:** `npx vitest run claude/embedcopy.test.ts` passes all three cases, and
`git diff --no-index claude/arc-mod/hooks/register.ts cmd/wsh/cmd/claude-mod/hooks/register.ts` (and the same for
`memlint-core.ts`) prints nothing.
