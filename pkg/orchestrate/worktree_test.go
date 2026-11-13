package orchestrate

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func gitCmd(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func newGitRepo(t *testing.T) string {
	t.Helper()
	dir := realTempDir(t)
	newGitRepoAt(t, dir)
	return dir
}

// realTempDir is t.TempDir with its symlinks resolved: on macOS the temp dir is under /var, a link to
// /private/var, and git prints the resolved path, which a path built from the link is not inside.
func realTempDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

var repoTemplate struct {
	once sync.Once
	dir  string
}

// gitRepoTemplate is a repo on main with one base commit, built once per test process: a fixture copies it,
// where building its own took six git launches, about 1,400 of the package's 6,000.
func gitRepoTemplate(t *testing.T) string {
	t.Helper()
	repoTemplate.once.Do(func() {
		dir, err := os.MkdirTemp(wavebase.DataHome_VarCache, "repo-template-*")
		if err != nil {
			t.Fatal(err)
		}
		gitCmd(t, dir, "init", "-b", "main")
		gitCmd(t, dir, "config", "user.email", "t@test")
		gitCmd(t, dir, "config", "user.name", "t")
		writeFile(t, filepath.Join(dir, "base.txt"), "base\n")
		gitCmd(t, dir, "add", ".")
		gitCmd(t, dir, "commit", "-m", "base")
		if err := os.RemoveAll(filepath.Join(dir, ".git", "hooks")); err != nil {
			t.Fatal(err)
		}
		repoTemplate.dir = dir
	})
	if repoTemplate.dir == "" {
		t.Fatal("the repo template failed to build in an earlier test")
	}
	return repoTemplate.dir
}

func TestCreateAndRemoveWorktree(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, err := CreateRunWorktree(context.Background(), dir, "run-1", base)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(wt, "base.txt")); err != nil {
		t.Fatalf("worktree missing base file: %v", err)
	}
	if err := RemoveRunWorktree(context.Background(), dir, "run-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(wt); !os.IsNotExist(err) {
		t.Fatalf("worktree still exists: %v", err)
	}
}

// A tree's root can be longer than the project's, so a file the project checks out fits under MAX_PATH there and
// not in the tree: run 58942051 failed its landing tree with "unable to create file".
func TestCreateRunWorktreeChecksOutPathsPastMaxPath(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("only Windows caps a path at MAX_PATH")
	}
	empty := filepath.Join(t.TempDir(), "gitconfig")
	os.WriteFile(empty, nil, 0o644)
	t.Setenv("GIT_CONFIG_GLOBAL", empty)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	dir := newGitRepo(t)
	// the test's own root is as long as the project; this one puts the tree's copy of the file past MAX_PATH
	t.Cleanup(UseWorktreeRootForTest(filepath.Join(t.TempDir(), "a-root-longer-than-the-project-dir")))
	const maxPath = 260
	rel := ""
	for len(dir)+len(rel)+len("\\f.txt") < maxPath-20 {
		rel = filepath.Join(rel, "segment")
	}
	rel = filepath.Join(rel, "f.txt")
	os.MkdirAll(filepath.Join(dir, filepath.Dir(rel)), 0o755)
	os.WriteFile(filepath.Join(dir, rel), []byte("deep\n"), 0o644)
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "deep")
	base := gitCmd(t, dir, "rev-parse", "HEAD")

	runID := "58942051-063d-4de2-96f0-7348f22bc389"
	wt, err := CreateRunWorktree(context.Background(), dir, runID, base)
	if err != nil {
		t.Fatal(err)
	}
	if len(filepath.Join(wt, rel)) <= maxPath {
		t.Fatalf("the tree's copy %s fits under MAX_PATH, so the test proves nothing", filepath.Join(wt, rel))
	}
	if _, err := os.Stat(filepath.Join(wt, rel)); err != nil {
		t.Fatalf("tree missing the deep file: %v", err)
	}
	// a worker's own git in the tree must see the deep file too, or its `git add -A` stages a deletion
	if out := gitCmd(t, wt, "status", "--porcelain"); out != "" {
		t.Fatalf("the fresh tree must be clean, got %q", out)
	}
}

