package orchestrate

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
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
	gitCmd(t, dir, "init", "-b", "main")
	gitCmd(t, dir, "config", "user.email", "t@test")
	gitCmd(t, dir, "config", "user.name", "t")
	os.WriteFile(filepath.Join(dir, "base.txt"), []byte("base\n"), 0o644)
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "base")
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

// A run tree nests the checkout under .waveterm\worktrees\<run id>\, so a file the project checks out fits under
// MAX_PATH there and not in the tree: run 58942051 failed its landing tree with "unable to create file".
func TestCreateRunWorktreeChecksOutPathsPastMaxPath(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("only Windows caps a path at MAX_PATH")
	}
	empty := filepath.Join(t.TempDir(), "gitconfig")
	os.WriteFile(empty, nil, 0o644)
	t.Setenv("GIT_CONFIG_GLOBAL", empty)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	dir := newGitRepo(t)
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

// newGitRepoAt git-inits an existing directory (the channel's project path) with one base commit.
func newGitRepoAt(t *testing.T, dir string) {
	t.Helper()
	gitCmd(t, dir, "init", "-b", "main")
	gitCmd(t, dir, "config", "user.email", "t@test")
	gitCmd(t, dir, "config", "user.name", "t")
	os.WriteFile(filepath.Join(dir, "base.txt"), []byte("base\n"), 0o644)
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "base")
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
