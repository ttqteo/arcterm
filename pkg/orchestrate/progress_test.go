// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

func claudeCall(id, cmd string) string {
	return fmt.Sprintf(`{"type":"assistant","message":{"content":[{"type":"tool_use","id":%q,"name":"Bash","input":{"command":%q}}]}}`, id, cmd)
}

func claudeResult(id, out string, isErr bool) string {
	return fmt.Sprintf(`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":%q,"is_error":%t,"content":%q}]}}`, id, isErr, out)
}

func piCall(id, cmd string) string {
	return fmt.Sprintf(`{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","id":%q,"name":"bash","arguments":{"command":%q}}]}}`, id, cmd)
}

func piResult(id, out string, isErr bool) string {
	return fmt.Sprintf(`{"type":"message","message":{"role":"toolResult","toolCallId":%q,"toolName":"bash","isError":%t,"content":[{"type":"text","text":%q}]}}`, id, isErr, out)
}

func TestScanFindsTheSameFailureRepeated(t *testing.T) {
	var lines []string
	for i := 0; i < 4; i++ {
		id := fmt.Sprint("c", i)
		lines = append(lines, claudeCall(id, "go test ./pkg/x"), claudeResult(id, "--- FAIL: TestX\n want 2 got 3", true))
	}
	rf := scanRepeatedFailure(lines, nil)
	if rf.Count != 4 || rf.Command != "go test ./pkg/x" || rf.Key == "" {
		t.Fatalf("got %+v", rf)
	}
	// a key that already woke the lead is skipped, though its failures are still in the tail
	if again := scanRepeatedFailure(lines, []string{rf.Key}); again.Count != 0 {
		t.Fatalf("a flagged key must not flag again, got %+v", again)
	}
	// a new loop beside the old one still flags
	for i := 0; i < 3; i++ {
		id := fmt.Sprint("n", i)
		lines = append(lines, claudeCall(id, "go vet ./pkg/x"), claudeResult(id, "vet: unused x", true))
	}
	if other := scanRepeatedFailure(lines, []string{rf.Key}); other.Count != 3 || other.Command != "go vet ./pkg/x" {
		t.Fatalf("a different failure key flags, got %+v", other)
	}
}

func TestScanReadsPiToo(t *testing.T) {
	var lines []string
	for i := 0; i < 3; i++ {
		id := fmt.Sprint("p", i)
		lines = append(lines, piCall(id, "npm test"), piResult(id, "1 failed", true))
	}
	if rf := scanRepeatedFailure(lines, nil); rf.Count != 3 {
		t.Fatalf("got %+v", rf)
	}
}

func TestScanIgnoresProgressingFailuresAndSuccesses(t *testing.T) {
	var lines []string
	for i := 0; i < 4; i++ {
		id := fmt.Sprint("c", i)
		// red-green work: the same test, a different failure each run
		lines = append(lines, claudeCall(id, "go test ./pkg/x"), claudeResult(id, fmt.Sprintf("want %d got 0", i), true))
		ok := fmt.Sprint("ok", i)
		lines = append(lines, claudeCall(ok, "git status"), claudeResult(ok, "clean", false))
	}
	if rf := scanRepeatedFailure(lines, nil); rf.Count != 0 {
		t.Fatalf("a changing failure is not a loop, got %+v", rf)
	}
}

func TestScanSurvivesACutOrGarbledTail(t *testing.T) {
	if rf := scanRepeatedFailure([]string{`{"type":"assistant","mess`, "not json", ""}, nil); rf.Count != 0 {
		t.Fatalf("got %+v", rf)
	}
	path := filepath.Join(t.TempDir(), "s.jsonl")
	huge := strings.Repeat("x", 300<<10)
	if err := os.WriteFile(path, []byte(huge+"\n"+claudeCall("a", "ls")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	lines := readTranscriptTail(path, transcriptTailBytes)
	if len(lines) != 1 || !strings.Contains(lines[0], `"ls"`) {
		t.Fatalf("the cut first line is dropped, got %d lines", len(lines))
	}
	if readTranscriptTail(filepath.Join(t.TempDir(), "missing"), transcriptTailBytes) != nil {
		t.Fatal("a missing transcript reads as nothing")
	}
}

func TestSuspectReasonNamesWhatFired(t *testing.T) {
	rf := repeatedFailure{Key: "k", Command: "go test ./pkg/x", Count: 4}
	got := suspectReason(22*60_000, true, rf, "running go test ./pkg/x")
	want := "worktree unchanged 22m while active; `go test ./pkg/x` failed the same way 4x; now: running go test ./pkg/x"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if got := suspectReason(22*60_000, false, rf, ""); got != "`go test ./pkg/x` failed the same way 4x" {
		t.Fatalf("only the failure fired, got %q", got)
	}
}