func TestDropProgressKeepsTheFailureLine(t *testing.T) {
	out := "Preparing worktree (new branch 'wave/x')\nUpdating files:   7% (1016/13562)\rUpdating files:   8% (1085/13562)\r" +
		"Updating files: 100% (13562/13562), done.\nerror: unable to create file a/b.txt: Filename too long\n"
	want := "Preparing worktree (new branch 'wave/x')\nerror: unable to create file a/b.txt: Filename too long"
	if got := dropProgress(out); got != want {
		t.Fatalf("dropProgress = %q, want %q", got, want)
	}
}

func TestIsGitRepoFalse(t *testing.T) {
	if IsGitRepo(t.TempDir()) {
		t.Fatal("temp dir must not be a git repo")
	}
}

func TestRecoveryPatch(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, _ := CreateRunWorktree(context.Background(), dir, "run-1", base)
	os.WriteFile(filepath.Join(wt, "new.txt"), []byte("work\n"), 0o644)
	gitCmd(t, wt, "add", ".")
	gitCmd(t, wt, "commit", "-m", "wip")
	if err := DumpRecoveryPatch(context.Background(), dir, "run-1", ""); err != nil {
		t.Fatal(err)
	}
	patch := filepath.Join(dir, ".waveterm", "recovery", "run-1.patch")
	if _, err := os.Stat(patch); err != nil {
		t.Fatalf("recovery patch missing: %v", err)
	}
}

// a git its context killed has given no answer: on Windows a killed process exits 1, which gitAsk read as "no"
func TestGitAskReportsAGitItsContextKilled(t *testing.T) {
	old := gitWaitDelay
	gitWaitDelay = 200 * time.Millisecond
	defer func() { gitWaitDelay = old }()
	dir := newGitRepo(t)
	hook := filepath.Join(dir, ".git", "hooks", "pre-commit")
	writeFile(t, hook, "#!/bin/sh\nsleep 10\n")
	if err := os.Chmod(hook, 0o755); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if yes, err := gitAsk(ctx, dir, "commit", "--allow-empty", "-q", "-m", "slow"); err == nil {
		t.Fatalf("a killed git must be an error, got yes=%v", yes)
	}
}

// a lane rebuilt dirty twice dumps under the same name; the first patch is the only copy of that attempt's
// uncommitted work, so the second goes beside it
func TestRecoveryPatchNeverOverwritesAnEarlierOne(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, _ := CreateRunWorktree(context.Background(), dir, "run-1", base)
	recDir := filepath.Join(dir, ".waveterm", "recovery")
	for _, attempt := range []string{"first", "second"} {
		writeFile(t, filepath.Join(wt, attempt+".txt"), attempt+"\n")
		if err := DumpRecoveryPatch(context.Background(), dir, "run-1", ""); err != nil {
			t.Fatal(err)
		}
		gitCmd(t, wt, "reset", "-q", "--hard")
		gitCmd(t, wt, "clean", "-fdq")
	}
	first, second := readFile(t, filepath.Join(recDir, "run-1.patch")), readFile(t, filepath.Join(recDir, "run-1-2.patch"))
	if !strings.Contains(first, "first.txt") || !strings.Contains(second, "second.txt") || strings.Contains(second, "first.txt") {
		t.Fatalf("each dump keeps its own attempt:\nrun-1.patch:\n%s\nrun-1-2.patch:\n%s", first, second)
	}
}

// the patch is git's diff as written: trimmed, it lost its final newline and git apply rejected it as corrupt
func TestRecoveryPatchApplies(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, _ := CreateRunWorktree(context.Background(), dir, "run-1", base)
	writeFile(t, filepath.Join(wt, "new.txt"), "one\ntwo\n\n")
	gitCmd(t, wt, "add", ".")
	gitCmd(t, wt, "commit", "-m", "wip")
	writeFile(t, filepath.Join(wt, "dirty.txt"), "uncommitted\n")
	if err := DumpRecoveryPatch(context.Background(), dir, "run-1", ""); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "apply", "--check", filepath.Join(dir, ".waveterm", "recovery", "run-1.patch"))
}

