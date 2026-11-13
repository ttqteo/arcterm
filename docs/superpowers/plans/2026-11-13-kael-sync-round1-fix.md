# Kael sync (2026-11-13) step 1, fix round 1

**Spec:** `docs/superpowers/specs/2026-11-13-kael-sync-engine-hardening-overview-design.md` (its "Our code wins" section
still applies: no existing behaviour or test of ours changes)

**Goal:** Clear the final stage's one failing step, and fix two open issues the run's tasks left in their own feature.

The final stage's Verify failed on `claude/embedcopy.test.ts`: the committed embed copy
`cmd/wsh/cmd/claude-mod/hooks/live-core.ts` and `hooks/register.ts` lag their source in `claude/arc-mod/hooks/`. That
predates this run (Task 1 found it on the base), but it holds the land.

### Task 1: Refresh the embedded Claude mod copy
**Depends on:** none
**Files:** `cmd/wsh/cmd/claude-mod/hooks/live-core.ts`, `cmd/wsh/cmd/claude-mod/hooks/register.ts`

- Run `task sync:claudemod` (it copies `claude/arc-mod` over `cmd/wsh/cmd/claude-mod`, minus tests and testdata).
- `git status` must then show only the two files above changed under `cmd/wsh/cmd/`. If the sync changes any other
  file (`claude-view-mod`, `claude-skim-mod`, or another `claude-mod` file), stop and report it instead of committing
  it.
- Never hand-edit the copies; `claude/arc-mod/` is the source and stays untouched.
- Check: `npx vitest run claude/embedcopy.test.ts` passes (all three cases).

### Task 2: Seal a lead-less branch run on backfill
**Depends on:** none
**Files:** `pkg/jarvis/evidence.go`, `pkg/jarvis/evidence_test.go`

`treeChanges` (`pkg/jarvis/evidence.go`, ported by the run's Task 9 from `c1998c0d0` / `9814ea56c` / `49c31729f`)
refuses with "the landing tree … is gone and the reported commit … does not resolve" whenever `run.EndCommit != ""`.
A branch run whose lead made no commits has `EndCommit == BaseCommit`; when its first seal failed and the backfill
seal runs after the land removed the tree, it stays unsealed forever although its true file list is empty.

- Treat `EndCommit == BaseCommit` like an empty `EndCommit` on that path, so such a run seals with no changes.
- Every other refusal stays as it is: a different `EndCommit` that does not resolve still errors.
- Add a new test for the lead-less backfill case (tree gone, `EndCommit == BaseCommit`, seals with an empty change
  list). Add new test functions only; no existing case in `evidence_test.go` is edited.
- Run: `go test ./pkg/jarvis -run 'Evidence|Seal|TreeChanges'` (on Windows with
  `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"`).

### Task 3: Plan-format guide: the plan-parsing refusals
**Depends on:** none
**Files:** `docs/guide/plan-format.md`

The run's Task 2 changed what `ParsePlan` accepts, and Task 16 documented it in `docs/guide/orchestrator.md` only.
`docs/guide/plan-format.md` (Vietnamese, like the rest of `docs/guide/`) still describes the old rules. Bring it in
line with `pkg/jarvis/plan.go` as it now is, reading the code, not the fork:

- In "Tiêu đề" (task heading): a heading that nearly matches the task shape outside a fence (`### Task 3 - c`,
  `## Task 2 notes` inside a task body) is refused; the plan's own `#` title is not.
- A UTF-8 BOM at the start is stripped; a fence can open on a list item; a fence inside a fence closes only on its own
  closer; an inline code span opens no fence; an unclosed fence that hides a task heading is refused.
- A `**Depends on:**` line placed after a task's Files, Model or Chunk line, after prose, or a second one under the
  same heading is not read as Depends: it stays task text and the task keeps its implicit edge to the task before it.
  Say plainly that this is silent, so a plan author puts Depends first.
- Add each refusal to the error table under "Kiểm tra trước khi chạy" with the message `ParsePlan` returns.
- Keep every existing heading and anchor; change only lines these rules make wrong, and add the rest.
