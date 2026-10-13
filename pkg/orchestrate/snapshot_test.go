// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// snapshotFixture is a project and its run's landing tree, with a spec in the project checkout (the same
// repository, outside the tree) and a plan inside the tree, where the lead writes it.
func snapshotFixture(t *testing.T) (tree, spec, plan string) {
	t.Helper()
	dir := newGitRepo(t)
	tree, err := CreateRunWorktree(context.Background(), dir, "run-1", gitCmd(t, dir, "rev-parse", "HEAD"))
	if err != nil {
		t.Fatal(err)
	}
	spec = filepath.Join(dir, "docs", "specs", "s.md")
	plan = filepath.Join(tree, "docs", "plans", "p.md")
	writeDoc(t, spec, "# spec\n")
	writeDoc(t, plan, "# plan\n")
	return tree, spec, plan
}

func writeDoc(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func commitCount(t *testing.T, tree string) string {
	t.Helper()
	return gitCmd(t, tree, "rev-list", "--count", "HEAD")
}

func TestSnapshotDocsCommitsBothDocsOnTheRunsBranch(t *testing.T) {
	tree, spec, plan := snapshotFixture(t)
	rels, err := SnapshotDocs(context.Background(), tree, "run-1", "coupons", spec, plan)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"docs/specs/s.md", "docs/plans/p.md"}; !reflect.DeepEqual(rels, want) {
		t.Fatalf("paths = %v, want %v", rels, want)
	}
	if msg := gitCmd(t, tree, "log", "-1", "--format=%B"); msg != "docs: spec and plan for coupons\n\nArc-Run: run-1" {
		t.Fatalf("message = %q", msg)
	}
	files := strings.Fields(gitCmd(t, tree, "show", "--name-only", "--format=", "HEAD"))
	if want := []string{"docs/plans/p.md", "docs/specs/s.md"}; !reflect.DeepEqual(files, want) {
		t.Fatalf("commit files = %v, want %v", files, want)
	}
	if got := gitCmd(t, tree, "show", "wave/run-1:docs/specs/s.md"); got != "# spec" {
		t.Fatalf("the branch holds spec %q", got)
	}
}

// a retried submit, or docs the lead already committed, must not fail on an empty commit
func TestSnapshotDocsWithUnchangedDocsCommitsNothing(t *testing.T) {
	tree, spec, plan := snapshotFixture(t)
	if _, err := SnapshotDocs(context.Background(), tree, "run-1", "coupons", spec, plan); err != nil {
		t.Fatal(err)
	}
	before := commitCount(t, tree)
	rels, err := SnapshotDocs(context.Background(), tree, "run-1", "coupons", spec, plan)
	if err != nil {
		t.Fatalf("an identical snapshot must succeed: %v", err)
	}
	if want := []string{"docs/specs/s.md", "docs/plans/p.md"}; !reflect.DeepEqual(rels, want) {
		t.Fatalf("paths = %v, want %v", rels, want)
	}
	if after := commitCount(t, tree); after != before {
		t.Fatalf("commits went from %s to %s", before, after)
	}
}

// a doc that differs from its committed copy only in line endings shows as modified, but `git add` normalises it
// back to the committed blob: run 33711a7e cancelled at submit on "nothing to commit" after a Windows tool wrote
// the plan with CRLF
func TestSnapshotDocsWithOnlyLineEndingChangesCommitsNothing(t *testing.T) {
	tree, spec, plan := snapshotFixture(t)
	writeDoc(t, filepath.Join(tree, ".gitattributes"), "* text=auto eol=lf\n")
	writeDoc(t, filepath.Join(tree, "docs", "specs", "s.md"), "# spec\nbody\n")
	writeDoc(t, plan, "# plan\nbody\n")
	gitCmd(t, tree, "add", ".")
	gitCmd(t, tree, "commit", "-m", "the lead commits its docs")
	before := commitCount(t, tree)
	writeDoc(t, spec, "# spec\r\nbody\r\n")
	writeDoc(t, plan, "# plan\r\nbody\r\n")
	rels, err := SnapshotDocs(context.Background(), tree, "run-1", "coupons", spec, plan)
	if err != nil {
		t.Fatalf("a snapshot that only changes line endings must succeed: %v", err)
	}
	if want := []string{"docs/specs/s.md", "docs/plans/p.md"}; !reflect.DeepEqual(rels, want) {
		t.Fatalf("paths = %v, want %v", rels, want)
	}
	if after := commitCount(t, tree); after != before {
		t.Fatalf("commits went from %s to %s", before, after)
	}
}

// a resubmit after a failed plan review carries revised docs, including a spec edited outside the tree. No lane
// has been cut from the first snapshot yet, so the revision replaces it: run 33880f82 left two commits with the
// same subject on main.
func TestSnapshotDocsRevisesTheSnapshotNoLaneHasCut(t *testing.T) {
	tree, spec, plan := snapshotFixture(t)
	if _, err := SnapshotDocs(context.Background(), tree, "run-1", "coupons", spec, plan); err != nil {
		t.Fatal(err)
	}
	before := commitCount(t, tree)
	writeDoc(t, spec, "# spec, revised\n")
	writeDoc(t, plan, "# plan, revised\n")
	if _, err := SnapshotDocs(context.Background(), tree, "run-1", "coupons", spec, plan); err != nil {
		t.Fatal(err)
	}
	if after := commitCount(t, tree); after != before {
		t.Fatalf("commits went from %s to %s, want the revision to replace the first snapshot", before, after)
	}
	if msg := gitCmd(t, tree, "log", "-1", "--format=%B"); msg != "docs: spec and plan for coupons\n\nArc-Run: run-1" {
		t.Fatalf("message = %q", msg)
	}
	if got := gitCmd(t, tree, "show", "HEAD:docs/specs/s.md"); got != "# spec, revised" {
		t.Fatalf("the branch holds spec %q", got)
	}
	if got := gitCmd(t, tree, "show", "HEAD:docs/plans/p.md"); got != "# plan, revised" {
		t.Fatalf("the branch holds plan %q", got)
	}
}