func TestEnsureRunWorktreeReusesCleanTree(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	key := TaskWorktreeKey("owner-1", "t-1")
	wt, err := CreateRunWorktree(context.Background(), dir, key, base)
	if err != nil {
		t.Fatal(err)
	}
	// sentinel: a reused tree keeps its files; a recreated one would not
	os.WriteFile(filepath.Join(wt, "sentinel.txt"), []byte("x"), 0o644)
	gitCmd(t, wt, "add", ".")
	gitCmd(t, wt, "commit", "-m", "child work")
	got, _, created, err := EnsureRunWorktree(context.Background(), dir, key, base)
	if err != nil {
		t.Fatal(err)
	}
	if created {
		t.Fatal("a reused tree was not created by this call")
	}
	if got != wt {
		t.Fatalf("clean committed tree must be reused: got %s want %s", got, wt)
	}
	if _, err := os.Stat(filepath.Join(wt, "sentinel.txt")); err != nil {
		t.Fatal("sentinel lost on reuse")
	}
}

// A clean tree is always reusable even when head != baseCommit: committed child work must survive,
// and owner.BaseCommit is constant per run so a legitimately wrong-base tree cannot arise from the
// engine itself. This pins that contract.
func TestEnsureRunWorktreeKeepsCommittedWorkWhenBaseAdvanced(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	key := TaskWorktreeKey("owner-1", "t-1")
	wt, err := CreateRunWorktree(context.Background(), dir, key, base)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(wt, "feature.txt"), []byte("feat"), 0o644)
	gitCmd(t, wt, "add", ".")
	gitCmd(t, wt, "commit", "-m", "child work")
	// project advances past base while the child works
	os.WriteFile(filepath.Join(dir, "new.txt"), []byte("n"), 0o644)
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "advance")
	newBase := gitCmd(t, dir, "rev-parse", "HEAD")

	got, _, _, err := EnsureRunWorktree(context.Background(), dir, key, newBase)
	if err != nil {
		t.Fatal(err)
	}
	if got != wt {
		t.Fatalf("committed child work must not be discarded: %s vs %s", got, wt)
	}
	if _, err := os.Stat(filepath.Join(wt, "feature.txt")); err != nil {
		t.Fatal("child work lost on ensure")
	}
}

func TestEnsureRunWorktreeRecreatesDirtyAndDumpsPatch(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	key := TaskWorktreeKey("owner-1", "t-1")
	wt, err := CreateRunWorktree(context.Background(), dir, key, base)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(wt, "uncommitted.txt"), []byte("wip"), 0o644)

	if _, _, created, err := EnsureRunWorktree(context.Background(), dir, key, base); err != nil || !created {
		t.Fatalf("a dirty tree is rebuilt, so this call creates it: created=%v err=%v", created, err)
	}
	if status := gitCmd(t, wt, "status", "--porcelain"); strings.TrimSpace(status) != "" {
		t.Fatalf("dirty tree must be recreated clean, status = %q", status)
	}
	patch, err := os.ReadFile(filepath.Join(dir, ".waveterm", "recovery", key+".patch"))
	if err != nil {
		t.Fatalf("recovery patch missing: %v", err)
	}
	if !strings.Contains(string(patch), "uncommitted.txt") {
		t.Fatalf("patch must capture uncommitted work, got:\n%s", patch)
	}
}

// testRootOwner is the test whose own worktree root is installed.
var testRootOwner *testing.T

// useTestWorktreeRoot gives the test a worktree root of its own, once, so a second repo in the test resolves its
// trees beside the first's. Fixture keys like run-1 would otherwise collide under one shared root and outlive the
// test.
func useTestWorktreeRoot(t *testing.T) {
	t.Helper()
	if testRootOwner == t {
		return
	}
	prev := testRootOwner
	testRootOwner = t
	restore := UseWorktreeRootForTest(t.TempDir())
	t.Cleanup(func() {
		restore()
		testRootOwner = prev
	})
}

// newGitRepoAt git-inits an existing directory (the channel's project path) with one base commit.
func newGitRepoAt(t *testing.T, dir string) {
	t.Helper()
	useTestWorktreeRoot(t)
	if err := os.CopyFS(dir, os.DirFS(gitRepoTemplate(t))); err != nil {
		t.Fatal(err)
	}
}

