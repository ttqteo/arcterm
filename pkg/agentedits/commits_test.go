// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentedits

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// gitOut runs git in dir with a fixed identity and returns its trimmed output.
func gitOut(t testing.TB, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "user.name=t", "-c", "user.email=t@t", "-C", dir}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

// isolateGit hides the machine's git config, so BuildCommits must bring its own identity.
func isolateGit(t testing.TB) {
	empty := filepath.Join(t.TempDir(), "gitconfig")
	if err := os.WriteFile(empty, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GIT_CONFIG_GLOBAL", empty)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
}

// tempRepo commits files into a fresh repository and returns its root and the commit.
func tempRepo(t testing.TB, files map[string]string, config ...string) (string, string) {
	t.Helper()
	isolateGit(t)
	dir := t.TempDir()
	gitOut(t, dir, "init", "-q", "-b", "main")
	for i := 0; i+1 < len(config); i += 2 {
		gitOut(t, dir, "config", config[i], config[i+1])
	}
	for p, c := range files {
		abs := filepath.Join(dir, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, []byte(c), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	gitOut(t, dir, "add", "-A")
	gitOut(t, dir, "commit", "-q", "-m", "init")
	return dir, gitOut(t, dir, "rev-parse", "HEAD")
}

func changed(path, pre, post string) File {
	return File{Path: path, Pre: []byte(pre), PreExists: true, Post: []byte(post), PostExists: true}
}

func lines(s string) []string {
	if s == "" {
		return nil
	}
	out := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
	sort.Strings(out)
	return out
}

func TestBuildCommitsListsExactlyTheFilesAndChainsParents(t *testing.T) {
	repo, parent := tempRepo(t, map[string]string{"a.txt": "a\n", "dir/b.txt": "b\n", "c.txt": "c\n"})
	// the index lives under the temp dir, which must be empty again afterwards
	tmp := t.TempDir()
	t.Setenv("TMP", tmp)
	t.Setenv("TEMP", tmp)
	t.Setenv("TMPDIR", tmp)

	base, end, err := BuildCommits(context.Background(), repo, parent, t0.Unix(), []File{
		changed("a.txt", "a\n", "a2\n"),
		changed("dir/b.txt", "b-agent-start\n", "b2\n"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := lines(gitOut(t, repo, "diff", "--name-only", base, end)); !reflect.DeepEqual(got, []string{"a.txt", "dir/b.txt"}) {
		t.Errorf("diff B H = %v, want [a.txt dir/b.txt]", got)
	}
	if got := gitOut(t, repo, "rev-list", "--parents", "-n", "1", base); got != base+" "+parent {
		t.Errorf("B parents = %q, want %s", got, parent)
	}
	if got := gitOut(t, repo, "rev-list", "--parents", "-n", "1", end); got != end+" "+base {
		t.Errorf("H parents = %q, want %s", got, base)
	}
	if got := gitOut(t, repo, "show", end+":dir/b.txt"); got != "b2" {
		t.Errorf("H:dir/b.txt = %q, want b2", got)
	}
	left, err := os.ReadDir(tmp)
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 0 {
		t.Errorf("temp dir holds %v after the build, want nothing", left)
	}
	if got := gitOut(t, repo, "status", "--porcelain"); got != "" {
		t.Errorf("the repository's own index or tree changed: %q", got)
	}

	base2, end2, err := BuildCommits(context.Background(), repo, parent, t0.Unix(), []File{
		changed("a.txt", "a\n", "a2\n"),
		changed("dir/b.txt", "b-agent-start\n", "b2\n"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if base2 != base || end2 != end {
		t.Errorf("rebuild = %s..%s, want the same %s..%s", base2, end2, base, end)
	}
}

func TestBuildCommitsAdditionsDeletionsAndNoOps(t *testing.T) {
	repo, parent := tempRepo(t, map[string]string{"keep.txt": "same\n", "old.txt": "old\n"})
	base, end, err := BuildCommits(context.Background(), repo, parent, t0.Unix(), []File{
		{Path: "new.txt", Post: []byte("new\n"), PostExists: true},
		{Path: "old.txt", Pre: []byte("old\n"), PreExists: true},
		changed("keep.txt", "same\n", "same\n"),
	})
	if err != nil {
		t.Fatal(err)
	}
	got := lines(gitOut(t, repo, "diff", "--name-status", base, end))
	want := []string{"A\tnew.txt", "D\told.txt"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("diff --name-status B H = %q, want %q", got, want)
	}
	if out := gitOut(t, repo, "ls-tree", "--name-only", base); strings.Contains(out, "new.txt") {
		t.Errorf("B holds new.txt, want it absent before the agent: %q", out)
	}
}

func TestBuildCommitsOnlyAdditions(t *testing.T) {
	// no pre-image exists, so B's step writes nothing to the temporary work tree
	repo, parent := tempRepo(t, map[string]string{"a.txt": "a\n"})
	base, end, err := BuildCommits(context.Background(), repo, parent, t0.Unix(), []File{
		{Path: "new.txt", Post: []byte("new\n"), PostExists: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := gitOut(t, repo, "diff", "--name-status", base, end); got != "A\tnew.txt" {
		t.Errorf("diff --name-status B H = %q, want new.txt added", got)
	}
}

func TestBuildCommitsCRLFOneLineChange(t *testing.T) {
	repo, parent := tempRepo(t, map[string]string{"f.txt": "one\ntwo\nthree\n"}, "core.autocrlf", "true")
	// the checkout holds CRLF, so the backup and the agent's result do too
	base, end, err := BuildCommits(context.Background(), repo, parent, t0.Unix(), []File{
		changed("f.txt", "one\r\ntwo\r\nthree\r\n", "one\r\nTWO\r\nthree\r\n"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := gitOut(t, repo, "diff", "--numstat", base, end); got != "1\t1\tf.txt" {
		t.Errorf("diff --numstat B H = %q, want one line changed", got)
	}
	if got := gitOut(t, repo, "diff", "--numstat", parent, base); got != "" {
		t.Errorf("diff --numstat parent B = %q, want no change", got)
	}
}
