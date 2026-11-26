// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// initRepoWithIgnore is a repo with a.txt and a .gitignore holding out/, both committed.
func initRepoWithIgnore(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	useTestWorktreeRoot(t)
	gitCmd(t, dir, "init", "-b", "main")
	gitCmd(t, dir, "config", "user.email", "t@test")
	gitCmd(t, dir, "config", "user.name", "t")
	writeFile(t, filepath.Join(dir, "a.txt"), "zero\n")
	writeFile(t, filepath.Join(dir, ".gitignore"), "out/\n")
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-qm", "base")
	return dir
}

func TestFingerprintSeesCommitsEditsAndNewFiles(t *testing.T) {
	dir := initRepoWithIgnore(t)
	ctx := context.Background()
	fp := func() string {
		s, err := worktreeFingerprint(ctx, dir)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	base := fp()
	writeFile(t, filepath.Join(dir, "a.txt"), "one")
	edited := fp()
	if edited == base {
		t.Fatal("an edit is progress")
	}
	// already modified: status text alone would not change; a different length changes the size within the same second
	writeFile(t, filepath.Join(dir, "a.txt"), "one two")
	if fp() == edited {
		t.Fatal("a further edit to a modified file is progress")
	}
	before := fp()
	writeFile(t, filepath.Join(dir, "out", "log.txt"), "artifact")
	if fp() != before {
		t.Fatal("an ignored file is not progress")
	}
	writeFile(t, filepath.Join(dir, "new.txt"), "x")
	withNew := fp()
	if withNew == before {
		t.Fatal("a new untracked file is progress")
	}
	gitCmd(t, dir, "add", "-A")
	gitCmd(t, dir, "commit", "-qm", "c")
	if fp() == withNew {
		t.Fatal("a commit is progress")
	}
}

func TestFingerprintErrorsOutsideARepo(t *testing.T) {
	if _, err := worktreeFingerprint(context.Background(), filepath.Join(t.TempDir(), "gone")); err == nil {
		t.Fatal("an unreadable tree is an error, not a fingerprint")
	}
}

// A task in a project that is not a git repo has no lane tree (its child run's Branch stays empty), so the probe's git
// status there can only fail: the check must not run it, once a minute per task, under the dag lock.
func TestProgressCheckSkipsATaskWithNoTree(t *testing.T) {
	calls := 0
	prevFP, prevBlock := progressFingerprint, workerBlockFn
	progressFingerprint = func(context.Context, string) (string, error) {
		calls++
		return "", errors.New("not a git repository")
	}
	workerBlockFn = func(context.Context, *waveobj.Run) (string, bool) { return "", false }
	t.Cleanup(func() { progressFingerprint, workerBlockFn = prevFP, prevBlock })

	now := time.Now().UnixMilli()
	task := &waveobj.TaskNode{ID: "t-0", State: TaskState_Running}
	run := &waveobj.Run{ID: "r-1", ProjectPath: t.TempDir()}
	if reason, _, flagged := checkProgress(context.Background(), task, run, now); flagged || reason != "" {
		t.Fatalf("a task with no tree is never flagged, got %q", reason)
	}
	if calls != 0 || task.ProgressCheckTs != 0 {
		t.Fatalf("no lane tree means no probe, got %d calls and check ts %d", calls, task.ProgressCheckTs)
	}

	// the same run with a lane tree is probed, so the zero above is the guard's doing and not the stub's
	run.Branch = "wave/t-0"
	checkProgress(context.Background(), task, run, now)
	if calls != 1 {
		t.Fatalf("a task with a lane tree is probed once, got %d calls", calls)
	}
}

func TestSuspectReasonNamesWhatFired(t *testing.T) {
	got := suspectReason(22*60_000, "running go test ./pkg/x")
	want := "worktree unchanged 22m while active; now: running go test ./pkg/x"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if got := suspectReason(22*60_000, ""); got != "worktree unchanged 22m while active" {
		t.Fatalf("with no tool running, got %q", got)
	}
}