func TestEnsureRunWorktreeReturnsTheCommitATaskStartsAt(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	key := TaskWorktreeKey("owner-1", "t-1")
	wt, head, created, err := EnsureRunWorktree(context.Background(), dir, key, base)
	if err != nil || !created || head != base {
		t.Fatalf("a new tree starts at the base: head %s created %v err %v", head, created, err)
	}
	os.WriteFile(filepath.Join(wt, "schema.txt"), []byte("schema\n"), 0o644)
	gitCmd(t, wt, "add", ".")
	gitCmd(t, wt, "commit", "-m", "schema")
	committed := gitCmd(t, wt, "rev-parse", "HEAD")

	got, head, created, err := EnsureRunWorktree(context.Background(), dir, key, base)
	if err != nil || created || got != wt || head != committed {
		t.Fatalf("the next task in the lane starts at the last commit: head %s created %v err %v", head, created, err)
	}
}

func TestEnsureRunWorktreeRebuildsADirtyTreeFromItsBranch(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	key := TaskWorktreeKey("owner-1", "t-1")
	wt, err := CreateRunWorktree(context.Background(), dir, key, base)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(wt, "schema.txt"), []byte("schema\n"), 0o644)
	gitCmd(t, wt, "add", ".")
	gitCmd(t, wt, "commit", "-m", "schema")
	committed := gitCmd(t, wt, "rev-parse", "HEAD")
	os.WriteFile(filepath.Join(wt, "leftover.txt"), []byte("wip\n"), 0o644)

	_, head, created, err := EnsureRunWorktree(context.Background(), dir, key, base)
	if err != nil || !created || head != committed {
		t.Fatalf("a dirty tree is checked out again at its branch: head %s created %v err %v", head, created, err)
	}
	if _, err := os.Stat(filepath.Join(wt, "schema.txt")); err != nil {
		t.Fatalf("the lane's committed work must survive the rebuild: %v", err)
	}
	if _, err := os.Stat(filepath.Join(wt, "leftover.txt")); !os.IsNotExist(err) {
		t.Fatalf("uncommitted state must not survive the rebuild, stat err = %v", err)
	}
	patch, err := os.ReadFile(filepath.Join(dir, ".waveterm", "recovery", key+".patch"))
	if err != nil || !strings.Contains(string(patch), "leftover.txt") {
		t.Fatalf("the uncommitted state goes to a recovery patch, got %q err %v", patch, err)
	}
}

func TestEnsureRunWorktreeChecksOutAMissingTreeFromItsBranch(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	key := TaskWorktreeKey("owner-1", "t-1")
	wt, err := CreateRunWorktree(context.Background(), dir, key, base)
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(wt, "schema.txt"), []byte("schema\n"), 0o644)
	gitCmd(t, wt, "add", ".")
	gitCmd(t, wt, "commit", "-m", "schema")
	if err := os.RemoveAll(wt); err != nil {
		t.Fatal(err)
	}

	if _, _, created, err := EnsureRunWorktree(context.Background(), dir, key, base); err != nil || !created {
		t.Fatalf("a registered tree whose directory is gone is checked out again: created %v err %v", created, err)
	}
	if _, err := os.Stat(filepath.Join(wt, "schema.txt")); err != nil {
		t.Fatalf("the branch's work must be in the new tree: %v", err)
	}
}

// git run inside a directory that is no longer a worktree acts on the project checkout above it, so a
// recovery dump there would stage the project's own changes
func TestEnsureRunWorktreeLeavesTheProjectIndexAloneForAStrayDirectory(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	key := TaskWorktreeKey("owner-1", "t-1")
	wt, err := CreateRunWorktree(context.Background(), dir, key, base)
	if err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "worktree", "remove", "--force", wt)
	if err := os.MkdirAll(wt, 0o755); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(wt, "stray.txt"), []byte("stray\n"), 0o644)

	_, _, _, _ = EnsureRunWorktree(context.Background(), dir, key, base)
	if staged := gitCmd(t, dir, "diff", "--cached", "--name-only"); staged != "" {
		t.Fatalf("nothing may be staged in the project checkout, got %q", staged)
	}
}

