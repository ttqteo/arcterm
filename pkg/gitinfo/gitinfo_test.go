// pkg/gitinfo/gitinfo_test.go
package gitinfo

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func git(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func repoWithChange(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	git(t, dir, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\ntwo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "init")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\ntwo\nthree\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "b.txt"), []byte("new\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// A bare remote the repo pushes to, so @{u} resolves.
func repoWithUpstream(t *testing.T) (dir, bare string) {
	t.Helper()
	dir = repoWithChange(t)
	bare = t.TempDir()
	git(t, bare, "init", "-q", "--bare", "-b", "main")
	git(t, dir, "remote", "add", "origin", bare)
	git(t, dir, "push", "-q", "-u", "origin", "main")
	return dir, bare
}

func TestGetChangesUpstreamCounts(t *testing.T) {
	dir, _ := repoWithUpstream(t)
	git(t, dir, "commit", "-q", "--allow-empty", "-m", "local only")
	ch, err := GetChanges(context.Background(), dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if ch.Upstream != "origin/main" || ch.UpstreamAhead != 1 || ch.UpstreamBehind != 0 {
		t.Fatalf("upstream = %q +%d -%d, want origin/main +1 -0", ch.Upstream, ch.UpstreamAhead, ch.UpstreamBehind)
	}
}

func TestGetChangesNoUpstream(t *testing.T) {
	ch, err := GetChanges(context.Background(), repoWithChange(t), "")
	if err != nil {
		t.Fatal(err)
	}
	if ch.Upstream != "" || ch.UpstreamAhead != 0 || ch.UpstreamBehind != 0 {
		t.Fatalf("want no upstream, got %q +%d -%d", ch.Upstream, ch.UpstreamAhead, ch.UpstreamBehind)
	}
}

func TestHeadCommit(t *testing.T) {
	dir := repoWithChange(t) // has one commit ("init") + uncommitted edits
	sha, err := HeadCommit(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(strings.TrimSpace(sha)) != 40 {
		t.Fatalf("HeadCommit = %q, want a 40-char sha", sha)
	}
	// not a repo -> error, empty
	if _, err := HeadCommit(context.Background(), t.TempDir()); err == nil {
		t.Fatal("expected error for a non-repo dir")
	}
}

// commitAt writes file=content, stages, and commits with a fixed committer date (rev-list --before
// filters on committer date). Returns the new commit sha.
func commitAt(t *testing.T, dir, file, content string, unixSec int64) string {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, file), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	date := time.Unix(unixSec, 0).UTC().Format(time.RFC3339)
	env := append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_AUTHOR_DATE="+date,
		"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t", "GIT_COMMITTER_DATE="+date)
	for _, args := range [][]string{{"add", "."}, {"commit", "-m", "c"}} {
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
	return sha
}

func TestCommitBefore(t *testing.T) {
	dir := t.TempDir()
	git(t, dir, "init", "-b", "main")
	_ = commitAt(t, dir, "a.txt", "1\n", 1000)
	c2 := commitAt(t, dir, "a.txt", "1\n2\n", 2000)
	c3 := commitAt(t, dir, "a.txt", "1\n2\n3\n", 3000)

	if got, _ := CommitBefore(context.Background(), dir, 500); got != "" {
		t.Fatalf("before-all = %q, want empty", got)
	}
	if got, _ := CommitBefore(context.Background(), dir, 2500); got != c2 {
		t.Fatalf("mid = %q, want c2 %q", got, c2)
	}
	if got, _ := CommitBefore(context.Background(), dir, 4000); got != c3 {
		t.Fatalf("after-all = %q, want c3 (HEAD) %q", got, c3)
	}
	if got, err := CommitBefore(context.Background(), t.TempDir(), 4000); err != nil || got != "" {
		t.Fatalf("non-repo = %q, err %v; want empty,nil", got, err)
	}
}

func TestGetChanges(t *testing.T) {
	dir := repoWithChange(t)
	ch, err := GetChanges(context.Background(), dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if !ch.IsRepo {
		t.Fatal("expected IsRepo true")
	}
	if ch.Branch != "main" {
		t.Fatalf("branch = %q, want main", ch.Branch)
	}
	if !strings.Contains(ch.StatusZ, "a.txt") || !strings.Contains(ch.StatusZ, "b.txt") {
		t.Fatalf("statusz missing files: %q", ch.StatusZ)
	}
	if !strings.Contains(ch.Numstat, "a.txt") {
		t.Fatalf("numstat missing tracked change: %q", ch.Numstat)
	}
	// b.txt is untracked with one line ("new\n") — its added line must be counted in numstat
	if !strings.Contains(ch.Numstat, "1\t0\tb.txt") {
		t.Fatalf("untracked b.txt not counted in numstat: %q", ch.Numstat)
	}
}

// A non-ASCII name must come out of numstat spelled the way `status -z` spells it, or the frontend
// joins no row to it and the file reads as uncounted.
func TestGetChangesNumstatKeepsNonASCIIPath(t *testing.T) {
	dir := repoWithChange(t)
	if err := os.WriteFile(filepath.Join(dir, "tên.txt"), []byte("1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, dir, "add", "tên.txt")
	git(t, dir, "commit", "-m", "vi")
	if err := os.WriteFile(filepath.Join(dir, "tên.txt"), []byte("1\n2\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	ch, err := GetChanges(context.Background(), dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(ch.Numstat, "1\t0\ttên.txt\n") {
		t.Fatalf("numstat lost the raw non-ASCII path: %q", ch.Numstat)
	}
}

// The Diff surface polls the change list while it is on screen, and that poll is the only thing
// reading the repository on a timer. HEAD rides along with it so a commit landing under the open
// surface is noticed without a second RPC and without re-reading the log every tick.
func TestGetChangesReportsHead(t *testing.T) {
	ctx := context.Background()
	dir := repoWithChange(t)
	ch, err := GetChanges(ctx, dir, "")
	if err != nil {
		t.Fatal(err)
	}
	want, err := HeadCommit(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	if ch.Head != want {
		t.Fatalf("Head = %q, want %q", ch.Head, want)
	}
	// the case the poll exists for: committing must move the value the surface compares against
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "second")
	after, err := GetChanges(ctx, dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if after.Head == ch.Head {
		t.Fatalf("Head did not move after a commit: still %q", after.Head)
	}
}

// Ref mode returns through a different branch of GetChanges, and an agent-scoped surface polls in
// exactly that mode — so the field has to be populated on both paths or the poll silently stops
// working for every scope but "live".
func TestGetChangesReportsHeadInRefMode(t *testing.T) {
	ctx := context.Background()
	dir, base := repoCommittedOnBase(t)
	ch, err := GetChanges(ctx, dir, base)
	if err != nil {
		t.Fatal(err)
	}
	want, err := HeadCommit(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	if ch.Head != want {
		t.Fatalf("Head = %q, want %q", ch.Head, want)
	}
	if ch.Head == base {
		t.Fatalf("Head = base %q, but two commits were made on top of it", base)
	}
}

// A repository with no commits yet: `rev-parse HEAD` fails there, and that must not fail the read.
// The change list is still the whole point — every file in it is untracked.
func TestGetChangesEmptyRepoHasNoHead(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "a.txt", "one\n")
	ch, err := GetChanges(context.Background(), dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if !ch.IsRepo {
		t.Fatal("expected IsRepo true")
	}
	if ch.Head != "" {
		t.Fatalf("Head = %q, want empty for a repo with no commits", ch.Head)
	}
	if !strings.Contains(ch.StatusZ, "a.txt") {
		t.Fatalf("statusz missing the untracked file: %q", ch.StatusZ)
	}
}

// repoCommittedOnBase makes a repo with an initial commit, records that SHA as the base, then commits
// a modification and a new file on top. Returns (dir, baseSHA). No uncommitted changes remain.
func repoCommittedOnBase(t *testing.T) (string, string) {
	t.Helper()
	dir := t.TempDir()
	git(t, dir, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\ntwo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "init")
	base, err := HeadCommit(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\ntwo\nthree\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "c.txt"), []byte("added\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "work")
	return dir, base
}

func TestGetChangesRefIncludesCommitted(t *testing.T) {
	dir, base := repoCommittedOnBase(t)
	// HEAD-mode sees nothing (work is committed) — this is the bug we are fixing.
	head, err := GetChanges(context.Background(), dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(head.Numstat, "a.txt") {
		t.Fatalf("HEAD-mode unexpectedly shows committed change: %q", head.Numstat)
	}
	// ref-mode against the base sees the committed modification (a.txt) and the added file (c.txt).
	ch, err := GetChanges(context.Background(), dir, base)
	if err != nil {
		t.Fatal(err)
	}
	if !ch.IsRepo {
		t.Fatal("expected IsRepo true")
	}
	if !strings.Contains(ch.StatusZ, "a.txt") || !strings.Contains(ch.StatusZ, "c.txt") {
		t.Fatalf("ref statusz missing committed files: %q", ch.StatusZ)
	}
	if !strings.Contains(ch.Numstat, "1\t0\ta.txt") {
		t.Fatalf("ref numstat missing a.txt +1: %q", ch.Numstat)
	}
}

// TestGetRangeChangesExcludesSiblings is the core guard for the fan-out over-attribution fix: a
// commit-range diff (base..tipA) must show only tipA's own commits, never a sibling that merely shares
// the working tree (branch b). It also proves the untracked/working-tree noise never leaks in.
func TestGetRangeChangesExcludesSiblings(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "base.txt", "base\n")
	commitAll(t, dir)
	base, err := HeadCommit(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	// branch A off base: commits a.txt (this run's own work)
	git(t, dir, "checkout", "-b", "a")
	writeFile(t, dir, "a.txt", "a1\na2\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-m", "a")
	tipA, err := HeadCommit(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	// branch B off base: commits b.txt (a sibling that shares the tree but not A's lineage), then leaves
	// an uncommitted working-tree edit (must also be excluded from a pure commit-range diff)
	git(t, dir, "checkout", base)
	git(t, dir, "checkout", "-b", "b")
	writeFile(t, dir, "b.txt", "b1\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-m", "b")
	writeFile(t, dir, "dirty.txt", "d\n")

	ch, err := GetRangeChanges(context.Background(), dir, base, tipA)
	if err != nil {
		t.Fatalf("GetRangeChanges: %v", err)
	}
	if !ch.IsRepo {
		t.Fatal("expected IsRepo=true")
	}
	if !strings.Contains(ch.StatusZ, "a.txt") {
		t.Errorf("expected a.txt in range, got %q", ch.StatusZ)
	}
	if strings.Contains(ch.StatusZ, "b.txt") || strings.Contains(ch.StatusZ, "dirty.txt") {
		t.Errorf("sibling/working-tree noise leaked into range diff: %q", ch.StatusZ)
	}
	if !strings.Contains(ch.Numstat, "a.txt") || strings.Contains(ch.Numstat, "b.txt") {
		t.Errorf("numstat wrong: %q", ch.Numstat)
	}
	// not a repo -> IsRepo false, no error
	nc, err := GetRangeChanges(context.Background(), t.TempDir(), base, tipA)
	if err != nil {
		t.Fatalf("non-repo should not error: %v", err)
	}
	if nc.IsRepo {
		t.Fatal("expected IsRepo=false outside a repo")
	}
}

func TestGetTrailerCommitsChangesSumsOnlyMatchingCommits(t *testing.T) {
	ctx := context.Background()
	dir := initRepo(t)
	writeFile(t, dir, "base.txt", "base\n")
	writeFile(t, dir, "old.txt", "keep\n")
	commitAll(t, dir)
	base, err := HeadCommit(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	commit := func(msg string) {
		t.Helper()
		git(t, dir, "add", "-A")
		git(t, dir, "commit", "-m", msg)
	}
	writeFile(t, dir, "mine.txt", "a\nb\n")
	commit("lane\n\nArc-Run: R-t-1")
	writeFile(t, dir, "other.txt", "o\n")
	writeFile(t, dir, "mine.txt", "a\nb\nc\n")
	commit("someone else")
	writeFile(t, dir, "mine.txt", "a\nc\n")
	git(t, dir, "rm", "-q", "old.txt")
	commit("lead fix\n\nArc-Run: R")
	writeFile(t, dir, "prefix.txt", "p\n")
	commit("another run\n\nArc-Run: R2-t-1")
	end, err := HeadCommit(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}

	match := func(v string) bool { return v == "R" || strings.HasPrefix(v, "R-") }
	ch, err := GetTrailerCommitsChanges(ctx, dir, base, end, "Arc-Run", match)
	if err != nil {
		t.Fatalf("GetTrailerCommitsChanges: %v", err)
	}
	if !ch.IsRepo {
		t.Fatal("expected IsRepo=true")
	}
	// mine.txt: +2 in the lane, then +0/-1 in the lead's fix (the unmatched commit's +1 is not counted)
	if !strings.Contains(ch.Numstat, "2\t1\tmine.txt\n") {
		t.Errorf("mine.txt should sum its matching commits to +2/-1, got %q", ch.Numstat)
	}
	if !strings.Contains(ch.Numstat, "0\t1\told.txt\n") {
		t.Errorf("old.txt deletion missing, got %q", ch.Numstat)
	}
	for _, leaked := range []string{"other.txt", "prefix.txt"} {
		if strings.Contains(ch.Numstat, leaked) || strings.Contains(ch.StatusZ, leaked) {
			t.Errorf("%s belongs to another commit's author, leaked: %q / %q", leaked, ch.Numstat, ch.StatusZ)
		}
	}
	// the last matching commit's status wins: mine.txt was added, then modified
	if !strings.Contains(ch.StatusZ, "M  mine.txt\x00") || !strings.Contains(ch.StatusZ, "D  old.txt\x00") {
		t.Errorf("statusZ = %q", ch.StatusZ)
	}

	nc, err := GetTrailerCommitsChanges(ctx, t.TempDir(), base, end, "Arc-Run", match)
	if err != nil || nc.IsRepo {
		t.Fatalf("non-repo: IsRepo=%v err=%v", nc != nil && nc.IsRepo, err)
	}
}

func TestUntrackedAdds(t *testing.T) {
	dir := t.TempDir()
	write := func(name, content string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	cases := []struct{ name, content, want string }{
		{"three.txt", "a\nb\nc\n", "3"},
		{"notrail.txt", "a\nb", "2"}, // final line without a trailing newline still counts
		{"empty.txt", "", "0"},
		{"binary.bin", "a\x00b\n", "-"},
	}
	for _, c := range cases {
		if got := untrackedAdds(write(c.name, c.content)); got != c.want {
			t.Fatalf("%s: adds = %q, want %q", c.name, got, c.want)
		}
	}
	if got := untrackedAdds(filepath.Join(dir, "missing")); got != "-" {
		t.Fatalf("missing file: adds = %q, want -", got)
	}
}

func TestGetChangesExpandsUntrackedDir(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "base.txt", "base\n")
	commitAll(t, dir)
	// a brand-new directory with files: default porcelain collapses this to a single "newdir/" entry,
	// which the Files surface can't diff (a directory has no content to read). -uall must expand it.
	if err := os.MkdirAll(filepath.Join(dir, "newdir"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "newdir", "a.txt"), []byte("aa\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "newdir", "b.txt"), []byte("bb\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	ch, err := GetChanges(context.Background(), dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(ch.StatusZ, "newdir/a.txt") || !strings.Contains(ch.StatusZ, "newdir/b.txt") {
		t.Fatalf("statusz should list untracked files individually: %q", ch.StatusZ)
	}
	// the collapsed "newdir/" entry must be gone — it names a directory, not a file
	for _, e := range strings.Split(ch.StatusZ, "\x00") {
		if len(e) >= 3 && e[3:] == "newdir/" {
			t.Fatalf("statusz still has the collapsed directory entry: %q", ch.StatusZ)
		}
	}
}

func TestGetChangesNotARepo(t *testing.T) {
	ch, err := GetChanges(context.Background(), t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	if ch.IsRepo {
		t.Fatal("expected IsRepo false outside a repo")
	}
}

// subdirRepoWithChange builds a monorepo whose changes live under services/foo/ (plus one root
// file), returning the repo root. Models a "microservice" agent whose cwd is a subdirectory of the
// git root — the case where paths from `status` (repo-root-relative) diverge from `git -C <cwd>`
// pathspecs (cwd-relative).
func subdirRepoWithChange(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	git(t, dir, "init", "-b", "main")
	git(t, dir, "config", "core.autocrlf", "false")
	sub := filepath.Join(dir, "services", "foo")
	if err := os.MkdirAll(filepath.Join(sub, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, dir, "README.md", "root\n")
	if err := os.WriteFile(filepath.Join(sub, "app.js"), []byte("one\ntwo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "nested", "deep.js"), []byte("d\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "init")
	// changes: modify a tracked file in the subtree, add an untracked file in the subtree, and touch
	// a file OUTSIDE the subtree (must be excluded from the microservice-scoped view).
	if err := os.WriteFile(filepath.Join(sub, "app.js"), []byte("one\ntwo\nthree\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "new.js"), []byte("new\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	writeFile(t, dir, "README.md", "root\nchanged\n")
	return dir
}

func TestGetChangesSubdir(t *testing.T) {
	root := subdirRepoWithChange(t)
	cwd := filepath.Join(root, "services", "foo")
	ch, err := GetChanges(context.Background(), cwd, "")
	if err != nil {
		t.Fatal(err)
	}
	if !ch.IsRepo {
		t.Fatal("expected IsRepo true from a subdir")
	}
	// paths are relative to cwd (the microservice), not the repo root
	if !strings.Contains(ch.StatusZ, "app.js") || strings.Contains(ch.StatusZ, "services/foo/app.js") {
		t.Fatalf("statusz should be cwd-relative: %q", ch.StatusZ)
	}
	// scoped to the subtree: the out-of-subtree README.md change must not appear
	if strings.Contains(ch.StatusZ, "README.md") {
		t.Fatalf("statusz leaked out-of-subtree file: %q", ch.StatusZ)
	}
	// numstat correlates with cwd-relative status paths, and the untracked new.js is counted
	if !strings.Contains(ch.Numstat, "app.js") {
		t.Fatalf("numstat missing tracked change (cwd-relative): %q", ch.Numstat)
	}
	if !strings.Contains(ch.Numstat, "1\t0\tnew.js") {
		t.Fatalf("untracked new.js not counted in numstat: %q", ch.Numstat)
	}
}

func TestWorktreePath(t *testing.T) {
	got := WorktreePath("/home/u/code/payments-api", "feat/new-agent")
	want := filepath.ToSlash(filepath.Join("/home/u/code", "payments-api-worktrees", "feat-new-agent"))
	if filepath.ToSlash(got) != want {
		t.Fatalf("WorktreePath = %q, want %q", filepath.ToSlash(got), want)
	}
}

func TestCreateWorktreeNewBranch(t *testing.T) {
	dir := repoWithChange(t)
	wt, err := CreateWorktree(context.Background(), dir, "feat/new-agent")
	if err != nil {
		t.Fatalf("CreateWorktree: %v", err)
	}
	if _, err := os.Stat(wt); err != nil {
		t.Fatalf("worktree dir not created: %v", err)
	}
	if !strings.HasSuffix(filepath.ToSlash(wt), "-worktrees/feat-new-agent") {
		t.Fatalf("unexpected worktree path: %s", wt)
	}
	// idempotent: a second call reuses the existing worktree dir
	wt2, err := CreateWorktree(context.Background(), dir, "feat/new-agent")
	if err != nil || wt2 != wt {
		t.Fatalf("reuse failed: wt2=%q err=%v", wt2, err)
	}
}

func TestCreateWorktreeNotARepo(t *testing.T) {
	if _, err := CreateWorktree(context.Background(), t.TempDir(), "feat/x"); err == nil {
		t.Fatal("expected error outside a git repo")
	}
}

// git prints worktree paths with forward slashes and resolved, so compare the directories themselves
func sameDir(t *testing.T, a, b string) bool {
	t.Helper()
	ai, err := os.Stat(a)
	if err != nil {
		t.Fatalf("stat %s: %v", a, err)
	}
	bi, err := os.Stat(b)
	if err != nil {
		t.Fatalf("stat %s: %v", b, err)
	}
	return os.SameFile(ai, bi)
}

func TestListWorktreesMainOnly(t *testing.T) {
	dir := repoWithChange(t)
	got, err := ListWorktrees(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || !got[0].IsMain || got[0].Branch != "main" || !sameDir(t, got[0].Path, dir) {
		t.Fatalf("got %+v, want just the main checkout on main", got)
	}
}

func TestListWorktreesLinkedWithBranch(t *testing.T) {
	dir := repoWithChange(t)
	wt, err := CreateWorktree(context.Background(), dir, "feat/x")
	if err != nil {
		t.Fatal(err)
	}
	got, err := ListWorktrees(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %+v, want main and one linked worktree", got)
	}
	if got[1].IsMain || got[1].Branch != "feat/x" || !sameDir(t, got[1].Path, wt) {
		t.Fatalf("linked worktree = %+v, want feat/x at %s", got[1], wt)
	}
}

// the Code surface browses a worktree and still needs to know which repository it belongs to
func TestListWorktreesFromALinkedWorktreeListsMainFirst(t *testing.T) {
	dir := repoWithChange(t)
	wt, err := CreateWorktree(context.Background(), dir, "feat/x")
	if err != nil {
		t.Fatal(err)
	}
	got, err := ListWorktrees(context.Background(), wt)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || !got[0].IsMain || !sameDir(t, got[0].Path, dir) {
		t.Fatalf("got %+v, want the main checkout first", got)
	}
}

func TestListWorktreesDetachedHasNoBranch(t *testing.T) {
	dir := repoWithChange(t)
	detached := filepath.Join(t.TempDir(), "detached")
	git(t, dir, "worktree", "add", "--detach", detached)
	got, err := ListWorktrees(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[1].Branch != "" || !sameDir(t, got[1].Path, detached) {
		t.Fatalf("got %+v, want a detached worktree with no branch", got)
	}
}

// a row for a directory that no longer exists would only lead to an empty tree
func TestListWorktreesSkipsAWorktreeWhoseDirectoryIsGone(t *testing.T) {
	dir := repoWithChange(t)
	wt, err := CreateWorktree(context.Background(), dir, "feat/gone")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(wt); err != nil {
		t.Fatal(err)
	}
	got, err := ListWorktrees(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || !got[0].IsMain {
		t.Fatalf("got %+v, want only the main checkout", got)
	}
}

func TestWorktreeStatuses(t *testing.T) {
	dir := t.TempDir()
	git(t, dir, "init", "-b", "main")
	git(t, dir, "config", "core.autocrlf", "false")
	writeFile(t, dir, "a.txt", "one\n")
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "init")

	// feat: one commit ahead of main, then one tracked edit and one untracked file
	feat := filepath.Join(t.TempDir(), "feat")
	git(t, dir, "worktree", "add", "-b", "feat", feat)
	writeFile(t, feat, "f.txt", "f\n")
	git(t, feat, "add", ".")
	git(t, feat, "commit", "-m", "feat work")
	writeFile(t, feat, "a.txt", "one\ntwo\n")
	writeFile(t, feat, "new.txt", "new\n")

	detached := filepath.Join(t.TempDir(), "detached")
	git(t, dir, "worktree", "add", "--detach", detached)

	// git still lists a checkout whose directory exists, but cannot read one whose gitdir is gone
	broken := filepath.Join(t.TempDir(), "broken")
	git(t, dir, "worktree", "add", "--detach", broken)
	writeFile(t, broken, ".git", "gitdir: "+filepath.Join(t.TempDir(), "missing")+"\n")

	// main moves on by one commit, so feat is one behind
	writeFile(t, dir, "m.txt", "m\n")
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "main work")

	wts, err := ListWorktrees(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(wts) != 4 {
		t.Fatalf("got %+v, want main and three linked worktrees", wts)
	}
	got := WorktreeStatuses(context.Background(), wts)
	if len(got) != 4 {
		t.Fatalf("got %d checkouts, want 4", len(got))
	}
	byPath := func(p string) Worktree {
		t.Helper()
		for _, wt := range got {
			if sameDir(t, wt.Path, p) {
				return wt
			}
		}
		t.Fatalf("no checkout at %s in %+v", p, got)
		return Worktree{}
	}

	m := got[0]
	if !m.IsMain || m.Head == "" || m.Changed != 0 || m.HasBase || m.Error != "" {
		t.Fatalf("main = %+v, want a clean main with a head and no base", m)
	}
	f := byPath(feat)
	if f.Head == "" || f.Changed != 2 || f.Ahead != 1 || f.Behind != 1 || !f.HasBase || f.Error != "" {
		t.Fatalf("feat = %+v, want head, 2 changed, 1 ahead, 1 behind, with a base", f)
	}
	d := byPath(detached)
	if d.Head == "" || d.Changed != 0 || d.Ahead != 0 || d.Behind != 1 || !d.HasBase || d.Error != "" {
		t.Fatalf("detached = %+v, want head, clean, 1 behind, with a base", d)
	}
	b := byPath(broken)
	if b.Error == "" {
		t.Fatalf("broken = %+v, want an Error", b)
	}

	// with main detached there is no branch to measure against
	git(t, dir, "checkout", "-q", "--detach")
	wts, err = ListWorktrees(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, wt := range WorktreeStatuses(context.Background(), wts) {
		if wt.HasBase || wt.Ahead != 0 || wt.Behind != 0 {
			t.Fatalf("%+v: want no base while main is detached", wt)
		}
		if wt.Error == "" && wt.Head == "" {
			t.Fatalf("%+v: want a head", wt)
		}
	}
}

func TestWorktreeStatusesCountsARenameOnce(t *testing.T) {
	dir := t.TempDir()
	git(t, dir, "init", "-b", "main")
	writeFile(t, dir, "a.txt", "one\ntwo\nthree\n")
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "init")
	git(t, dir, "mv", "a.txt", "b.txt")
	wts, err := ListWorktrees(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	got := WorktreeStatuses(context.Background(), wts)
	if len(got) != 1 || got[0].Changed != 1 || got[0].Error != "" {
		t.Fatalf("got %+v, want one changed entry for the rename", got)
	}
}

func TestWorktreeStatusesUnbornHead(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "a.txt", "a\n")
	wts, err := ListWorktrees(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	got := WorktreeStatuses(context.Background(), wts)
	if len(got) != 1 || got[0].Head != "" || got[0].Changed != 1 || got[0].Error != "" {
		t.Fatalf("got %+v, want no head, one untracked file and no error", got)
	}
}

func TestListWorktreesNotARepo(t *testing.T) {
	got, err := ListWorktrees(context.Background(), t.TempDir())
	if err != nil {
		t.Fatalf("expected nil error for non-repo, got %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Fatalf("expected an empty, non-nil slice, got %#v", got)
	}
}

func TestListBranches(t *testing.T) {
	dir := repoWithChange(t)
	branches, err := ListBranches(context.Background(), dir, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(branches) != 1 || branches[0].Name != "main" {
		t.Fatalf("branches = %+v, want [main]", branches)
	}
	if branches[0].Age == "" {
		t.Fatal("expected a non-empty relative age")
	}
}

func TestListBranchesMultiple(t *testing.T) {
	dir := repoWithChange(t)
	git(t, dir, "branch", "feat/x")
	git(t, dir, "branch", "feat/y")
	branches, err := ListBranches(context.Background(), dir, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(branches) != 3 {
		t.Fatalf("want 3 branches, got %d: %+v", len(branches), branches)
	}
	names := map[string]bool{}
	for _, b := range branches {
		names[b.Name] = true
	}
	for _, want := range []string{"main", "feat/x", "feat/y"} {
		if !names[want] {
			t.Fatalf("missing branch %q in %+v", want, branches)
		}
	}
}

func TestListBranchesNotARepo(t *testing.T) {
	branches, err := ListBranches(context.Background(), t.TempDir(), false)
	if err != nil {
		t.Fatalf("expected nil error for non-repo, got %v", err)
	}
	if len(branches) != 0 {
		t.Fatalf("expected no branches, got %+v", branches)
	}
}

// A remote-tracking ref written by hand: enough for ref listing, and hermetic — no network, no
// second repository to clone from.
func repoWithRemote(t *testing.T) string {
	t.Helper()
	dir := repoWithChange(t)
	git(t, dir, "update-ref", "refs/remotes/origin/main", "HEAD")
	git(t, dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
	return dir
}

// The New Agent launcher is the caller that must not see remotes: a worktree cannot be created on a
// remote-tracking ref, so offering one would produce a branch named "origin/main".
func TestListBranchesLocalOnlyByDefault(t *testing.T) {
	dir := repoWithRemote(t)
	got, err := ListBranches(context.Background(), dir, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range got {
		if b.Remote {
			t.Fatalf("got remote branch %q with includeRemotes=false", b.Name)
		}
	}
	if len(got) != 1 || got[0].Name != "main" {
		t.Errorf("got %+v, want just local main", got)
	}
}

func TestListBranchesIncludesRemotesAndSkipsOriginHead(t *testing.T) {
	dir := repoWithRemote(t)
	got, err := ListBranches(context.Background(), dir, true)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	remote := map[string]bool{}
	for _, b := range got {
		names = append(names, b.Name)
		remote[b.Name] = b.Remote
	}
	if len(names) != 2 {
		t.Fatalf("got %v, want local main and origin/main only", names)
	}
	if !remote["origin/main"] {
		t.Errorf("origin/main not tagged Remote: %+v", got)
	}
	if remote["main"] {
		t.Errorf("local main tagged Remote: %+v", got)
	}
	for _, n := range names {
		if n == "origin/HEAD" {
			t.Error("origin/HEAD is a symbolic ref, not a comparison target — it must be filtered")
		}
	}
}

// The compare picker lists remotes now, so the default base can be the remote ref itself rather than
// a local branch that may be behind it.
func TestDefaultBranchPrefersRemote(t *testing.T) {
	dir := repoWithRemote(t)
	got, err := DefaultBranch(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if got != "origin/main" {
		t.Errorf("got %q, want origin/main — the picker can show remotes now", got)
	}
}

func initRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	ctx := context.Background()
	for _, args := range [][]string{
		{"init"}, {"config", "user.email", "t@t"}, {"config", "user.name", "t"},
		// hermetic line endings: Git-for-Windows' system config defaults core.autocrlf=true,
		// which would rewrite LF<->CRLF on checkout/apply and make these assertions nondeterministic.
		{"config", "core.autocrlf", "false"},
	} {
		if _, err := run(ctx, dir, args...); err != nil {
			t.Fatalf("git %v: %v", args, err)
		}
	}
	return dir
}

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func commitAll(t *testing.T, dir string) {
	t.Helper()
	ctx := context.Background()
	if _, err := run(ctx, dir, "add", "-A"); err != nil {
		t.Fatal(err)
	}
	if _, err := run(ctx, dir, "commit", "-m", "base"); err != nil {
		t.Fatal(err)
	}
}

func gitRun(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.CommandContext(context.Background(), "git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func TestRangeLog(t *testing.T) {
	dir := t.TempDir()
	gitRun(t, dir, "init", "-q")
	gitRun(t, dir, "commit", "-q", "--allow-empty", "-m", "base commit")
	base := gitRun(t, dir, "rev-parse", "HEAD")
	gitRun(t, dir, "commit", "-q", "--allow-empty", "-m", "PROJ-142 add pkce flow")
	gitRun(t, dir, "commit", "-q", "--allow-empty", "-m", "fix token rotation")
	end := gitRun(t, dir, "rev-parse", "HEAD")

	commits, err := RangeLog(context.Background(), dir, base, end)
	if err != nil {
		t.Fatalf("RangeLog: %v", err)
	}
	if len(commits) != 2 {
		t.Fatalf("want 2 commits in base..end, got %d: %+v", len(commits), commits)
	}
	// git log lists newest first
	if commits[0].Subject != "fix token rotation" || commits[1].Subject != "PROJ-142 add pkce flow" {
		t.Fatalf("subjects wrong: %+v", commits)
	}
	if commits[0].Hash == "" || commits[0].Ts == 0 {
		t.Fatalf("hash/ts not populated: %+v", commits[0])
	}

	// empty range returns empty, not an error
	empty, err := RangeLog(context.Background(), dir, end, end)
	if err != nil {
		t.Fatalf("RangeLog empty: %v", err)
	}
	if len(empty) != 0 {
		t.Fatalf("want 0 commits for end..end, got %d", len(empty))
	}
}

// gitAuthored is git(t, ...) with a named author instead of the bare "t", so the history and
// divergence tests can assert on the author field they carry.
func gitAuthored(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=dana k", "GIT_AUTHOR_EMAIL=dana@example.com",
		"GIT_COMMITTER_NAME=dana k", "GIT_COMMITTER_EMAIL=dana@example.com")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v: %s", args, err, out)
	}
}

// commitAuthored writes name=body, stages everything and commits as "dana k".
func commitAuthored(t *testing.T, dir, name, body, msg string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	gitAuthored(t, dir, "add", ".")
	gitAuthored(t, dir, "commit", "-m", msg)
}

// repoBranchMerge builds: root -> a -> (feature: b) -> merge, so history has a real merge commit
// with two parents and a branch ref to decorate.
func repoBranchMerge(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	gitAuthored(t, dir, "init", "--initial-branch=main")
	commitAuthored(t, dir, "root.txt", "root\n", "root commit")
	commitAuthored(t, dir, "a.txt", "a\n", "second on main")
	gitAuthored(t, dir, "checkout", "-b", "feature")
	commitAuthored(t, dir, "b.txt", "b\n", "only on feature")
	gitAuthored(t, dir, "checkout", "main")
	gitAuthored(t, dir, "merge", "--no-ff", "feature", "-m", "merge feature into main")
	return dir
}

func TestHistoryLogParentsAndOrder(t *testing.T) {
	dir := repoBranchMerge(t)
	h, err := HistoryLog(context.Background(), dir, HistoryOpts{})
	if err != nil {
		t.Fatalf("HistoryLog: %v", err)
	}
	if !h.IsRepo {
		t.Fatal("IsRepo = false, want true")
	}
	if len(h.Commits) != 4 {
		t.Fatalf("got %d commits, want 4", len(h.Commits))
	}
	tip := h.Commits[0]
	if tip.Subject != "merge feature into main" {
		t.Errorf("tip subject = %q, want the merge commit (newest first)", tip.Subject)
	}
	if len(tip.Parents) != 2 {
		t.Errorf("merge commit has %d parents, want 2", len(tip.Parents))
	}
	if tip.Author != "dana k" {
		t.Errorf("author = %q, want %q", tip.Author, "dana k")
	}
	if tip.Ts == 0 {
		t.Error("Ts = 0, want a UnixMilli author time")
	}
	root := h.Commits[len(h.Commits)-1]
	if len(root.Parents) != 0 {
		t.Errorf("root commit has %d parents, want 0", len(root.Parents))
	}
}

func TestHistoryLogDecoratesRefs(t *testing.T) {
	dir := repoBranchMerge(t)
	h, err := HistoryLog(context.Background(), dir, HistoryOpts{})
	if err != nil {
		t.Fatalf("HistoryLog: %v", err)
	}
	var tipRefs []string
	for _, c := range h.Commits {
		if c.Subject == "merge feature into main" {
			tipRefs = c.Refs
		}
	}
	joined := strings.Join(tipRefs, "|")
	if !strings.Contains(joined, "main") {
		t.Errorf("tip refs = %v, want one entry naming main", tipRefs)
	}
	// The frontend (historyrows.ts classifyRef) tells a remote branch from a slashed local branch by
	// the refs/ namespace, which only --decorate=full emits. Short form ("HEAD -> main") is
	// indistinguishable from a remote, so guard the full form here rather than downstream.
	if !strings.Contains(joined, "refs/heads/main") {
		t.Errorf("tip refs = %v, want the full refs/heads/main form (--decorate=full)", tipRefs)
	}
}

func TestHistoryLogPaginates(t *testing.T) {
	dir := repoBranchMerge(t)
	first, err := HistoryLog(context.Background(), dir, HistoryOpts{Limit: 2})
	if err != nil {
		t.Fatalf("HistoryLog: %v", err)
	}
	if len(first.Commits) != 2 {
		t.Fatalf("Limit=2 returned %d commits", len(first.Commits))
	}
	next, err := HistoryLog(context.Background(), dir, HistoryOpts{Limit: 2, Skip: 2})
	if err != nil {
		t.Fatalf("HistoryLog skip: %v", err)
	}
	if len(next.Commits) != 2 {
		t.Fatalf("Skip=2 returned %d commits", len(next.Commits))
	}
	if next.Commits[0].Hash == first.Commits[0].Hash {
		t.Error("Skip=2 returned the same page as Skip=0")
	}
}

func TestHistoryLogFiltersByAuthorAndPath(t *testing.T) {
	dir := repoBranchMerge(t)
	byAuthor, err := HistoryLog(context.Background(), dir, HistoryOpts{Author: "nobody@example.com"})
	if err != nil {
		t.Fatalf("HistoryLog author: %v", err)
	}
	if len(byAuthor.Commits) != 0 {
		t.Errorf("author filter matched %d commits, want 0", len(byAuthor.Commits))
	}
	byPath, err := HistoryLog(context.Background(), dir, HistoryOpts{Path: "b.txt"})
	if err != nil {
		t.Fatalf("HistoryLog path: %v", err)
	}
	if len(byPath.Commits) != 1 {
		t.Fatalf("path filter matched %d commits, want 1", len(byPath.Commits))
	}
	if byPath.Commits[0].Subject != "only on feature" {
		t.Errorf("path filter returned %q", byPath.Commits[0].Subject)
	}
}

func TestHistoryLogNotARepo(t *testing.T) {
	h, err := HistoryLog(context.Background(), t.TempDir(), HistoryOpts{})
	if err != nil {
		t.Fatalf("HistoryLog on non-repo returned error %v, want IsRepo=false", err)
	}
	if h.IsRepo {
		t.Error("IsRepo = true for a directory with no .git")
	}
}

// repoDiverged builds root -> shared, then main gains one commit and feature gains two, so the two
// branches have genuinely divergent commits and a merge base that is neither tip.
func repoDiverged(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	gitAuthored(t, dir, "init", "--initial-branch=main")
	commitAuthored(t, dir, "root.txt", "root.txt\n", "root commit")
	gitAuthored(t, dir, "checkout", "-b", "feature")
	commitAuthored(t, dir, "f1.txt", "f1.txt\n", "feature one")
	commitAuthored(t, dir, "f2.txt", "f2.txt\n", "feature two")
	gitAuthored(t, dir, "checkout", "main")
	commitAuthored(t, dir, "m1.txt", "m1.txt\n", "main one")
	return dir
}

func TestGetDivergenceSplitsBothSides(t *testing.T) {
	dir := repoDiverged(t)
	d, err := GetDivergence(context.Background(), dir, "main", "feature")
	if err != nil {
		t.Fatalf("GetDivergence: %v", err)
	}
	if !d.IsRepo {
		t.Fatal("IsRepo = false, want true")
	}
	if len(d.Ahead) != 2 {
		t.Errorf("Ahead has %d commits, want 2 (feature one, feature two)", len(d.Ahead))
	}
	if len(d.Behind) != 1 {
		t.Errorf("Behind has %d commits, want 1 (main one)", len(d.Behind))
	}
	if d.Ahead[0].Subject != "feature two" {
		t.Errorf("Ahead[0] = %q, want the newest feature commit", d.Ahead[0].Subject)
	}
	if d.Behind[0].Subject != "main one" {
		t.Errorf("Behind[0] = %q, want %q", d.Behind[0].Subject, "main one")
	}
	if d.Ahead[0].Author != "dana k" {
		t.Errorf("Ahead[0].Author = %q, want an author (this is why RangeLog was not reused)", d.Ahead[0].Author)
	}
}

func TestGetDivergenceReportsMergeBase(t *testing.T) {
	dir := repoDiverged(t)
	d, err := GetDivergence(context.Background(), dir, "main", "feature")
	if err != nil {
		t.Fatalf("GetDivergence: %v", err)
	}
	if d.MergeBase == "" {
		t.Fatal("MergeBase is empty")
	}
	root, err := HistoryLog(context.Background(), dir, HistoryOpts{Ref: "main"})
	if err != nil {
		t.Fatal(err)
	}
	want := root.Commits[len(root.Commits)-1].Hash
	if d.MergeBase != want {
		t.Errorf("MergeBase = %q, want the root commit %q", d.MergeBase, want)
	}
}

func TestGetDivergenceReportsMergeBaseTime(t *testing.T) {
	dir := repoDiverged(t)
	d, err := GetDivergence(context.Background(), dir, "main", "feature")
	if err != nil {
		t.Fatalf("GetDivergence: %v", err)
	}
	root, err := HistoryLog(context.Background(), dir, HistoryOpts{Ref: "main"})
	if err != nil {
		t.Fatal(err)
	}
	want := root.Commits[len(root.Commits)-1].Ts
	if d.MergeBaseTs != want {
		t.Errorf("MergeBaseTs = %d, want the root commit's time %d", d.MergeBaseTs, want)
	}
}

func TestGetDivergenceIdenticalRefs(t *testing.T) {
	dir := repoDiverged(t)
	d, err := GetDivergence(context.Background(), dir, "main", "main")
	if err != nil {
		t.Fatalf("GetDivergence: %v", err)
	}
	if len(d.Ahead) != 0 || len(d.Behind) != 0 {
		t.Errorf("comparing a ref to itself gave %d ahead / %d behind, want 0 / 0", len(d.Ahead), len(d.Behind))
	}
}

func TestGetDivergenceNotARepo(t *testing.T) {
	d, err := GetDivergence(context.Background(), t.TempDir(), "main", "feature")
	if err != nil {
		t.Fatalf("GetDivergence on non-repo returned error %v, want IsRepo=false", err)
	}
	if d.IsRepo {
		t.Error("IsRepo = true for a directory with no .git")
	}
}

// commitBySubject finds a commit hash in the repo's history by its subject line, so the tests below
// do not depend on --date-order tie-breaking between commits made in the same second.
func commitBySubject(t *testing.T, dir, subject string) string {
	t.Helper()
	h, err := HistoryLog(context.Background(), dir, HistoryOpts{})
	if err != nil {
		t.Fatalf("HistoryLog: %v", err)
	}
	for _, c := range h.Commits {
		if c.Subject == subject {
			return c.Hash
		}
	}
	t.Fatalf("no commit with subject %q in %d commits", subject, len(h.Commits))
	return ""
}

func TestCommitChangesIsolatesOneCommit(t *testing.T) {
	dir := repoBranchMerge(t)
	hash := commitBySubject(t, dir, "second on main")
	ch, err := CommitChanges(context.Background(), dir, hash)
	if err != nil {
		t.Fatalf("CommitChanges: %v", err)
	}
	if !ch.IsRepo {
		t.Fatal("IsRepo = false, want true")
	}
	// that commit added a.txt and nothing else — root.txt already existed, b.txt did not yet
	if !strings.Contains(ch.StatusZ, "a.txt") {
		t.Errorf("StatusZ = %q, want it to mention a.txt", ch.StatusZ)
	}
	if strings.Contains(ch.StatusZ, "root.txt") {
		t.Errorf("StatusZ = %q, want it NOT to mention root.txt", ch.StatusZ)
	}
	if !strings.Contains(ch.Numstat, "a.txt") {
		t.Errorf("Numstat = %q, want it to mention a.txt", ch.Numstat)
	}
}

func TestCommitChangesHandlesRootCommit(t *testing.T) {
	dir := repoBranchMerge(t)
	hash := commitBySubject(t, dir, "root commit")
	ch, err := CommitChanges(context.Background(), dir, hash)
	if err != nil {
		t.Fatalf("CommitChanges: %v", err)
	}
	// a root commit has no parent; every file in it reads as added against the empty tree
	if !strings.Contains(ch.StatusZ, "root.txt") {
		t.Errorf("StatusZ = %q, want it to mention root.txt", ch.StatusZ)
	}
	if !strings.Contains(ch.StatusZ, "A") {
		t.Errorf("StatusZ = %q, want an A status", ch.StatusZ)
	}
}

func TestCommitChangesOnMergeUsesFirstParent(t *testing.T) {
	dir := repoBranchMerge(t)
	hash := commitBySubject(t, dir, "merge feature into main")
	ch, err := CommitChanges(context.Background(), dir, hash)
	if err != nil {
		t.Fatalf("CommitChanges: %v", err)
	}
	// against its first parent (main's tip) the merge brings in exactly b.txt
	if !strings.Contains(ch.StatusZ, "b.txt") {
		t.Errorf("StatusZ = %q, want it to mention b.txt", ch.StatusZ)
	}
	if strings.Contains(ch.StatusZ, "a.txt") {
		t.Errorf("StatusZ = %q, want it NOT to mention a.txt", ch.StatusZ)
	}
}

func TestCommitChangesNotARepo(t *testing.T) {
	ch, err := CommitChanges(context.Background(), t.TempDir(), "HEAD")
	if err != nil {
		t.Fatalf("CommitChanges: %v", err)
	}
	if ch.IsRepo {
		t.Error("IsRepo = true, want false outside a repository")
	}
}

// The three-dot anchor is the whole point of CompareChanges: main's own m1.txt must not appear.
// Under the two-dot form it would appear as a deletion, which is the regression this guards.
func TestCompareChangesUsesMergeBaseAnchor(t *testing.T) {
	dir := repoDiverged(t)
	ch, err := CompareChanges(context.Background(), dir, "main", "feature", false)
	if err != nil {
		t.Fatalf("CompareChanges: %v", err)
	}
	if !ch.IsRepo {
		t.Fatal("IsRepo = false, want true")
	}
	if strings.Contains(ch.StatusZ, "m1.txt") {
		t.Errorf("StatusZ mentions m1.txt (%q); three-dot must ignore the base side's own commits", ch.StatusZ)
	}
	for _, want := range []string{"f1.txt", "f2.txt"} {
		if !strings.Contains(ch.StatusZ, want) {
			t.Errorf("StatusZ missing %s: %q", want, ch.StatusZ)
		}
	}
	if !strings.Contains(ch.Numstat, "f1.txt") {
		t.Errorf("Numstat missing f1.txt: %q", ch.Numstat)
	}
}

func TestCompareChangesEmptyWhenRefsAgree(t *testing.T) {
	dir := repoDiverged(t)
	ch, err := CompareChanges(context.Background(), dir, "main", "main", false)
	if err != nil {
		t.Fatalf("CompareChanges: %v", err)
	}
	if !ch.IsRepo {
		t.Fatal("IsRepo = false, want true")
	}
	if strings.TrimSpace(ch.StatusZ) != "" || strings.TrimSpace(ch.Numstat) != "" {
		t.Errorf("want an empty change set, got statusz=%q numstat=%q", ch.StatusZ, ch.Numstat)
	}
}

func TestCompareChangesNotARepo(t *testing.T) {
	ch, err := CompareChanges(context.Background(), t.TempDir(), "main", "feature", false)
	if err != nil {
		t.Fatalf("CompareChanges on a non-repo should not error: %v", err)
	}
	if ch.IsRepo {
		t.Fatal("IsRepo = true for a non-repo dir")
	}
}

func TestDefaultBranchFromOriginHead(t *testing.T) {
	dir := repoDiverged(t)
	// origin/HEAD is an ordinary symbolic ref under refs/remotes; writing it by hand needs no network.
	gitAuthored(t, dir, "update-ref", "refs/remotes/origin/trunk", "main")
	gitAuthored(t, dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk")
	got, err := DefaultBranch(context.Background(), dir)
	if err != nil {
		t.Fatalf("DefaultBranch: %v", err)
	}
	if got != "origin/trunk" {
		t.Errorf("DefaultBranch = %q, want %q (the remote ref itself, not the local name)", got, "origin/trunk")
	}
}

func TestDefaultBranchProbesMain(t *testing.T) {
	dir := repoDiverged(t) // init -b main, no remote at all
	got, err := DefaultBranch(context.Background(), dir)
	if err != nil {
		t.Fatalf("DefaultBranch: %v", err)
	}
	if got != "main" {
		t.Errorf("DefaultBranch = %q, want %q", got, "main")
	}
}

func TestDefaultBranchProbesMaster(t *testing.T) {
	dir := t.TempDir()
	gitAuthored(t, dir, "init", "--initial-branch=master")
	commitAuthored(t, dir, "root.txt", "root.txt\n", "root commit")
	got, err := DefaultBranch(context.Background(), dir)
	if err != nil {
		t.Fatalf("DefaultBranch: %v", err)
	}
	if got != "master" {
		t.Errorf("DefaultBranch = %q, want %q", got, "master")
	}
}

// No origin/HEAD, no main, no master -> "" and no error, so the ref picker opens with an empty base
// field rather than surfacing an error the user cannot act on.
func TestDefaultBranchNoneResolve(t *testing.T) {
	dir := t.TempDir()
	gitAuthored(t, dir, "init", "--initial-branch=dev")
	commitAuthored(t, dir, "root.txt", "root.txt\n", "root commit")
	got, err := DefaultBranch(context.Background(), dir)
	if err != nil {
		t.Fatalf("DefaultBranch: %v", err)
	}
	if got != "" {
		t.Errorf("DefaultBranch = %q, want \"\"", got)
	}
}

func TestHistoryLogReportsFailureDetail(t *testing.T) {
	dir := repoBranchMerge(t)
	h, err := HistoryLog(context.Background(), dir, HistoryOpts{Ref: "no-such-ref-anywhere"})
	if err != nil {
		t.Fatalf("HistoryLog should describe a git failure, not return an error: %v", err)
	}
	if !h.IsRepo {
		t.Fatal("IsRepo = false, want true — the directory IS a repo; the read is what failed")
	}
	if h.Failure == nil {
		t.Fatal("Failure = nil, want the failing command described")
	}
	if h.Failure.ExitCode != 128 {
		t.Errorf("ExitCode = %d, want 128 (git's fatal-error code)", h.Failure.ExitCode)
	}
	if !strings.Contains(h.Failure.Command, "log") {
		t.Errorf("Command = %q, want it to name the log invocation", h.Failure.Command)
	}
	// the failure panel prints the command verbatim, where a raw separator byte draws as a box
	if strings.ContainsAny(h.Failure.Command, fieldSep+recordSep) {
		t.Errorf("Command = %q, want git's %%x escapes, not raw separator bytes", h.Failure.Command)
	}
	if !strings.Contains(h.Failure.Stderr, "no-such-ref-anywhere") {
		t.Errorf("Stderr = %q, want git's own message naming the bad revision", h.Failure.Stderr)
	}
}

// A freshly initialised repo has no commits, and git log exits 128 there. That is an empty history,
// not a failed read: reporting it as a failure would greet every new project with an error panel.
func TestHistoryLogEmptyRepoIsNotAFailure(t *testing.T) {
	dir := t.TempDir()
	gitAuthored(t, dir, "init", "--initial-branch=main")
	h, err := HistoryLog(context.Background(), dir, HistoryOpts{})
	if err != nil {
		t.Fatalf("HistoryLog: %v", err)
	}
	if !h.IsRepo {
		t.Error("IsRepo = false, want true for an initialised repo with no commits")
	}
	if h.Failure != nil {
		t.Errorf("Failure = %+v, want nil for an unborn branch", h.Failure)
	}
	if len(h.Commits) != 0 {
		t.Errorf("got %d commits, want 0", len(h.Commits))
	}
}

func TestHistoryLogHealthyReadHasNoFailure(t *testing.T) {
	dir := repoBranchMerge(t)
	h, err := HistoryLog(context.Background(), dir, HistoryOpts{})
	if err != nil {
		t.Fatalf("HistoryLog: %v", err)
	}
	if h.Failure != nil {
		t.Errorf("Failure = %+v, want nil — a working repo must not be able to trip the panel", h.Failure)
	}
}

func writeAt(t *testing.T, dir, rel, body string) {
	t.Helper()
	full := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestListFilesIncludesTrackedAndUntrackedButNotIgnored(t *testing.T) {
	dir := t.TempDir()
	git(t, dir, "init", "-b", "main")
	writeAt(t, dir, ".gitignore", "ignored.txt\n")
	writeAt(t, dir, "a.go", "package a\n")
	writeAt(t, dir, "sub/b.go", "package b\n")
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "init")
	writeAt(t, dir, "untracked.go", "package u\n")
	writeAt(t, dir, "ignored.txt", "nope\n")
	writeAt(t, dir, "has space.go", "package s\n")

	fl, err := ListFiles(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if !fl.IsRepo {
		t.Fatalf("IsRepo = false, want true")
	}
	if fl.Truncated {
		t.Fatalf("Truncated = true, want false")
	}
	want := []string{".gitignore", "a.go", "has space.go", "sub/b.go", "untracked.go"}
	if strings.Join(fl.Paths, "|") != strings.Join(want, "|") {
		t.Fatalf("Paths = %v, want %v", fl.Paths, want)
	}
	if strings.Join(fl.Ignored, "|") != "ignored.txt" {
		t.Fatalf("Ignored = %v, want [ignored.txt]", fl.Ignored)
	}
}

// A directory ignored as a whole comes back as one entry, not walked; an ignored file inside a tracked
// directory is its own entry. Opening the directory lists one level of it.
func TestListFilesIgnoredDirectoryIsOneEntryListedOnDemand(t *testing.T) {
	dir := t.TempDir()
	git(t, dir, "init", "-b", "main")
	writeAt(t, dir, ".gitignore", "node_modules/\n*.log\n")
	writeAt(t, dir, "src/a.go", "package a\n")
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "init")
	writeAt(t, dir, "node_modules/pkg/index.js", "x\n")
	writeAt(t, dir, "node_modules/top.js", "x\n")
	writeAt(t, dir, "src/debug.log", "x\n")

	fl, err := ListFiles(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(fl.Ignored, "|"); got != "node_modules/|src/debug.log" {
		t.Fatalf("Ignored = %q, want node_modules/|src/debug.log", got)
	}

	entries, err := ListIgnoredDir(dir, "node_modules/")
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(entries, "|"); got != "node_modules/pkg/|node_modules/top.js" {
		t.Fatalf("entries = %q", got)
	}
	nested, err := ListIgnoredDir(dir, "node_modules/pkg/")
	if err != nil || strings.Join(nested, "|") != "node_modules/pkg/index.js" {
		t.Fatalf("nested = %v, %v", nested, err)
	}
}

func TestListIgnoredDirRefusesPathsOutsideTheProject(t *testing.T) {
	dir := t.TempDir()
	for _, bad := range []string{"..", "../x", "a/../../x", "", ".", filepath.Join(dir, "x")} {
		if _, err := ListIgnoredDir(dir, bad); err == nil {
			t.Errorf("ListIgnoredDir(%q) must refuse", bad)
		}
	}
}

func TestListFilesNonRepoReportsIsRepoFalse(t *testing.T) {
	fl, err := ListFiles(context.Background(), t.TempDir())
	if err != nil {
		t.Fatalf("non-repo must not error: %v", err)
	}
	if fl.IsRepo {
		t.Fatalf("IsRepo = true, want false")
	}
	if len(fl.Paths) != 0 {
		t.Fatalf("Paths = %v, want empty", fl.Paths)
	}
}

// A repository with one match in each interesting category: tracked, untracked-not-ignored,
// ignored, binary, and a CRLF line (this is a Windows checkout, so real files have CRLF).
func repoForGrep(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	git(t, dir, "init", "-b", "main")
	write := func(name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("tracked.txt", "alpha NEEDLE here\nsecond line\n")
	write("crlf.txt", "carriage NEEDLE return\r\n")
	write(".gitignore", "ignored.txt\n")
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "init")
	write("untracked.txt", "another needle line\n")
	write("ignored.txt", "NEEDLE in an ignored file\n")
	write("bin.dat", "NEEDLE\x00binary\n")
	return dir
}

func grepPaths(res *GrepResult) map[string]bool {
	out := map[string]bool{}
	for _, m := range res.Matches {
		out[m.Path] = true
	}
	return out
}

func TestGrepReturnsPathLineAndText(t *testing.T) {
	res, err := Grep(context.Background(), repoForGrep(t), "NEEDLE", GrepOpts{})
	if err != nil {
		t.Fatal(err)
	}
	var got *GrepMatch
	for i := range res.Matches {
		if res.Matches[i].Path == "tracked.txt" {
			got = &res.Matches[i]
		}
	}
	if got == nil {
		t.Fatalf("no match in tracked.txt; got %+v", res.Matches)
	}
	if got.Line != 1 {
		t.Errorf("Line = %d, want 1", got.Line)
	}
	if got.Text != "alpha NEEDLE here" {
		t.Errorf("Text = %q, want %q", got.Text, "alpha NEEDLE here")
	}
}

func TestGrepStripsTheCarriageReturn(t *testing.T) {
	res, err := Grep(context.Background(), repoForGrep(t), "carriage", GrepOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Matches) != 1 {
		t.Fatalf("want exactly one match, got %+v", res.Matches)
	}
	if res.Matches[0].Text != "carriage NEEDLE return" {
		t.Errorf("Text = %q — a trailing \\r must be stripped", res.Matches[0].Text)
	}
}

func TestGrepNoMatchIsNotAnError(t *testing.T) {
	res, err := Grep(context.Background(), repoForGrep(t), "no-such-string-anywhere", GrepOpts{})
	if err != nil {
		t.Fatalf("git grep exits 1 for no matches; that is not an error: %v", err)
	}
	if len(res.Matches) != 0 {
		t.Errorf("want no matches, got %+v", res.Matches)
	}
	if res.Truncated {
		t.Error("Truncated must be false when there are no matches")
	}
}

func TestGrepSearchesUntrackedAndHonorsGitignore(t *testing.T) {
	res, err := Grep(context.Background(), repoForGrep(t), "NEEDLE", GrepOpts{})
	if err != nil {
		t.Fatal(err)
	}
	paths := grepPaths(res)
	if !paths["untracked.txt"] {
		t.Error("untracked.txt not searched — --untracked is missing, so search disagrees with the file tree")
	}
	if paths["ignored.txt"] {
		t.Error("ignored.txt searched — .gitignore must still be honored")
	}
}

func TestGrepSkipsBinaryFiles(t *testing.T) {
	res, err := Grep(context.Background(), repoForGrep(t), "NEEDLE", GrepOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if grepPaths(res)["bin.dat"] {
		t.Error("bin.dat searched — -I must skip binary files")
	}
}

func TestGrepIsCaseInsensitive(t *testing.T) {
	res, err := Grep(context.Background(), repoForGrep(t), "needle", GrepOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if !grepPaths(res)["tracked.txt"] {
		t.Error("lowercase query did not match uppercase NEEDLE")
	}
}

func TestGrepEmptyQueryReturnsNoMatches(t *testing.T) {
	res, err := Grep(context.Background(), repoForGrep(t), "   ", GrepOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Matches) != 0 {
		t.Errorf("an empty query must match nothing (git grep -e \"\" matches every line), got %d", len(res.Matches))
	}
}

func TestGrepTruncatesAtTheCap(t *testing.T) {
	dir := t.TempDir()
	git(t, dir, "init", "-b", "main")
	var sb strings.Builder
	for i := 0; i < maxGrepMatches+100; i++ {
		sb.WriteString("NEEDLE line\n")
	}
	if err := os.WriteFile(filepath.Join(dir, "many.txt"), []byte(sb.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := Grep(context.Background(), dir, "NEEDLE", GrepOpts{})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Matches) != maxGrepMatches {
		t.Errorf("len(Matches) = %d, want the cap %d", len(res.Matches), maxGrepMatches)
	}
	if !res.Truncated {
		t.Error("Truncated must be true once the cap is hit")
	}
}

func TestGrepOnNonRepoIsAnError(t *testing.T) {
	if _, err := Grep(context.Background(), t.TempDir(), "anything", GrepOpts{}); err == nil {
		t.Error("a non-repository must error (git exits 128), not report zero matches")
	}
}

func TestGrepCaseSensitiveExcludesOtherCase(t *testing.T) {
	res, err := Grep(context.Background(), repoForGrep(t), "needle", GrepOpts{CaseSensitive: true})
	if err != nil {
		t.Fatal(err)
	}
	paths := grepPaths(res)
	if !paths["untracked.txt"] {
		t.Error("untracked.txt has the lowercase needle and must still match")
	}
	if paths["tracked.txt"] {
		t.Error("tracked.txt only has NEEDLE — CaseSensitive must drop -i")
	}
}

func TestGrepWholeWordExcludesASubstringHit(t *testing.T) {
	dir := repoForGrep(t)
	writeAt(t, dir, "word.txt", "needlework\n")
	res, err := Grep(context.Background(), dir, "needle", GrepOpts{WholeWord: true})
	if err != nil {
		t.Fatal(err)
	}
	paths := grepPaths(res)
	if !paths["untracked.txt"] {
		t.Error("untracked.txt has needle as a word and must match")
	}
	if paths["word.txt"] {
		t.Error("word.txt only has needlework — WholeWord must exclude a substring hit")
	}
}

func TestGrepRegexAcceptsAnExtendedPattern(t *testing.T) {
	// alternation is ERE syntax: under -F, or a basic regex, this pattern matches nothing
	res, err := Grep(context.Background(), repoForGrep(t), "alpha|carriage", GrepOpts{Regex: true})
	if err != nil {
		t.Fatal(err)
	}
	paths := grepPaths(res)
	if !paths["tracked.txt"] || !paths["crlf.txt"] {
		t.Errorf("want tracked.txt and crlf.txt, got %+v", res.Matches)
	}
}

// Git's regex engine is a build-time choice, so the search never relies on \b; this asserts the
// flag it relies on instead works together with -E on the git this runs against.
func TestGrepWholeWordWorksWithRegex(t *testing.T) {
	dir := repoForGrep(t)
	writeAt(t, dir, "word.txt", "needlework\n")
	res, err := Grep(context.Background(), dir, "need(le|ful)", GrepOpts{Regex: true, WholeWord: true})
	if err != nil {
		t.Fatal(err)
	}
	paths := grepPaths(res)
	if !paths["untracked.txt"] {
		t.Error("untracked.txt has needle as a word and must match")
	}
	if paths["word.txt"] {
		t.Error("word.txt only has needlework — -w must still apply under -E")
	}
}

func TestGrepInvalidRegexReportsInvalidPatternNotAnError(t *testing.T) {
	res, err := Grep(context.Background(), repoForGrep(t), "(", GrepOpts{Regex: true})
	if err != nil {
		t.Fatalf("an uncompilable regex is the user's typo, not a failed read: %v", err)
	}
	if !res.InvalidPattern {
		t.Error("InvalidPattern must be set")
	}
	if len(res.Matches) != 0 {
		t.Errorf("want no matches, got %+v", res.Matches)
	}
}

func TestGrepIncludeMatchesAtAnyDepth(t *testing.T) {
	dir := repoForGrep(t)
	writeAt(t, dir, "pkg/sub/deep.go", "NEEDLE deep\n")
	writeAt(t, dir, "top.go", "NEEDLE top\n")
	res, err := Grep(context.Background(), dir, "NEEDLE", GrepOpts{Include: []string{"*.go"}})
	if err != nil {
		t.Fatal(err)
	}
	paths := grepPaths(res)
	// what someone typing *.go means; a glob-magic pathspec would only reach top.go
	if len(paths) != 2 || !paths["pkg/sub/deep.go"] || !paths["top.go"] {
		t.Errorf("want exactly the two .go files, got %+v", res.Matches)
	}
}

func TestGrepExcludeDropsPathsFromAnIncludedSet(t *testing.T) {
	res, err := Grep(context.Background(), repoForGrep(t), "needle", GrepOpts{
		Include: []string{"*.txt"},
		Exclude: []string{"untracked*", " "},
	})
	if err != nil {
		t.Fatal(err)
	}
	paths := grepPaths(res)
	if !paths["tracked.txt"] || !paths["crlf.txt"] {
		t.Errorf("want tracked.txt and crlf.txt, got %+v", res.Matches)
	}
	if paths["untracked.txt"] {
		t.Error("untracked.txt matched an exclude and must be dropped")
	}
}

func TestFileAtRefReadsCommittedContent(t *testing.T) {
	dir := repoWithChange(t)
	got, err := FileAtRef(context.Background(), dir, "HEAD", "a.txt", 0)
	if err != nil {
		t.Fatal(err)
	}
	if !got.IsRepo || got.Missing || got.Binary || got.TooLarge {
		t.Fatalf("flags = %+v, want a plain text hit", got)
	}
	if got.Content != "one\ntwo\n" {
		t.Errorf("content = %q, want the committed text not the dirty worktree text", got.Content)
	}
}

// The regression this test exists for: paths from every other reader in this package are
// cwd-relative (--relative), and "<ref>:<path>" resolves from the repo root, so a bare path
// silently misses whenever the surface is scoped to a subdirectory.
func TestFileAtRefSubdir(t *testing.T) {
	dir := t.TempDir()
	git(t, dir, "init", "-b", "main")
	writeAt(t, dir, "sub/c.txt", "deep\n")
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "init")

	got, err := FileAtRef(context.Background(), filepath.Join(dir, "sub"), "HEAD", "c.txt", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got.Content != "deep\n" {
		t.Errorf("content = %q, want %q", got.Content, "deep\n")
	}
}

// A file added since the ref is an answer, not a failure: the diff renders it as wholly added.
func TestFileAtRefMissingIsNotAnError(t *testing.T) {
	dir := repoWithChange(t) // b.txt exists on disk, was never committed
	got, err := FileAtRef(context.Background(), dir, "HEAD", "b.txt", 0)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Missing || got.Content != "" {
		t.Errorf("got %+v, want Missing with no content", got)
	}
}

func TestFileAtRefPathWithASpace(t *testing.T) {
	dir := t.TempDir()
	git(t, dir, "init", "-b", "main")
	writeAt(t, dir, "has space.txt", "spaced\n")
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "init")

	got, err := FileAtRef(context.Background(), dir, "HEAD", "has space.txt", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got.Content != "spaced\n" {
		t.Errorf("content = %q, want %q", got.Content, "spaced\n")
	}
}

func TestFileAtRefBinary(t *testing.T) {
	dir := t.TempDir()
	git(t, dir, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "bin.dat"), []byte{0x00, 0xff, 0xfe, 0x01}, 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "init")

	got, err := FileAtRef(context.Background(), dir, "HEAD", "bin.dat", 0)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Binary || got.Content != "" {
		t.Errorf("got %+v, want Binary with no content", got)
	}
}

func TestFileAtRefTooLargeSkipsTheRead(t *testing.T) {
	dir := repoWithChange(t)
	got, err := FileAtRef(context.Background(), dir, "HEAD", "a.txt", 4) // "one\ntwo\n" is 8 bytes
	if err != nil {
		t.Fatal(err)
	}
	if !got.TooLarge || got.Content != "" {
		t.Errorf("got %+v, want TooLarge with no content", got)
	}
	if got.Size != 8 {
		t.Errorf("Size = %d, want 8", got.Size)
	}
}

func TestFileAtRefNotARepo(t *testing.T) {
	got, err := FileAtRef(context.Background(), t.TempDir(), "HEAD", "a.txt", 0)
	if err != nil {
		t.Fatalf("a non-repo directory must not error: %v", err)
	}
	if got.IsRepo {
		t.Errorf("IsRepo = true, want false")
	}
}

// Fetching from a real remote is not hermetic, so what is tested is the failure shape: a fetch that
// cannot run must come back as data carrying git's own words, not as an RPC error.
func TestFetchFailureCarriesStderr(t *testing.T) {
	dir := repoWithChange(t)
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "second")

	got, err := Fetch(context.Background(), dir, "nosuchremote")
	if err != nil {
		t.Fatalf("a git failure belongs in the result, not the error: %v", err)
	}
	if got.Failure == nil {
		t.Fatal("want a Failure describing the fetch that did not run")
	}
	if !strings.HasPrefix(got.Failure.Stderr, "fatal:") {
		t.Errorf("stderr = %q, want git's stderr verbatim, not the Go error wrapping it", got.Failure.Stderr)
	}
	if got.Failure.ExitCode != 128 {
		t.Errorf("exitcode = %d, want git's 128", got.Failure.ExitCode)
	}
	if !strings.Contains(got.Failure.Command, "fetch") {
		t.Errorf("command = %q, want the fetch invocation", got.Failure.Command)
	}
}

func TestFetchNotARepo(t *testing.T) {
	got, err := Fetch(context.Background(), t.TempDir(), "origin")
	if err != nil {
		t.Fatal(err)
	}
	if got.IsRepo {
		t.Errorf("got %+v, want IsRepo false", got)
	}
}

// A remote name is user-supplied text reaching an exec argv. git has no "--" terminator for fetch,
// so a name beginning with a dash would be read as an option instead of a remote; it is refused as a
// failure rather than handed to git to interpret.
func TestFetchRefusesAnOptionShapedRemote(t *testing.T) {
	dir := repoWithChange(t)
	got, err := Fetch(context.Background(), dir, "--upload-pack=whatever")
	if err != nil {
		t.Fatal(err)
	}
	if got.Failure == nil {
		t.Fatal("want a Failure: an option-shaped remote must not reach git")
	}
	if got.FetchedAt != 0 {
		t.Error("nothing was fetched, so the freshness clock must not advance")
	}
}

// The two forms only diverge when both sides have commits of their own: three-dot hides base's, two-
// dot shows them inverted. Anything less than a genuine divergence tests nothing.
func TestCompareChangesTipsIncludesBaseSideChanges(t *testing.T) {
	dir := t.TempDir()
	git(t, dir, "init", "-b", "main")
	writeFile(t, dir, "a.txt", "one\n")
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "init")

	git(t, dir, "checkout", "-b", "feature")
	writeFile(t, dir, "feat.txt", "f\n")
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "feature work")

	git(t, dir, "checkout", "main")
	writeFile(t, dir, "onmain.txt", "m\n")
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-m", "main moved on")

	mergeBase, err := CompareChanges(context.Background(), dir, "main", "feature", false)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(mergeBase.StatusZ, "onmain.txt") {
		t.Error("three-dot must not include the base side's own commits")
	}
	if !strings.Contains(mergeBase.StatusZ, "feat.txt") {
		t.Error("three-dot must include what head introduced")
	}

	tips, err := CompareChanges(context.Background(), dir, "main", "feature", true)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(tips.StatusZ, "onmain.txt") {
		t.Error("two-dot must include the base side's changes — that is the whole point of it")
	}
	if !strings.Contains(tips.StatusZ, "feat.txt") {
		t.Error("two-dot must still include head's changes")
	}
}

// Roughly 2.8MB of plausible text — the shape of a regenerated lockfile, which is the case the diff
// cap exists for. Built once for the whole run rather than per test; three of the four tests below
// write it.
var hugeBody = strings.Repeat(strings.Repeat("x", 45)+"\n", 60000)

// numbered returns n lines "line1\n".."lineN\n".
func numbered(n int) string {
	var b strings.Builder
	for i := 1; i <= n; i++ {
		b.WriteString("line" + strconv.Itoa(i) + "\n")
	}
	return b.String()
}

func reviewFile(t *testing.T, res *ReviewPatchResult, path string) ReviewPatchFile {
	t.Helper()
	for _, f := range res.Files {
		if f.Path == path {
			return f
		}
	}
	t.Fatalf("no file %q in %+v", path, res.Files)
	return ReviewPatchFile{}
}

func reviewPaths(res *ReviewPatchResult) []string {
	var paths []string
	for _, f := range res.Files {
		paths = append(paths, f.Path)
	}
	return paths
}

// repoForReview commits a.txt (10 lines), d-removed.txt and old.txt, then leaves the working tree with
// a.txt modified at line 5, c-added.txt staged, d-removed.txt deleted, old.txt renamed to new.txt, a
// staged binary bin.dat and an untracked b-untracked.txt.
func repoForReview(t *testing.T) string {
	t.Helper()
	dir := initRepo(t)
	writeFile(t, dir, "a.txt", numbered(10))
	writeFile(t, dir, "d-removed.txt", "gone\n")
	writeFile(t, dir, "old.txt", numbered(20))
	commitAll(t, dir)
	writeFile(t, dir, "a.txt", strings.Replace(numbered(10), "line5\n", "LINE FIVE\n", 1))
	writeFile(t, dir, "c-added.txt", "fresh\n")
	writeFile(t, dir, "bin.dat", "bin\x00ary\x00")
	if err := os.Remove(filepath.Join(dir, "d-removed.txt")); err != nil {
		t.Fatal(err)
	}
	git(t, dir, "mv", "old.txt", "new.txt")
	git(t, dir, "add", "c-added.txt", "bin.dat")
	writeFile(t, dir, "b-untracked.txt", "u1\nu2\n")
	return dir
}

func TestReviewPatchWorkingTree(t *testing.T) {
	dir := repoForReview(t)
	res, err := ReviewPatch(context.Background(), dir, "", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if !res.IsRepo {
		t.Fatal("IsRepo = false")
	}
	want := []string{"a.txt", "b-untracked.txt", "bin.dat", "c-added.txt", "d-removed.txt", "new.txt"}
	if got := reviewPaths(res); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("paths = %v, want %v (byte order, untracked merged in)", got, want)
	}

	a := reviewFile(t, res, "a.txt")
	if n := strings.Count(a.Diff, "\n@@ "); n != 1 {
		t.Errorf("a.txt has %d hunks, want 1 (full context):\n%s", n, a.Diff)
	}
	if !strings.Contains(a.Diff, "@@ -1,10 +1,10 @@") {
		t.Errorf("a.txt hunk does not span the whole file:\n%s", a.Diff)
	}
	for _, l := range []string{" line1\n", " line4\n", "-line5\n", "+LINE FIVE\n", " line6\n", " line10\n"} {
		if !strings.Contains(a.Diff, l) {
			t.Errorf("a.txt patch lacks %q:\n%s", l, a.Diff)
		}
	}
	if !strings.HasPrefix(a.Diff, "diff --git a/a.txt b/a.txt\n") {
		t.Errorf("a.txt patch does not start at its own header:\n%s", a.Diff)
	}
	if strings.Contains(a.Diff, "bin.dat") || strings.Contains(a.Diff, "c-added") {
		t.Errorf("a.txt patch carries another file's text:\n%s", a.Diff)
	}

	if c := reviewFile(t, res, "c-added.txt"); !strings.Contains(c.Diff, "new file mode") || !strings.Contains(c.Diff, "+fresh\n") {
		t.Errorf("c-added.txt patch:\n%s", c.Diff)
	}
	if d := reviewFile(t, res, "d-removed.txt"); !strings.Contains(d.Diff, "deleted file mode") || !strings.Contains(d.Diff, "-gone\n") {
		t.Errorf("d-removed.txt patch:\n%s", d.Diff)
	}
	if n := reviewFile(t, res, "new.txt"); n.OldPath != "old.txt" || !strings.Contains(n.Diff, "rename from old.txt") {
		t.Errorf("new.txt: OldPath = %q, patch:\n%s", n.OldPath, n.Diff)
	}
	if b := reviewFile(t, res, "bin.dat"); !strings.Contains(b.Diff, "Binary files") {
		t.Errorf("bin.dat patch does not say binary:\n%s", b.Diff)
	}
	u := reviewFile(t, res, "b-untracked.txt")
	if !u.Untracked || u.Content != "u1\nu2\n" || u.Diff != "" {
		t.Errorf("b-untracked.txt = %+v", u)
	}
	for _, f := range res.Files {
		if f.Path != "new.txt" && f.OldPath != "" {
			t.Errorf("%s has OldPath %q", f.Path, f.OldPath)
		}
		if f.TooLarge {
			t.Errorf("%s TooLarge with no cap", f.Path)
		}
	}
}

func TestReviewPatchCommitByHash(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "a.txt", numbered(10))
	writeFile(t, dir, "z.txt", "z\n")
	commitAll(t, dir)
	root := strings.TrimSpace(gitRun(t, dir, "rev-parse", "HEAD"))
	writeFile(t, dir, "a.txt", strings.Replace(numbered(10), "line3\n", "line three\n", 1))
	commitAll(t, dir)
	second := strings.TrimSpace(gitRun(t, dir, "rev-parse", "HEAD"))
	writeFile(t, dir, "z.txt", "uncommitted\n")
	writeFile(t, dir, "u.txt", "untracked\n")

	res, err := ReviewPatch(context.Background(), dir, second, "ignored-with-a-hash", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got := reviewPaths(res); strings.Join(got, ",") != "a.txt" {
		t.Fatalf("commit paths = %v, want [a.txt] (no working tree, no untracked)", got)
	}
	a := res.Files[0]
	if !strings.Contains(a.Diff, "@@ -1,10 +1,10 @@") || !strings.Contains(a.Diff, "+line three\n") || !strings.Contains(a.Diff, " line10\n") {
		t.Errorf("commit patch:\n%s", a.Diff)
	}

	res, err = ReviewPatch(context.Background(), dir, root, "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got := reviewPaths(res); strings.Join(got, ",") != "a.txt,z.txt" {
		t.Fatalf("root commit paths = %v", got)
	}
	if a := res.Files[0]; !strings.Contains(a.Diff, "new file mode") || !strings.Contains(a.Diff, "+line10\n") {
		t.Errorf("root commit patch is not against the empty tree:\n%s", a.Diff)
	}
}

func TestReviewPatchBaseBehindHead(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "x.txt", "one\n")
	commitAll(t, dir)
	base := strings.TrimSpace(gitRun(t, dir, "rev-parse", "HEAD"))
	writeFile(t, dir, "x.txt", "one\ntwo\n")
	commitAll(t, dir)

	res, err := ReviewPatch(context.Background(), dir, "", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Files) != 0 {
		t.Fatalf("against HEAD a clean tree has no files, got %v", reviewPaths(res))
	}
	res, err = ReviewPatch(context.Background(), dir, "", base, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Files) != 1 || !strings.Contains(res.Files[0].Diff, "+two\n") {
		t.Fatalf("against base the committed change shows, got %+v", res.Files)
	}
}

func TestReviewPatchTooLarge(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "big.txt", numbered(200))
	writeFile(t, dir, "small.txt", "s\n")
	commitAll(t, dir)
	writeFile(t, dir, "big.txt", strings.Replace(numbered(200), "line100\n", "changed\n", 1))
	writeFile(t, dir, "small.txt", "s2\n")
	writeFile(t, dir, "untracked-big.txt", numbered(200))

	const maxBytes = 1000
	res, err := ReviewPatch(context.Background(), dir, "", "", maxBytes)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"big.txt", "untracked-big.txt"} {
		f := reviewFile(t, res, p)
		if !f.TooLarge || f.Size <= maxBytes || f.Diff != "" || f.Content != "" {
			t.Errorf("%s = TooLarge %v Size %d Diff %d bytes Content %d bytes", p, f.TooLarge, f.Size, len(f.Diff), len(f.Content))
		}
	}
	if f := reviewFile(t, res, "untracked-big.txt"); !f.Untracked {
		t.Error("an oversized untracked file is still untracked")
	}
	if s := reviewFile(t, res, "small.txt"); s.TooLarge || !strings.Contains(s.Diff, "+s2\n") {
		t.Errorf("small.txt = %+v", s)
	}
}

// Paths are cwd-relative and scoped to cwd's subtree, like the file list's (GetChanges --relative), so
// a file in the list names a section that exists.
func TestReviewPatchSubdir(t *testing.T) {
	dir := initRepo(t)
	if err := os.MkdirAll(filepath.Join(dir, "svc"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, dir, "root.txt", "r\n")
	writeFile(t, dir, "svc/x.txt", "x\n")
	commitAll(t, dir)
	writeFile(t, dir, "root.txt", "r2\n")
	writeFile(t, dir, "svc/x.txt", "x2\n")
	writeFile(t, dir, "svc/new.txt", "n\n")

	res, err := ReviewPatch(context.Background(), filepath.Join(dir, "svc"), "", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got := reviewPaths(res); strings.Join(got, ",") != "new.txt,x.txt" {
		t.Fatalf("paths = %v, want [new.txt x.txt]", got)
	}
}

func TestReviewPatchSplitReadsHeaderPaths(t *testing.T) {
	out := "diff --git a/my dir/x b/y.txt b/my dir/x b/y.txt\n--- a/my dir/x b/y.txt\n+++ b/my dir/x b/y.txt\n@@ -1 +1 @@\n-a\n+diff --git a/z b/z\n" +
		"diff --git \"a/q\\\"uote.txt\" \"b/q\\\"uote.txt\"\nnew file mode 100644\n" +
		"diff --git a/old name.txt b/new name.txt\nsimilarity index 100%\nrename from old name.txt\nrename to new name.txt\n"
	files := splitPatch(out)
	if len(files) != 3 {
		t.Fatalf("split into %d files, want 3: %+v", len(files), files)
	}
	if files[0].Path != "my dir/x b/y.txt" || !strings.HasSuffix(files[0].Diff, "+diff --git a/z b/z\n") {
		t.Errorf("file 0 = %+v", files[0])
	}
	if files[1].Path != `q"uote.txt` {
		t.Errorf("file 1 path = %q", files[1].Path)
	}
	if files[2].Path != "new name.txt" || files[2].OldPath != "old name.txt" {
		t.Errorf("file 2 = %+v", files[2])
	}
}

func TestReviewPatchNotARepo(t *testing.T) {
	res, err := ReviewPatch(context.Background(), t.TempDir(), "", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if res.IsRepo || len(res.Files) != 0 {
		t.Fatalf("non-repo = %+v", res)
	}
}

func TestBranchBaseIsTheMergeBaseWithLocalMain(t *testing.T) {
	dir := repoDiverged(t)
	gitAuthored(t, dir, "checkout", "feature")
	branch, mb, err := BranchBase(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if branch != "main" {
		t.Errorf("branch = %q, want main", branch)
	}
	want := gitRun(t, dir, "rev-list", "--max-parents=0", "HEAD")
	if mb != want {
		t.Errorf("merge base = %q, want the root commit %q", mb, want)
	}
	ch, err := GetChanges(context.Background(), dir, mb)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(ch.Numstat, "f1.txt") || !strings.Contains(ch.Numstat, "f2.txt") || strings.Contains(ch.Numstat, "m1.txt") {
		t.Errorf("branch changes = %q, want f1.txt and f2.txt and not main's m1.txt", ch.Numstat)
	}
}

func TestBranchBaseWithNoDefaultBranch(t *testing.T) {
	dir := t.TempDir()
	gitAuthored(t, dir, "init", "--initial-branch=trunk")
	commitAuthored(t, dir, "a.txt", "a\n", "one")
	branch, mb, err := BranchBase(context.Background(), dir)
	if err != nil || branch != "" || mb != "" {
		t.Errorf("BranchBase = (%q, %q, %v), want empty", branch, mb, err)
	}
}

// Commit runs git without the test env's author vars, so the repo carries its own identity.
func commitRepo(t *testing.T) string {
	t.Helper()
	dir := repoWithChange(t) // a.txt committed then modified, b.txt untracked
	git(t, dir, "config", "user.name", "t")
	git(t, dir, "config", "user.email", "t@t")
	return dir
}

func headFiles(t *testing.T, dir string) string {
	t.Helper()
	out, err := exec.Command("git", "-C", dir, "show", "--name-only", "--format=", "HEAD").Output()
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(out))
}

// gitOutT is git's trimmed stdout, failing the test when git does.
func gitOutT(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).Output()
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return strings.TrimSpace(string(out))
}

func TestCommitOnlyLeavesOtherStagedPaths(t *testing.T) {
	dir := commitRepo(t)
	os.WriteFile(filepath.Join(dir, "c.txt"), []byte("staged by another session\n"), 0o644)
	git(t, dir, "add", "c.txt")
	r, err := Commit(context.Background(), dir, "edit a", []string{"a.txt"}, false)
	if err != nil || r.Failure != nil {
		t.Fatalf("commit: %v %+v", err, r)
	}
	if got := headFiles(t, dir); got != "a.txt" {
		t.Fatalf("HEAD carries %q, want only a.txt", got)
	}
	staged, _ := exec.Command("git", "-C", dir, "diff", "--cached", "--name-only").Output()
	if strings.TrimSpace(string(staged)) != "c.txt" {
		t.Fatalf("index lost another session's staging: %q", staged)
	}
}

func TestCommitAddsUntracked(t *testing.T) {
	dir := commitRepo(t)
	r, err := Commit(context.Background(), dir, "add b", []string{"b.txt"}, false)
	if err != nil || r.Failure != nil || r.Hash == "" {
		t.Fatalf("commit: %v %+v", err, r)
	}
	if got := headFiles(t, dir); got != "b.txt" {
		t.Fatalf("HEAD carries %q, want b.txt", got)
	}
}

func TestCommitRefusesAPathWithNoChange(t *testing.T) {
	dir := commitRepo(t)
	before, _ := exec.Command("git", "-C", dir, "rev-parse", "HEAD").Output()
	r, err := Commit(context.Background(), dir, "nope", []string{"nope.txt"}, false)
	if err != nil || r.Failure == nil {
		t.Fatalf("want a Failure, got %v %+v", err, r)
	}
	after, _ := exec.Command("git", "-C", dir, "rev-parse", "HEAD").Output()
	if string(before) != string(after) {
		t.Fatal("HEAD moved on a refused commit")
	}
}

func TestCommitRefusesAnEmptyMessageAndNoPaths(t *testing.T) {
	dir := commitRepo(t)
	if r, err := Commit(context.Background(), dir, "  \n", []string{"a.txt"}, false); err != nil || r.Failure == nil {
		t.Fatalf("an empty message must be refused, got %v %+v", err, r)
	}
	if r, err := Commit(context.Background(), dir, "msg", nil, false); err != nil || r.Failure == nil {
		t.Fatalf("no paths must be refused, got %v %+v", err, r)
	}
}

func TestCommitHookFailureIsData(t *testing.T) {
	dir := commitRepo(t)
	hook := filepath.Join(dir, ".git", "hooks", "pre-commit")
	os.WriteFile(hook, []byte("#!/bin/sh\necho 'lint failed' >&2\nexit 1\n"), 0o755)
	r, err := Commit(context.Background(), dir, "edit a", []string{"a.txt"}, false)
	if err != nil || r.Failure == nil || !strings.Contains(r.Failure.Stderr, "lint failed") {
		t.Fatalf("want the hook's words in Failure, got %v %+v", err, r)
	}
}

func TestCommitRename(t *testing.T) {
	dir := commitRepo(t)
	git(t, dir, "mv", "a.txt", "renamed.txt")
	r, err := Commit(context.Background(), dir, "rename a", []string{"renamed.txt", "a.txt"}, false)
	if err != nil || r.Failure != nil {
		t.Fatalf("commit: %v %+v", err, r)
	}
	out := gitOutT(t, dir, "show", "--name-status", "-M", "--format=", "HEAD")
	if !strings.HasPrefix(out, "R") || !strings.Contains(out, "a.txt") || !strings.Contains(out, "renamed.txt") {
		t.Fatalf("HEAD should record the rename, got %q", out)
	}
	if st := gitOutT(t, dir, "status", "--porcelain", "--", "a.txt", "renamed.txt"); st != "" {
		t.Fatalf("both ends should be committed, status %q", st)
	}
}

func TestCommitFailureUnstagesAddedPaths(t *testing.T) {
	dir := commitRepo(t)
	hook := filepath.Join(dir, ".git", "hooks", "pre-commit")
	os.WriteFile(hook, []byte("#!/bin/sh\nexit 1\n"), 0o755)
	r, err := Commit(context.Background(), dir, "add b", []string{"b.txt"}, false)
	if err != nil || r.Failure == nil {
		t.Fatalf("want a Failure, got %v %+v", err, r)
	}
	if st := gitOutT(t, dir, "status", "--porcelain", "--", "b.txt"); st != "?? b.txt" {
		t.Fatalf("a failed commit must leave b.txt untracked, status %q", st)
	}
}

// A path is a name, not a pattern: ticking "[a].txt" must not also commit a.txt, which a glob would match.
func TestCommitTreatsPathsLiterally(t *testing.T) {
	dir := commitRepo(t)
	os.WriteFile(filepath.Join(dir, "[a].txt"), []byte("bracketed\n"), 0o644)
	r, err := Commit(context.Background(), dir, "add bracketed", []string{"[a].txt"}, false)
	if err != nil || r.Failure != nil {
		t.Fatalf("commit: %v %+v", err, r)
	}
	if got := headFiles(t, dir); got != "[a].txt" {
		t.Fatalf("HEAD carries %q, want only [a].txt", got)
	}
	if st := gitOutT(t, dir, "status", "--porcelain", "--", "a.txt"); st != "M a.txt" {
		t.Fatalf("a.txt must stay an unstaged change, status %q", st)
	}
}

func TestCommitFromASubdirectory(t *testing.T) {
	dir := commitRepo(t)
	sub := filepath.Join(dir, "sub")
	os.MkdirAll(sub, 0o755)
	os.WriteFile(filepath.Join(sub, "n.txt"), []byte("nested\n"), 0o644)
	r, err := Commit(context.Background(), sub, "add n", []string{"n.txt"}, false)
	if err != nil || r.Failure != nil {
		t.Fatalf("commit: %v %+v", err, r)
	}
	if got := headFiles(t, dir); got != "sub/n.txt" {
		t.Fatalf("HEAD carries %q, want sub/n.txt", got)
	}
}

func TestCommitAmendRewritesHead(t *testing.T) {
	dir := commitRepo(t)
	if r, _ := Commit(context.Background(), dir, "first", []string{"a.txt"}, false); r.Failure != nil {
		t.Fatal(r.Failure.Stderr)
	}
	r, err := Commit(context.Background(), dir, "first, reworded", []string{"b.txt"}, true)
	if err != nil || r.Failure != nil {
		t.Fatalf("amend: %v %+v", err, r)
	}
	msg, _ := CommitMessage(context.Background(), dir, "")
	if strings.TrimSpace(msg) != "first, reworded" {
		t.Fatalf("HEAD message %q", msg)
	}
	if got := headFiles(t, dir); got != "a.txt\nb.txt" {
		t.Fatalf("amended HEAD carries %q", got)
	}
}

func TestCommitMessageReadsHeadAndAnOlderCommit(t *testing.T) {
	dir := commitRepo(t)
	if r, _ := Commit(context.Background(), dir, "subject one\n\nbody of the first", []string{"a.txt"}, false); r.Failure != nil {
		t.Fatal(r.Failure.Stderr)
	}
	older := gitOutT(t, dir, "rev-parse", "HEAD")
	if r, _ := Commit(context.Background(), dir, "subject two", []string{"b.txt"}, false); r.Failure != nil {
		t.Fatal(r.Failure.Stderr)
	}
	head, err := CommitMessage(context.Background(), dir, "")
	if err != nil || strings.TrimSpace(head) != "subject two" {
		t.Fatalf("HEAD message = %q, %v", head, err)
	}
	old, err := CommitMessage(context.Background(), dir, older)
	if err != nil || strings.TrimSpace(old) != "subject one\n\nbody of the first" {
		t.Fatalf("older message = %q, %v", old, err)
	}
}

func TestCommitMessageRefusesAnOptionShapedRef(t *testing.T) {
	dir := commitRepo(t)
	if msg, err := CommitMessage(context.Background(), dir, "--output=x.txt"); err == nil || msg != "" {
		t.Fatalf("want a refusal, got %q, %v", msg, err)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "x.txt")); statErr == nil {
		t.Fatal("the option reached git and wrote a file")
	}
}
