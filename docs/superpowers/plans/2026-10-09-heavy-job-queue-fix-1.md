# Heavy Job Queue — final-stage fix, round 1

**Goal:** Commit the embedded copies of the Claude mod and pi tools extension that Task 5 changed at their sources, so a `wsh` built without the Task sync no longer ships hooks that call the deleted `wsh memgate`.

Spec: `docs/superpowers/specs/2026-10-09-heavy-job-queue-design.md`. Parent plan: `docs/superpowers/plans/2026-10-09-heavy-job-queue.md`.

The final verifier found one defect where tasks meet. Task 5 (commit acbec020) changed `claude/arc-mod/hooks/` and `pi/extensions/waveterm-tools{,-core}.ts` but left their tracked copies under `cmd/wsh/cmd/` at the old memgate versions. `cmd/wsh/cmd/claude-mod/hooks/register.ts` still imports `memgate-core.ts` and runs `wsh memgate`, which this run deleted. `jobslot-core.ts` is missing from the copy. `go build ./cmd/wsh` and go test's embed take the stale files, and fail-open means the queue is silently bypassed. Repo practice is to commit the copies with their sources (5263ddb8, ccc30a7a).

---

### Task 1: commit the synced Claude mod and pi tools copies

**Depends on:** none

**Files:** `cmd/wsh/cmd/claude-mod/hooks/register.ts`, `cmd/wsh/cmd/claude-mod/hooks/jobslot-core.ts`, `cmd/wsh/cmd/claude-mod/hooks/memgate-core.ts`, `cmd/wsh/cmd/pi-tools-extension.ts`, `cmd/wsh/cmd/pi-tools-core-extension.ts`

This is the one exception to the parent plan's rule against touching `cmd/wsh/cmd/claude-mod/**` and `cmd/wsh/cmd/pi-*-extension.ts`. Their content still comes only from the sync, never from a hand edit.

**Step 1:** Run `task sync:claudemod sync:piartifacts`. Do not edit `claude/` or `pi/`.

**Step 2:** Check the result with `git status --short`. It must show exactly these and nothing else under `cmd/wsh/cmd/`:
- `register.ts` modified;
- `jobslot-core.ts` new;
- `memgate-core.ts` deleted;
- the two pi copies modified.

Check each copy matches its source. `diff claude/arc-mod/hooks/jobslot-core.ts cmd/wsh/cmd/claude-mod/hooks/jobslot-core.ts` must be empty, and the same goes for `register.ts`, `pi/extensions/waveterm-tools.ts` → `cmd/wsh/cmd/pi-tools-extension.ts` and `pi/extensions/waveterm-tools-core.ts` → `cmd/wsh/cmd/pi-tools-core-extension.ts`. `grep -rn "memgate" cmd/wsh/cmd/claude-mod cmd/wsh/cmd/pi-tools-*.ts` must not find a `wsh memgate` call.

**Step 3:** Run `go build ./cmd/wsh/...` with `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` on Windows. It must build, which shows the embed takes the new file set.

**Step 4:** Commit with a pathspec of the five paths above (`git add -A -- <paths>` first, so the deletion and the new file are staged). Message: `fix(wsh): commit the synced Claude mod and pi tools copies for the job queue`.