// a `git worktree add -b` cut off at its deadline leaves the branch and a part-written directory; the retry's add
// must not trip on either
func TestEnsureRunWorktreeRebuildsWhatAnInterruptedAddLeft(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	key := TaskWorktreeKey("owner-1", "t-1")
	wt := worktreeDir(dir, key)
	strayDir := func() {
		if err := os.MkdirAll(filepath.Join(wt, "half"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	cases := []struct {
		name  string
		leave func()
	}{
		{"the branch and an unregistered directory", func() {
			gitCmd(t, dir, "branch", "wave/"+key, base)
			strayDir()
		}},
		{"a directory and no branch", strayDir},
		{"a registered tree with none of its files", func() {
			gitCmd(t, dir, "worktree", "add", "--no-checkout", "-b", "wave/"+key, wt, base)
		}},
	}
	for _, tc := range cases {
		tc.leave()
		got, head, created, err := EnsureRunWorktree(context.Background(), dir, key, base)
		if err != nil || !created || got != wt || head != base {
			t.Fatalf("%s: want a new tree at %s, got %q head=%q created=%v err=%v", tc.name, base, got, head, created, err)
		}
		if !worktreeOnBranch(context.Background(), wt, key) || gitCmd(t, wt, "status", "--porcelain") != "" {
			t.Fatalf("%s: the rebuilt tree is not a clean checkout of its branch", tc.name)
		}
		if err := RemoveRunWorktree(context.Background(), dir, key); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRemoveWorktreeDirKeepsTheBranch(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, err := CreateRunWorktree(context.Background(), dir, "run-1", base)
	if err != nil {
		t.Fatal(err)
	}
	if err := removeWorktreeDir(context.Background(), dir, wt); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(wt); !os.IsNotExist(err) {
		t.Fatalf("the directory must go, stat err = %v", err)
	}
	if got := gitCmd(t, dir, "rev-parse", "wave/run-1"); got != base {
		t.Fatalf("the branch must stay, got %q", got)
	}
}

// git deletes a tree under repoAdminMu, so a lane's npm-installed node_modules (10+ minutes on Windows) held every
// run's worktree add, list and prune behind it. The tree's contents go before the lock is taken.
func TestRemoveWorktreeDirDeletesTheTreesContentsOutsideTheRepoLock(t *testing.T) {
	dir := newGitRepo(t)
	wt, err := CreateRunWorktree(context.Background(), dir, "run-1", gitCmd(t, dir, "rev-parse", "HEAD"))
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(wt, "node_modules", "pkg", "index.js"), "x\n")
	var deleted []string
	lockedDuring := false
	orig := removeTreeEntry
	removeTreeEntry = func(path string) error {
		deleted = append(deleted, filepath.Base(path))
		if repoAdminMu.TryLock() {
			repoAdminMu.Unlock()
		} else {
			lockedDuring = true
		}
		return orig(path)
	}
	t.Cleanup(func() { removeTreeEntry = orig })

	if err := removeWorktreeDir(context.Background(), dir, wt); err != nil {
		t.Fatal(err)
	}
	if lockedDuring {
		t.Fatal("the tree's contents were deleted while the repo lock was held")
	}
	if !slices.Contains(deleted, "node_modules") || slices.Contains(deleted, ".git") {
		t.Fatalf("want node_modules deleted before git and the .git file left to it, deleted %v", deleted)
	}
	if _, err := os.Stat(wt); !os.IsNotExist(err) || isWorktreeRegistered(context.Background(), dir, wt) {
		t.Fatalf("the tree must be gone and unregistered, stat err = %v", err)
	}
}

// A directory with a .git directory is a repo, not a linked tree, and is never emptied.
func TestClearTreeUnlockedLeavesARepoAlone(t *testing.T) {
	dir := newGitRepo(t)
	clearTreeUnlocked(context.Background(), dir)
	if _, err := os.Stat(filepath.Join(dir, "base.txt")); err != nil {
		t.Fatalf("a repo's files must stay, stat err = %v", err)
	}
}

// Git drops a worktree's registration before it deletes the tree, so a removal that fails part-way
// leaves an unregistered directory on disk. Cleanup used to read unregistered as removed and report
// task-cleanup-completed over a worktree that was still there.
// git prints a worktree's path with forward slashes on Windows, where the engine's paths use backslashes
func TestIsWorktreeRegisteredFindsARegisteredTree(t *testing.T) {
	dir := newGitRepo(t)
	wt, err := CreateRunWorktree(context.Background(), dir, "run-1", gitCmd(t, dir, "rev-parse", "HEAD"))
	if err != nil {
		t.Fatal(err)
	}
	if !isWorktreeRegistered(context.Background(), dir, wt) {
		t.Fatalf("%s is registered", wt)
	}
	if isWorktreeRegistered(context.Background(), dir, wt+"-other") {
		t.Fatalf("%s-other is not registered", wt)
	}
	gitCmd(t, dir, "worktree", "remove", "--force", wt)
	if isWorktreeRegistered(context.Background(), dir, wt) {
		t.Fatalf("%s was removed", wt)
	}
}

// A landed run's lead still has its landing tree open when the land removes it, so the directory's delete fails
// after git has already unregistered the tree. The branch is free by then and must go with it: runs 2993e463,
// 33880f82, 5952d714 and 9ef34e06 each left their wave/ branch behind this way.
func TestRemoveRunWorktreeDeletesTheBranchOfAHeldDir(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("only Windows refuses to delete a directory holding an open file")
	}
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, err := CreateRunWorktree(context.Background(), dir, "run-1", base)
	if err != nil {
		t.Fatal(err)
	}
	held, err := os.Open(filepath.Join(wt, "base.txt"))
	if err != nil {
		t.Fatal(err)
	}
	defer held.Close()

	if err := RemoveRunWorktree(context.Background(), dir, "run-1"); err == nil {
		t.Fatal("removing a held worktree dir must report the directory it could not delete")
	}
	if out := gitCmd(t, dir, "branch", "--list", "wave/run-1"); out != "" {
		t.Fatalf("the unregistered tree's branch must be deleted, still have %q", out)
	}
}

func TestRemoveRunWorktreeDeletesAnUnregisteredDir(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, err := CreateRunWorktree(context.Background(), dir, "run-1", base)
	if err != nil {
		t.Fatal(err)
	}
	// drop the registration without touching the tree: the state git leaves behind when its delete fails
	if err := os.RemoveAll(filepath.Join(dir, ".git", "worktrees")); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, dir, "worktree", "prune")

	if err := RemoveRunWorktree(context.Background(), dir, "run-1"); err != nil {
		t.Fatalf("removing an unregistered worktree dir: %v", err)
	}
	if _, err := os.Stat(wt); !os.IsNotExist(err) {
		t.Fatalf("unregistered worktree dir must be deleted, stat err = %v", err)
	}
}

// git does not lock its worktree registry: an add reads every registered tree's admin dir, and fails when a
// concurrent remove has half-deleted one ("failed to read .git/worktrees/<name>/commondir"). A lane's cleanup racing
// a bisect tree's creation stopped a bisect this way and blamed the wrong lane.
func TestConcurrentWorktreeAddAndRemoveDoNotFail(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	ctx := context.Background()
	const rounds = 15
	errs := make(chan error, 2*rounds)
	var wg sync.WaitGroup
	for _, key := range []string{"lane", "other"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < rounds; i++ {
				if _, err := CreateRunWorktree(ctx, dir, key, base); err != nil {
					errs <- err
					return
				}
				if err := RemoveRunWorktree(ctx, dir, key); err != nil {
					errs <- err
					return
				}
			}
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < rounds; i++ {
			if err := withDetachedTree(ctx, dir, "bisect", "bisect tree", base, "", func(string) error { return nil }); err != nil {
				errs <- err
				return
			}
		}
	}()
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

func TestRemoveWorktreeKeepBranchKeepsTheBranch(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, err := CreateRunWorktree(context.Background(), dir, "run-1", base)
	if err != nil {
		t.Fatal(err)
	}
	if err := RemoveWorktreeKeepBranch(context.Background(), dir, wt); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(wt); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("the tree must be gone, stat says %v", err)
	}
	if out := gitCmd(t, dir, "branch", "--list", "wave/run-1"); out == "" {
		t.Fatal("the branch must stay: Storage never deletes a run's commits")
	}
}

func TestRunOfWorktreeNamesTheOwnerRun(t *testing.T) {
	id := "11111111-2222-3333-4444-555555555555"
	for _, key := range []string{id, id + "-t-2", id + "-final", id + "-bisect"} {
		got, ok := RunOfWorktree(filepath.Join("/p", ".waveterm", "worktrees", key))
		if !ok || got != id {
			t.Fatalf("RunOfWorktree(%s) = %q, %v; want %s", key, got, ok, id)
		}
	}
	if _, ok := RunOfWorktree(filepath.Join("/p", ".waveterm", "worktrees", "scratch")); ok {
		t.Fatal("a name the engine never makes has no run")
	}
}

// a project that is a folder of a monorepo checks out only its folder (plus the files above it), and a lane's
// change outside that folder still merges into the sparse landing tree
func TestCreateRunWorktreeOfAFolderProjectIsSparse(t *testing.T) {
	repo := newGitRepo(t)
	project := filepath.Join(repo, "apps", "portal")
	writeFile(t, filepath.Join(project, "app.txt"), "app\n")
	writeFile(t, filepath.Join(repo, "apps", "beside.txt"), "beside\n")
	writeFile(t, filepath.Join(repo, "other", "far.txt"), "far\n")
	gitCmd(t, repo, "add", ".")
	gitCmd(t, repo, "commit", "-m", "monorepo")
	ctx := context.Background()

	tree, err := CreateRunWorktree(ctx, project, "run-1", gitCmd(t, repo, "rev-parse", "HEAD"))
	if err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"base.txt", filepath.Join("apps", "beside.txt"), filepath.Join("apps", "portal", "app.txt")} {
		if _, err := os.Stat(filepath.Join(tree, rel)); err != nil {
			t.Fatalf("%s is in the project's cone but not in the tree: %v", rel, err)
		}
	}
	if _, err := os.Stat(filepath.Join(tree, "other")); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("a folder outside the project is checked out: %v", err)
	}
	if st := gitCmd(t, tree, "status", "--porcelain"); st != "" {
		t.Fatalf("a fresh sparse tree is clean, got:\n%s", st)
	}
	if out, err := exec.Command("git", "-C", repo, "sparse-checkout", "list").CombinedOutput(); err == nil {
		t.Fatalf("the checkout itself stays whole, but it lists a cone:\n%s", out)
	}

	gitCmd(t, repo, "checkout", "-q", "-b", "lane")
	writeFile(t, filepath.Join(repo, "other", "far.txt"), "far, changed\n")
	writeFile(t, filepath.Join(project, "app.txt"), "app, changed\n")
	gitCmd(t, repo, "commit", "-qam", "lane")
	gitCmd(t, repo, "checkout", "-q", "main")
	gitCmd(t, tree, "merge", "-q", "--no-ff", "-m", "land", "lane")
	if got := gitCmd(t, tree, "show", "HEAD:other/far.txt"); got != "far, changed" {
		t.Fatalf("the merge carries the change outside the cone, got %q", got)
	}
}

