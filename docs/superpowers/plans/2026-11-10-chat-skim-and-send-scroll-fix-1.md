# Chat skim and send scroll, Final fix round 1

**Verify:** `node scripts/verify.mjs`
**Final:** `node scripts/cdp/final-verify.mjs agent-chat`

The final stage's Verify failed on one vitest case: `claude/embedcopy.test.ts` > "cmd/wsh/cmd/claude-mod matches
claude/arc-mod". Two files of the embedded copy are stale: `hooks/register.ts` and `hooks/tokengate-core.ts`. All
other 14,217 tests passed.

Decisions, and why:

1. **Sync the embedded Claude mod copy and commit it.**
   - **What failed:** `cmd/wsh/cmd/claude-mod/hooks/register.ts` and `cmd/wsh/cmd/claude-mod/hooks/tokengate-core.ts`
     differ from `claude/arc-mod/hooks/register.ts` and `claude/arc-mod/hooks/tokengate-core.ts`.
   - **Why:** the base commit `40f58fdd6` ("a spawn that joins a Token burn card waits for it…") changed both source
     files under `claude/arc-mod/` and did not commit the synced copy. Nothing in this run touched them. Task 1's
     worker saw `task dev` rewrite them during its own check and restored them so its commit held only its paths.
   - **Fix:** run `task sync:claudemod`, which copies `claude/arc-mod/` (minus tests) over
     `cmd/wsh/cmd/claude-mod/`. Commit the copy. AGENTS.md: edit `claude/`, never the copy, so the copy is written
     only by the sync task.
   - **Not chosen:** editing the test or the source to match the copy. The source is the newer, intended code; the
     copy is generated from it.

### Task 1: Sync the embedded Claude mod copy

**Depends on:** none
**Model:** sonnet
**Files:** `cmd/wsh/cmd/claude-mod/hooks/register.ts`, `cmd/wsh/cmd/claude-mod/hooks/tokengate-core.ts`

1. Run `task sync:claudemod`.
2. Run `git status --short -- cmd/wsh/cmd/`. Expect exactly the two files above modified. If the sync changes any
   other file under `cmd/wsh/cmd/claude-mod/`, `cmd/wsh/cmd/claude-view-mod/` or `cmd/wsh/cmd/claude-skim-mod/`,
   include it too: the test checks all three copies, and each must match its source.
3. Run `npx vitest run claude/embedcopy.test.ts`. Expect all three cases to pass.
4. Commit only the synced copy files, by pathspec, with the subject
   `chore(wsh): sync the embedded Claude mod copy with claude/arc-mod (token burn card wait, 40f58fdd6)`. No
   CHANGELOG line: this is a build copy, not a change a user notices.

Acceptance: `claude/embedcopy.test.ts` passes, and the final stage's Verify passes.
