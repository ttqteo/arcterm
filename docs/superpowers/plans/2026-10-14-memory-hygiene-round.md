# Memory hygiene: fix round

**Spec:** `docs/superpowers/specs/2026-10-13-memory-hygiene-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/memhygiene ./pkg/jarvisvolunteer ./pkg/wshrpc/... ./pkg/wps ./pkg/tsgen ./cmd/server`
**Check:** `go vet ./pkg/... ./cmd/server/... && task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs setup-memory surface-smoke`
**Prototype:** C:/Users/kael02/IdeaProjects/waveterm/.superpowers/design/memory-hygiene/project/Main.dc.html

Two defects the run left inside its goal. Each task is small and independent.

### Task 1: Applying one judge change no longer conflicts its siblings

**Depends on:** none

**Files:** `pkg/memhygiene/judge.go`, `pkg/memhygiene/judge_test.go`, `pkg/memhygiene/apply.go`, `pkg/memhygiene/apply_test.go`, `scripts/cdp/memory-fixtures.mjs`, `scripts/cdp/memory-fixtures.test.mjs`

The defect: `judgeBuild` puts the folder's `MEMORY.md` in a judge change's `Files` whenever the change edits the index. Apply checks every `Files` hash first, so once one judge change in a folder is applied, every other open judge change in that folder shows "Changed on disk" until a re-check, even though its own memory files are untouched. Split changes already leave the index out of `Files` and rely on the exact-line index edit; judge changes must do the same, so there is one rule for both.

- In `judgeBuild`, stop adding `inv.IndexPath` to the change's `Files`. `Files` holds the memory files, the doc path for move-to-doc, and the merge target, as now. `Op.IndexRemove` and `Op.IndexAdd` are unchanged.
- In `applyIndexEdit` (and wherever `Apply` reaches it), an `IndexRemove` line that is no longer in `MEMORY.md` is a conflict, not an error: `Apply` returns `conflict` naming the index path with nothing written (no backup dir), the same contract as a hash mismatch. Build the write plan before any write, as now, so this holds. An `IndexAdd` line already present in the target index is also a conflict. Do this check before anything is written.
- `Undo` keeps working for an apply whose manifest records `MEMORY.md`: the manifest still lists every file the apply wrote (index included), because the manifest is built from the write plan, not from `Files`. Confirm this; do not change the manifest.
- `scripts/cdp/memory-fixtures.mjs` mirrors the old convention (judge changes list `MEMORY.md`). Make it mirror the new one, so the fixture's ids and files match what `judgeBuild` produces. Its vitest keeps asserting ids and hashes against disk.

Tests:
- `TestApplyJudgeSiblingsNoConflict` (`apply_test.go`): build two judge changes in one folder through `ParseJudge` (a delete of `a.md` and a trim of `b.md`, both with index edits), apply the first, then apply the second: no conflict, and `MEMORY.md` has both edits.
- `TestApplyIndexLineGoneIsConflict`: edit `MEMORY.md` by hand to drop the line a delete removes, then apply it: `conflict` names `MEMORY.md`, `err` is nil, and no backup dir exists.
- `TestApplyIndexLineAlreadyPresentIsConflict`: an add-to-index whose line is already in the index gives a conflict.
- Update `TestParseJudgeBuildsOpAndHashes`: `Files` no longer contains the index path.

Run `go test ./pkg/memhygiene -count=1` and `npx vitest run scripts/cdp/memory-fixtures.test.mjs`.

### Task 2: A never-checked project's rail row says "Not checked yet" once

**Depends on:** none

**Files:** `frontend/app/view/agents/memorymodel.ts`, `frontend/app/view/agents/memorymodel.test.ts`, `frontend/app/view/agents/setupmemory.tsx`

The defect: `railRow` gives a never-checked project `meter: "Not checked yet"` while `railStatus` gives it the status "Not checked yet", so the row shows the text twice.

- In `railRow`, a never-checked project gets `meter: ""` (pct stays 0). The status keeps "Not checked yet".
- In `setupmemory.tsx`, the rail row does not render the meter span when `row.meter` is empty.

Test: in `memorymodel.test.ts`, a never-checked project's `railRow` has status "Not checked yet" and an empty meter. Run `npx vitest run frontend/app/view/agents/memorymodel.test.ts`.

Acceptance: the `setup-memory` scenario's step 7 shot shows `verify-mem-new`'s rail row with "Not checked yet" once.