// a project at its repo's root keeps a whole tree
func TestCreateRunWorktreeOfARootProjectIsWhole(t *testing.T) {
	repo := newGitRepo(t)
	writeFile(t, filepath.Join(repo, "other", "far.txt"), "far\n")
	gitCmd(t, repo, "add", ".")
	gitCmd(t, repo, "commit", "-m", "more")
	tree, err := CreateRunWorktree(context.Background(), repo, "run-1", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(tree, "other", "far.txt")); err != nil {
		t.Fatalf("a root project's tree holds every folder: %v", err)
	}
}

// failGit fails every git call in dir whose arguments include arg, as a git unable to read the repository would
// (exit 128), until the test ends.
func failGit(t *testing.T, dir, arg string) {
	t.Helper()
	gitFault = func(d string, args []string) error {
		if d == dir && slices.Contains(args, arg) {
			return errors.New("exit status 128: injected failure")
		}
		return nil
	}
	t.Cleanup(func() { gitFault = nil })
}

// the fault hook fails the calls a test names and no others
func TestGitFaultFailsOnlyTheNamedCalls(t *testing.T) {
	dir := newGitRepo(t)
	failGit(t, dir, "show-ref")
	if _, err := git(context.Background(), dir, "show-ref", "--head"); err == nil {
		t.Fatal("a call that names the argument must fail")
	}
	if _, err := git(context.Background(), dir, "rev-parse", "HEAD"); err != nil {
		t.Fatalf("any other call runs: %v", err)
	}
	if yes, err := gitAsk(context.Background(), dir, "show-ref", "--head"); err == nil || yes {
		t.Fatalf("an injected failure is an error, never a no: yes=%v err=%v", yes, err)
	}
}
