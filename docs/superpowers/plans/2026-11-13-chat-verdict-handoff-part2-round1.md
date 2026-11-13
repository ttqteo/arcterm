# Reviewer verdict and plan handoff cards in Chat — part 2, fix round 1

**Effort:** effort:7655bf18-619e-40cf-8805-5f4a6e5ac85e
**Spec:** `docs/superpowers/specs/2026-11-12-chat-verdict-handoff-design.md`

The final stage's Verify failed on the merged result in one test, `claude/embedcopy.test.ts` ("cmd/wsh/cmd/claude-mod
matches claude/arc-mod"): the embedded copy's `hooks/register.ts` is stale and `hooks/live-core.ts` is missing. The
drift is on the base (commit `05485e953`, "Claude's reply streams into Chat as it is written", changed
`claude/arc-mod/hooks/` without refreshing the copy), not this run's code, but it holds the land. Workers on this run
also reported a teardown log line in the new scenario that is worth fixing while it is open.

### Task 1: Refresh the embedded Claude mod copy
**Depends on:** none
**Model:** haiku
**Files:** `cmd/wsh/cmd/claude-mod/hooks/register.ts`, `cmd/wsh/cmd/claude-mod/hooks/live-core.ts`

Run `task sync:claudemod --force` (Bash; `--force` because the task is checksum-gated and `run: once`). It regenerates
`cmd/wsh/cmd/claude-mod/` from `claude/arc-mod/` (AGENTS.md: edit `claude/`, never the copy; this task only commits the
regenerated copy). Commit only the copy's changes: `register.ts` and the new `live-core.ts`, plus any other file under
`cmd/wsh/cmd/claude-mod/`, `claude-view-mod/` or `claude-skim-mod/` the sync changed. Do not hand-edit any file there, and do
not touch `claude/`. Do not commit `src-tauri/Cargo.lock` or any other file a build rewrites.

Acceptance: `npx vitest run claude/embedcopy.test.ts` passes (all three copies).

### Task 2: The scenario's teardown skips a run that is already done
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios-chat-verdict-handoff.mjs`

Teardown in `scripts/cdp/scenarios-chat-verdict-handoff.mjs` cancels each fixture run it made. For the run step 7 lands
(and any other run a step finished: held, landed, complete), cancelling logs `cancel run <id> failed: run … is done; a
finished run cannot be cancelled`. Read the run's state first (as the scenario already does for its asserts) and cancel
only a run that is not done; delete or otherwise clean up a done one the way the file already cleans up its runs, or leave
it to the channel cleanup if that already removes it. Change nothing else in the scenario's steps or asserts.

Acceptance: `node --check scripts/cdp/scenarios-chat-verdict-handoff.mjs` passes. The Final runs the scenario.
