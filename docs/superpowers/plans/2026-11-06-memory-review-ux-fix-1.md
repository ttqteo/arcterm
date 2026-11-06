# Memory review UX — final-stage fix, round 1

**Spec:** `docs/superpowers/specs/2026-11-06-memory-review-ux-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/memhygiene/... ./pkg/consult/... ./pkg/wshrpc/... ./cmd/wsh/cmd/`
**Check:** `task check:ts && go vet ./pkg/memhygiene/... ./pkg/consult/... ./pkg/wshrpc/... ./cmd/wsh/cmd/`
**Final:** `node scripts/cdp/final-verify.mjs setup-memory`
**Prototype:** D:\src\arcterm\.superpowers\design\memory-review-ux\project\A-one-card.dc.html

**Goal:** Clear the one step that failed in the final stage on the merged result, so the run can land.

The Verify of the merged result failed on one test only, `claude/embedcopy.test.ts` ("cmd/wsh/cmd/claude-mod matches
claude/arc-mod"): `hooks/memlint-core.ts` and `hooks/register.ts` in the embedded copy are stale. The cause is on the
base, not in this run's work: main's commit 1d1ecae02 ("fix(arc-mod): the memory lint speaks up only past three
issues") edited `claude/arc-mod/hooks/memlint-core.ts` and `register.ts` and did not sync the copy that `wsh` embeds.

### Task 1: Sync the embedded Claude mod copy

**Depends on:** none

Files: `cmd/wsh/cmd/claude-mod/hooks/memlint-core.ts`, `cmd/wsh/cmd/claude-mod/hooks/register.ts` (the generated copy;
never edit `claude/arc-mod/`).

- Run `task sync:claudemod`. It copies `claude/arc-mod/` (minus its tests) over `cmd/wsh/cmd/claude-mod/`. Then
  `git status` should list only the two files above as modified. If anything else under `cmd/wsh/cmd/claude-mod/`
  changes, stop and report it; don't commit it.
- Do not hand-edit the copy. Do not change `claude/arc-mod/` or the test.
- Check with `npx vitest run claude/embedcopy.test.ts`: all three cases pass.
- Commit only the two copy files, with a subject like
  `chore(wsh): sync the embedded Claude mod copy with claude/arc-mod (memlint quiet max, 1d1ecae02)`.
- No CHANGELOG line: the user already got 1d1ecae02's behaviour from the source; this only brings the copy in line.
