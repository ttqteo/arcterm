// pkg/gitinfo/blame_test.go
package gitinfo

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// commitFile writes file=content and commits it with the given subject and author time.
func commitFile(t *testing.T, dir, file, content, subject string, unixSec int64) string {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, file), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	date := time.Unix(unixSec, 0).UTC().Format(time.RFC3339)
	env := append(os.Environ(),
		"GIT_AUTHOR_NAME=Ann Author", "GIT_AUTHOR_EMAIL=a@t", "GIT_AUTHOR_DATE="+date,
		"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t", "GIT_COMMITTER_DATE="+date)
	for _, args := range [][]string{{"add", "."}, {"commit", "-m", subject}} {
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		cmd.Env = env
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	sha, err := HeadCommit(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(sha)
}

func TestBlameGroups(t *testing.T) {
	dir := initRepo(t)
	first := commitFile(t, dir, "a.txt", "one\ntwo\nthree\n", "first commit", 1700000000)
	second := commitFile(t, dir, "a.txt", "one\nTWO\nthree\n", "second commit", 1700001000)

	res, err := Blame(context.Background(), dir, "a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if !res.IsRepo || res.Untracked {
		t.Fatalf("flags = %+v, want a tracked file in a repo", res)
	}
	want := []BlameHunk{
		{Start: 1, Lines: 1, Sha: first, Author: "Ann Author", AuthorTime: 1700000000, Subject: "first commit"},
		{Start: 2, Lines: 1, Sha: second, Author: "Ann Author", AuthorTime: 1700001000, Subject: "second commit"},
		{Start: 3, Lines: 1, Sha: first, Author: "Ann Author", AuthorTime: 1700000000, Subject: "first commit"},
	}
	if len(res.Hunks) != len(want) {
		t.Fatalf("hunks = %+v, want %d groups", res.Hunks, len(want))
	}
	for i, h := range res.Hunks {
		if h != want[i] {
			t.Errorf("hunk %d = %+v, want %+v", i, h, want[i])
		}
	}
}

func TestBlameGroupsConsecutiveLinesOfOneCommit(t *testing.T) {
	dir := initRepo(t)
	sha := commitFile(t, dir, "a.txt", "one\ntwo\nthree\n", "only commit", 1700000000)
	res, err := Blame(context.Background(), dir, "a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Hunks) != 1 || res.Hunks[0].Start != 1 || res.Hunks[0].Lines != 3 || res.Hunks[0].Sha != sha {
		t.Fatalf("hunks = %+v, want one 3-line group", res.Hunks)
	}
}

func TestBlameUncommitted(t *testing.T) {
	dir := initRepo(t)
	commitFile(t, dir, "a.txt", "one\ntwo\n", "first", 1700000000)
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\nedited\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := Blame(context.Background(), dir, "a.txt")
	if err != nil {
		t.Fatal(err)
	}
	last := res.Hunks[len(res.Hunks)-1]
	if last.Start != 2 || last.Sha != strings.Repeat("0", 40) {
		t.Fatalf("last hunk = %+v, want line 2 attributed to the zero sha", last)
	}
}

func TestBlameUntracked(t *testing.T) {
	dir := initRepo(t)
	commitFile(t, dir, "a.txt", "one\n", "first", 1700000000)
	if err := os.WriteFile(filepath.Join(dir, "new.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := Blame(context.Background(), dir, "new.txt")
	if err != nil {
		t.Fatalf("an untracked file is an answer, not an error: %v", err)
	}
	if !res.IsRepo || !res.Untracked || len(res.Hunks) != 0 {
		t.Fatalf("res = %+v, want untracked with no hunks", res)
	}
}

func TestBlameNoCommits(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "staged.txt", "x\n")
	gitRun(t, dir, "add", "staged.txt")
	writeFile(t, dir, "loose.txt", "y\n")
	for _, file := range []string{"staged.txt", "loose.txt"} {
		res, err := Blame(context.Background(), dir, file)
		if err != nil {
			t.Fatalf("%s: a repo with no commits is an answer, not an error: %v", file, err)
		}
		if !res.IsRepo || !res.Untracked || len(res.Hunks) != 0 {
			t.Fatalf("%s: res = %+v, want untracked with no hunks", file, res)
		}
	}
}

func TestBlameNotRepo(t *testing.T) {
	res, err := Blame(context.Background(), t.TempDir(), "a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if res.IsRepo {
		t.Fatalf("res = %+v, want IsRepo false", res)
	}
}

func TestBlameSubdirPath(t *testing.T) {
	dir := initRepo(t)
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	sha := commitFile(t, dir, "sub/c.txt", "c\n", "sub commit", 1700000000)
	res, err := Blame(context.Background(), filepath.Join(dir, "sub"), "c.txt")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Hunks) != 1 || res.Hunks[0].Sha != sha {
		t.Fatalf("hunks = %+v, want one group at %s", res.Hunks, sha)
	}
}