// a lane cut from the snapshot has read it, so a later one (a fix round's plan) is a commit of its own
func TestSnapshotDocsKeepsASnapshotALaneWasCutFrom(t *testing.T) {
	tree, spec, plan := snapshotFixture(t)
	if _, err := SnapshotDocs(context.Background(), tree, "run-1", "coupons", spec, plan); err != nil {
		t.Fatal(err)
	}
	first := gitCmd(t, tree, "rev-parse", "HEAD")
	gitCmd(t, tree, "branch", "wave/run-1-t-1", first)
	writeDoc(t, plan, "# plan, fix round\n")
	if _, err := SnapshotDocs(context.Background(), tree, "run-1", "coupons, fix round 1", plan); err != nil {
		t.Fatal(err)
	}
	if parent := gitCmd(t, tree, "rev-parse", "HEAD~1"); parent != first {
		t.Fatalf("the new snapshot's parent is %s, want the first snapshot %s kept", parent, first)
	}
}

// another run's snapshot, or the lead's own commit, is never rewritten
func TestSnapshotDocsKeepsAHeadThatIsNotThisRunsSnapshot(t *testing.T) {
	tree, spec, plan := snapshotFixture(t)
	if _, err := SnapshotDocs(context.Background(), tree, "run-2", "coupons", spec, plan); err != nil {
		t.Fatal(err)
	}
	first := gitCmd(t, tree, "rev-parse", "HEAD")
	writeDoc(t, plan, "# plan, revised\n")
	if _, err := SnapshotDocs(context.Background(), tree, "run-1", "coupons", spec, plan); err != nil {
		t.Fatal(err)
	}
	if parent := gitCmd(t, tree, "rev-parse", "HEAD~1"); parent != first {
		t.Fatalf("the new snapshot's parent is %s, want %s kept", parent, first)
	}
}

// the plan's H1 is the dag title, and the writing-plans template ends it in "Implementation Plan"
func TestSnapshotDocsSubjectDropsThePlanTemplateSuffix(t *testing.T) {
	tree, spec, plan := snapshotFixture(t)
	if _, err := SnapshotDocs(context.Background(), tree, "run-1", "Coupon codes Implementation Plan", spec, plan); err != nil {
		t.Fatal(err)
	}
	if got := gitCmd(t, tree, "log", "-1", "--format=%s"); got != "docs: spec and plan for Coupon codes" {
		t.Fatalf("subject = %q", got)
	}
}

// the lead's own staged work stays out of the engine's docs commit
func TestSnapshotDocsCommitsOnlyTheDocs(t *testing.T) {
	tree, spec, plan := snapshotFixture(t)
	writeDoc(t, filepath.Join(tree, "wip.txt"), "wip\n")
	gitCmd(t, tree, "add", "wip.txt")
	if _, err := SnapshotDocs(context.Background(), tree, "run-1", "coupons", spec, plan); err != nil {
		t.Fatal(err)
	}
	if files := gitCmd(t, tree, "show", "--name-only", "--format=", "HEAD"); strings.Contains(files, "wip.txt") {
		t.Fatalf("the docs commit took the lead's staged file: %v", files)
	}
}

func TestSnapshotDocsRefusesADocFromAnotherRepository(t *testing.T) {
	tree, _, plan := snapshotFixture(t)
	other := filepath.Join(newGitRepo(t), "spec.md")
	writeDoc(t, other, "# elsewhere\n")
	if _, err := SnapshotDocs(context.Background(), tree, "run-1", "coupons", other, plan); err == nil || !strings.Contains(err.Error(), other) {
		t.Fatalf("want an error naming %s, got %v", other, err)
	}
}

func TestSnapshotDocsKeepsAnEmptySlot(t *testing.T) {
	tree, _, plan := snapshotFixture(t)
	rels, err := SnapshotDocs(context.Background(), tree, "run-1", "coupons", "", plan)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"", "docs/plans/p.md"}; !reflect.DeepEqual(rels, want) {
		t.Fatalf("paths = %v, want %v", rels, want)
	}
}

func TestDocPath(t *testing.T) {
	tree := t.TempDir()
	abs := filepath.Join(t.TempDir(), "plan.md")
	g := &waveobj.TaskGroup{}
	for _, c := range []struct{ p, want string }{
		{"docs/plans/p.md", filepath.Join(tree, "docs", "plans", "p.md")},
		{abs, abs},
		{"", ""},
	} {
		if got := DocPath(g, tree, c.p); got != c.want {
			t.Fatalf("DocPath(%q) = %q, want %q", c.p, got, c.want)
		}
	}
}

func TestTreeTargetExplainsAPlanOutsideAnyRepository(t *testing.T) {
	tree, _, _ := snapshotFixture(t)
	outside := filepath.Join(t.TempDir(), "fix-plan.md")
	writeDoc(t, outside, "# fix\n")
	_, err := treeTarget(context.Background(), tree, outside)
	if err == nil || !strings.Contains(err.Error(), outside) || !strings.Contains(err.Error(), "inside the repository") {
		t.Fatalf("want an error naming %s and saying to write it inside the repository, got %v", outside, err)
	}
}
