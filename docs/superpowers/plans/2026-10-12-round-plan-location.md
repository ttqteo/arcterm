# Round Plan Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Verify:** `node scripts/verify.mjs ./pkg/orchestrate ./pkg/jarvis`

**Goal:** A lead that writes its `wsh jarvis dag submit --round` fix plan outside any git repository gets an error that says what to do, and the lead rules say where to write it in the first place.

**Architecture:** `orchestrate.treeTarget` places a plan in the run's landing tree and today returns git's raw `rev-parse --show-toplevel` failure when the plan's directory is not in a repository. It wraps that failure with the instruction. Separately, the two lead rule lines that tell a lead to write a fix plan name where it goes, from one shared constant in `pkg/jarvis/leadprompt.go`. The two tasks touch different packages and files and share no names, so they run side by side.

**Tech Stack:** Go (`pkg/orchestrate`, `pkg/jarvis`).

**Spec:** none; the problem is effort `a40b6c01` chunk 20 (a plan outside the run's worktree fails with `git rev-parse --show-toplevel: not a git repository`).

## Why

- `treeTarget` (`pkg/orchestrate/snapshot.go:110`) accepts a plan inside the tree as is, and one elsewhere in the same repository by copying it in. A plan in a directory that is in no repository (a temp dir) reaches `git -C <dir> rev-parse --show-toplevel`, whose failure comes back unexplained.
- The lead rules (`pkg/jarvis/leadprompt.go:75` and `:77`) say "write a fix plan in the plan format" and nothing about where, so a lead that picks a temp dir hits that error.

## Global Constraints

- The wrapped error keeps the cause (`%w`) and names the plan path and the words `inside the repository`; Task 1's test and the lead rules rely on that phrase alone, not on each other.
- The lead rule sentence is one constant used by both lines, so the two cannot drift.
- Run Go tests per package as AGENTS.md says (`go test ./pkg/x -run '^TestName$'`); `gofmt -l` only the files you touch.
- No new files; no wshrpc type changes, so `task generate` is not part of this plan.

## Review Focus

- A plan path whose directory does not exist: the error must still name the path (the wrap does, whatever git says).
- A plan already inside the tree, or elsewhere in the same repository: unchanged, no error (the existing `TestSnapshotDocs*` tests cover both; they must keep passing).
- A plan from another repository: still refused with the existing message naming the path (`TestSnapshotDocsRefusesADocFromAnotherRepository`).

---

### Task 1: Explain a plan that is outside any repository

**Depends on:** none

**Files:** `pkg/orchestrate/snapshot.go`, `pkg/orchestrate/snapshot_test.go`

Edit `treeTarget`, `snapshot.go:115-118`; the test goes in `snapshot_test.go`.

**Interfaces:**
- Consumes: `treeTarget(ctx, tree, path string) (string, error)`, `snapshotFixture(t) (tree, spec, plan string)` and `writeDoc(t, path, text string)` from `snapshot_test.go`.
- Produces: nothing new; `treeTarget`'s error text changes.

- [ ] **Step 1: Write the failing test**

Append to `pkg/orchestrate/snapshot_test.go`:

```go
func TestTreeTargetExplainsAPlanOutsideAnyRepository(t *testing.T) {
	tree, _, _ := snapshotFixture(t)
	outside := filepath.Join(t.TempDir(), "fix-plan.md")
	writeDoc(t, outside, "# fix\n")
	_, err := treeTarget(context.Background(), tree, outside)
	if err == nil || !strings.Contains(err.Error(), outside) || !strings.Contains(err.Error(), "inside the repository") {
		t.Fatalf("want an error naming %s and saying to write it inside the repository, got %v", outside, err)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./pkg/orchestrate -run '^TestTreeTargetExplainsAPlanOutsideAnyRepository$'`
Expected: FAIL; the error is git's `rev-parse` text and lacks "inside the repository".

- [ ] **Step 3: Wrap the failure**

In `treeTarget`, replace the first `rev-parse` error return:

```go
	top, err := git(ctx, dir, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", fmt.Errorf("%s cannot be placed in the run's tree: write it inside the repository, such as in the run's worktree: %w", path, err)
	}
```

- [ ] **Step 4: Run the package's snapshot tests**

Run: `go test ./pkg/orchestrate -run 'TestTreeTarget|TestSnapshotDocs'`
Expected: PASS, including `TestSnapshotDocsRefusesADocFromAnotherRepository`.

- [ ] **Step 5: Commit**

```bash
git add pkg/orchestrate/snapshot.go pkg/orchestrate/snapshot_test.go
git commit -m "fix(orchestrate): a plan outside any repository says to write it inside the repository"
```

### Task 2: Tell the lead where a fix plan goes

**Depends on:** none

**Files:** `pkg/jarvis/leadprompt.go`, `pkg/jarvis/leadprompt_test.go`

Edit `leadprompt.go:75` and `:77`; the test goes in `leadprompt_test.go`.

**Interfaces:**
- Consumes: `OrchestrationRules(runId, specPath, planPath, effortOID string) string` (`leadprompt.go:56`).
- Produces: `const fixPlanHome` in `pkg/jarvis/leadprompt.go`.

- [ ] **Step 1: Write the failing test**

Append to `pkg/jarvis/leadprompt_test.go`:

```go
func TestRulesSayWhereAFixPlanGoes(t *testing.T) {
	r := OrchestrationRules("r1", "", "", "")
	if got := strings.Count(r, fixPlanHome); got != 2 {
		t.Fatalf("want the fix plan's place named in both the run-finished and the failed-final rule, got %d:\n%s", got, r)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./pkg/jarvis -run '^TestRulesSayWhereAFixPlanGoes$'`
Expected: FAIL to compile (`fixPlanHome` undefined).

- [ ] **Step 3: Add the constant and use it in both lines**

In `leadprompt.go` add:

```go
// fixPlanHome: the round commits the plan to the run's branch, and a plan in no repository (a temp dir) cannot be
const fixPlanHome = "Write the fix plan inside the repository (your working directory is fine); a plan outside any git repository is refused."
```

On the run-finished line, insert `" + fixPlanHome + "` right after `you wrap up at the next run-finished wake.` On the failed-final line, insert a `%s` after `at most 2 rounds.` and pass `fixPlanHome` as the first argument, before `AskTool("claude")`, matching the new `%s` order.

- [ ] **Step 4: Run the package's tests**

Run: `go test ./pkg/jarvis`
Expected: PASS; the existing rule assertions (`"at most 2 rounds"`, `"a round is left"`, ordering of the ask before complete) still hold.

- [ ] **Step 5: Commit**

```bash
git add pkg/jarvis/leadprompt.go pkg/jarvis/leadprompt_test.go
git commit -m "feat(jarvis): the lead rules say where a fix plan goes"
```
