package orchestrate

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

var ErrNotGitRepo = errors.New("not a git repo")

// gitWaitDelay bounds the wait for a git command's output pipe once its process has exited or its context has
// ended. A var for tests.
var gitWaitDelay = planCommandWaitDelay

func git(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	// without it the call waits for the pipe, not the process: a descendant git left behind (a hook, a helper)
	// holds the pipe open past git's exit and past the context, and most callers hold a dag lock
	cmd.WaitDelay = gitWaitDelay
	// a caller parses stdout; git's warnings go to stderr, and mixed in they corrupt a parsed list (an autocrlf
	// warning hid an unstaged edit from the land's overlap check). A failure carries both: a caller matches
	// git's stdout too, such as merge's CONFLICT lines.
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	// git itself exited 0 and its output is read; only the abandoned pipe was cut
	if errors.Is(err, exec.ErrWaitDelay) {
		err = nil
	}
	if err != nil {
		return "", fmt.Errorf("git %v: %w: %s", args, err, dropProgress(stdout.String()+"\n"+stderr.String()))
	}
	return strings.TrimSpace(stdout.String()), nil
}

var gitProgressLine = regexp.MustCompile(`^\s*[A-Za-z ]+:\s+\d+% \(\d+/\d+\)`)

// dropProgress strips git's "Updating files:  7% (1016/13562)" meter from an error's output: a large checkout's
// meter fills the bounded error detail and cuts off the line that says what failed.
func dropProgress(out string) string {
	var kept []string
	for _, line := range strings.FieldsFunc(out, func(r rune) bool { return r == '\r' || r == '\n' }) {
		if !gitProgressLine.MatchString(line) {
			kept = append(kept, strings.TrimSpace(line))
		}
	}
	return strings.Join(kept, "\n")
}

// addWorktree runs `git worktree add <opts> <wt> [<commitish>]` in project. A tree's root (worktreeDir) can be longer
// than the project's, so on Windows a path that fits under MAX_PATH in the project can pass it in the tree;
// core.longpaths, set in the repo config rather than per command, lets the worker's own git in the tree reach those
// paths too.
//
// A project that is a folder inside its repo (apps/portal in a monorepo) gets a sparse tree of that folder: checking
// out all 14,000 files of such a repo took five minutes under memory pressure, past the launcher's deadline, and
// cancelled the run (0f769259). Cone mode keeps the files at the repo root and in each folder above the project, and
// a merge still carries a lane's changes outside the cone; only staging a path outside it in the tree is refused.
func addWorktree(ctx context.Context, project, wt string, opts []string, commitish string) (string, error) {
	if runtime.GOOS == "windows" {
		// a value set at any level, false included, is the user's choice
		if _, err := git(ctx, project, "config", "--get", "core.longpaths"); err != nil {
			if _, err := gitLocked(ctx, project, "config", "core.longpaths", "true"); err != nil {
				return "", fmt.Errorf("enabling long paths: %w", err)
			}
		}
	}
	_, prefix, perr := repoTop(ctx, project)
	sparse := perr == nil && prefix != ""
	args := append([]string{"worktree", "add"}, opts...)
	if sparse {
		args = append(args, "--no-checkout")
	}
	args = append(args, wt)
	if commitish != "" {
		args = append(args, commitish)
	}
	// one hold: sparse-checkout writes the repo config (extensions.worktreeConfig), which a concurrent git can fail on
	repoAdminMu.Lock()
	defer repoAdminMu.Unlock()
	out, err := git(ctx, project, args...)
	if err != nil || !sparse {
		return out, err
	}
	if _, serr := git(ctx, wt, "sparse-checkout", "set", "--cone", strings.TrimSuffix(prefix, "/")); serr != nil {
		log.Printf("worktree %s: a sparse checkout of %s failed, so it checks out the whole repo: %v", wt, prefix, serr)
	}
	// --no-checkout left the index empty: the reset fills it and the tree, within the cone when the set took
	if _, err := git(ctx, wt, "reset", "-q", "--hard"); err != nil {
		return "", fmt.Errorf("checking out %s: %w", wt, err)
	}
	return out, nil
}

// repoAdminMu serializes the engine's git commands that change a repo's worktree registry and its branches. git does
// not lock the registry: an add or a list reads every registered tree's admin dir and fails when a concurrent remove
// has half-deleted one ("failed to read .git/worktrees/<name>/commondir"), which stopped a bisect and blamed the
// wrong lane.
var repoAdminMu sync.Mutex

func gitLocked(ctx context.Context, dir string, args ...string) (string, error) {
	repoAdminMu.Lock()
	defer repoAdminMu.Unlock()
	return git(ctx, dir, args...)
}

// IsGitRepo reports whether projectPath is inside a git working tree.
func IsGitRepo(projectPath string) bool {
	_, err := git(context.Background(), projectPath, "rev-parse", "--is-inside-work-tree")
	return err == nil
}

func ProjectHeadCommit(ctx context.Context, projectPath string) (string, error) {
	return git(ctx, projectPath, "rev-parse", "HEAD")
}

// TaskWorktreeKey derives a worktree key from a task: <owner run ID>-<task ID>. Tasks share their lane's
// tree, so spawn, merge, cleanup and the cancel sweep all key through LaneWorktreeKey, which calls this
// with the lane's first task.
func TaskWorktreeKey(ownerRunID, taskID string) string {
	return ownerRunID + "-" + taskID
}

// finalTreeKey follows the run id in the key of the tree the Final stage and the final verifier run in.
const finalTreeKey = "final"

func FinalWorktreeKey(ownerRunID string) string {
	return ownerRunID + "-" + finalTreeKey
}

// CreateRunWorktree links a worktree at claimLaneTreeDir(projectPath, runID) on branch wave/<runID>, checked out at
// baseCommit (empty = current branch head).
func CreateRunWorktree(ctx context.Context, projectPath, runID, baseCommit string) (string, error) {
	if !IsGitRepo(projectPath) {
		return "", ErrNotGitRepo
	}
	wt, err := claimLaneTreeDir(projectPath, runID)
	if err != nil {
		return "", fmt.Errorf("creating worktree: %w", err)
	}
	if _, err := addWorktree(ctx, projectPath, wt, []string{"-b", "wave/" + runID}, baseCommit); err != nil {
		return "", fmt.Errorf("creating worktree: %w", err)
	}
	return wt, nil
}

// RemoveRunWorktree removes the linked worktree and its branch.
func RemoveRunWorktree(ctx context.Context, projectPath, runID string) error {
	wt := laneTree(ctx, projectPath, runID)
	var err error
	// a tree already gone still leaves its branch: a skipped task's rewind removes the lane's tree
	if _, serr := os.Stat(wt); serr == nil {
		err = removeWorktreeDir(ctx, projectPath, wt)
	}
	// a process holding the directory fails its delete after git has unregistered the tree, which frees the
	// branch; a still-registered tree keeps it checked out, so it stays
	branch := "wave/" + runID
	if _, serr := git(ctx, projectPath, "show-ref", "--verify", "-q", "refs/heads/"+branch); serr == nil && !isWorktreeRegistered(ctx, projectPath, wt) {
		// update-ref, not branch -D: branch -D rewrites .git/config to drop the branch's section, which a wave
		// branch never has, and on Windows that rewrite fails any git reading the config at that moment
		if _, berr := gitLocked(ctx, projectPath, "update-ref", "-d", "refs/heads/"+branch); berr != nil && err == nil {
			log.Printf("removed worktree %s; deleting its branch %s: %v", wt, branch, berr)
		}
	}
	return err
}

// removeWorktreeDir unregisters and deletes a linked worktree's directory and keeps its branch.
func removeWorktreeDir(ctx context.Context, projectPath, wt string) error {
	// before git sees the tree: its forced removal deletes through a junction into the target
	if err := unlinkReparsePoints(wt); err != nil {
		return fmt.Errorf("removing worktree: %w", err)
	}
	if _, err := gitLocked(ctx, projectPath, "worktree", "remove", "--force", wt); err != nil {
		// On Windows the dir can remain locked by an idle child shell or by
		// junctioned node_modules/src-tauri/target/dist/bin. Git unregisters the
		// worktree before it deletes the tree, so a still-registered worktree is
		// a removal that never started and belongs to the caller.
		if isWorktreeRegistered(ctx, projectPath, wt) {
			return fmt.Errorf("removing worktree: %w", err)
		}
	}
	// unregistered is not removed: git drops the registration first and can then fail to delete the
	// directory. Finish the delete here and report what is on disk, never what git's exit code implied —
	// a directory reported as cleaned up and still present is worse than a cleanup that admits it failed.
	if _, err := os.Stat(wt); err != nil {
		return nil
	}
	if err := os.RemoveAll(wt); err != nil {
		return fmt.Errorf("removing worktree dir %s: %w", wt, err)
	}
	return nil
}

// RemoveWorktreeKeepBranch unregisters and deletes a linked worktree and keeps its branch: Settings → Storage
// cleans a finished run's leftover tree without touching the commits on wave/<runId>. RemoveRunWorktree, by
// contrast, deletes the branch too.
// It holds the tree's removal lock with TryLock, so it never removes a tree the engine is removing: ErrTreeBusy then.
// The lock is the key's, wherever its tree moved: a tree at a fresh path (<dir>.1) shares <dir>'s.
func RemoveWorktreeKeepBranch(ctx context.Context, projectPath, wt string) error {
	lock := strings.TrimSuffix(wt, treeDirAlt.FindString(wt))
	if !treeRemovals.TryLock(lock) {
		return ErrTreeBusy
	}
	defer treeRemovals.Unlock(lock)
	return removeWorktreeDir(ctx, projectPath, wt)
}

// RunOfWorktree is runOfWorktree for callers outside the engine: the run that owns a path in one of the engine's
// worktrees, ok false for a name the engine never makes.
func RunOfWorktree(path string) (runID string, ok bool) {
	id, _, ok := runOfWorktree(path)
	return id, ok
}

// leftBehind reports whether a failed removal of wt got through git: the tree is unregistered, which frees its
// branch, and only the directory, held by a process, is left. On Windows a directory a process holds as its cwd can
// be neither deleted nor renamed, so the branch is checked out at a fresh path and the directory becomes cleanup
// debt (laneLeftovers).
func leftBehind(ctx context.Context, projectPath, wt string) bool {
	_, err := os.Stat(wt)
	return err == nil && !isWorktreeRegistered(ctx, projectPath, wt)
}

// laneTree is where wave/<key>'s tree is: the directory git has the branch checked out in, else worktreeDir, where
// a new one is created. A tree whose directory was left behind moves to a fresh path, so every step that reaches an
// existing tree resolves it here; git's registry is the one record of where it went.
func laneTree(ctx context.Context, projectPath, key string) string {
	out, err := gitLocked(ctx, projectPath, "worktree", "list", "--porcelain")
	if err == nil {
		branch := "branch refs/heads/wave/" + key
		var wt string
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimRight(line, "\r")
			if p, ok := strings.CutPrefix(line, "worktree "); ok {
				wt = p
			} else if line == branch && wt != "" {
				return filepath.Clean(wt)
			}
		}
	}
	return worktreeDir(projectPath, key)
}

// treeDirAlt matches the number a tree's fresh path adds to its directory's name: <dir>.1, <dir>.2.
var treeDirAlt = regexp.MustCompile(`\.[0-9]+$`)

// claimLaneTreeDir is claimWorktreeDir for a tree whose directory may have been left behind: the first of <dir>,
// <dir>.1, <dir>.2 ... not on disk.
func claimLaneTreeDir(projectPath, key string) (string, error) {
	dir, err := claimWorktreeDir(projectPath, key)
	if err != nil {
		return "", err
	}
	wt := dir
	for n := 1; ; n++ {
		_, err := os.Lstat(wt)
		if errors.Is(err, fs.ErrNotExist) {
			return wt, nil
		}
		if err != nil {
			return "", fmt.Errorf("checking worktree dir %s: %w", wt, err)
		}
		wt = dir + "." + strconv.Itoa(n)
	}
}

// laneLeftovers lists the directories removals of key's tree left behind: <dir> and its fresh paths that are on
// disk and that git does not list as a tree.
func laneLeftovers(ctx context.Context, projectPath, key string) []string {
	dir := worktreeDir(projectPath, key)
	entries, err := os.ReadDir(filepath.Dir(dir))
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("listing leftover trees of wave/%s: %v", key, err)
		}
		return nil
	}
	base := filepath.Base(dir)
	var out []string
	for _, e := range entries {
		rest, ok := strings.CutPrefix(e.Name(), base)
		if !e.IsDir() || !ok || (rest != "" && treeDirAlt.FindString(rest) != rest) {
			continue
		}
		path := filepath.Join(filepath.Dir(dir), e.Name())
		if !isWorktreeRegistered(ctx, projectPath, path) {
			out = append(out, path)
		}
	}
	return out
}

// removeLeftovers deletes the directories removals of key's tree left behind. git no longer lists any of them, so
// nothing in one is kept.
func removeLeftovers(ctx context.Context, projectPath, key string) error {
	var errs []error
	for _, dir := range laneLeftovers(ctx, projectPath, key) {
		// before the delete: os.RemoveAll would follow a junction into its target
		if err := unlinkReparsePoints(dir); err != nil {
			errs = append(errs, fmt.Errorf("removing left-behind worktree dir: %w", err))
			continue
		}
		if err := os.RemoveAll(dir); err != nil {
			errs = append(errs, fmt.Errorf("removing left-behind worktree dir %s: %w", dir, err))
		}
	}
	return errors.Join(errs...)
}

func isWorktreeRegistered(ctx context.Context, projectPath, wt string) bool {
	out, err := gitLocked(ctx, projectPath, "worktree", "list", "--porcelain")
	if err != nil {
		return true // can't tell — assume registered so caller surfaces the error
	}
	// porcelain lists "worktree <path>" per entry, with forward slashes on Windows
	for _, line := range strings.Split(out, "\n") {
		if p, ok := strings.CutPrefix(strings.TrimRight(line, "\r"), "worktree "); ok && strings.EqualFold(filepath.Clean(p), filepath.Clean(wt)) {
			return true
		}
	}
	return false
}

// unlinkReparsePoints removes every symlink and junction inside wt without following it. A junction
// reads as ModeIrregular rather than ModeSymlink, so both bits are checked; WalkDir does not descend
// into either.
func unlinkReparsePoints(wt string) error {
	return filepath.WalkDir(wt, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == wt || d.Type()&(fs.ModeSymlink|fs.ModeIrregular) == 0 {
			return nil
		}
		if err := os.Remove(path); err != nil {
			return fmt.Errorf("unlinking %s: %w", path, err)
		}
		return nil
	})
}

// EnsureRunWorktree returns a usable linked worktree for runID, the commit its next task starts at, and
// whether this call created the tree. Setup does not go by that: a reused tree may never have been set up
// (see treeSetUp). An existing branch
// is continued, never discarded: its commits are the finished tasks earlier in the lane, or an earlier
// attempt's work, which the next task builds on and the lane's merge lands. A clean tree on the branch is
// reused; a dirty one has its uncommitted state dumped to a recovery patch, and a dirty or missing one is
// checked out again from the branch. With no branch, the tree is created at baseCommit. A stale tree whose directory
// a process holds is left behind (leftBehind) and the tree checked out at a fresh path; the caller records the
// directory as cleanup debt.
func EnsureRunWorktree(ctx context.Context, projectPath, runID, baseCommit string) (string, string, bool, error) {
	wt := laneTree(ctx, projectPath, runID)
	_, statErr := os.Stat(wt)
	head, headErr := WorktreeHeadCommit(ctx, projectPath, runID)
	if headErr != nil {
		if statErr == nil {
			DumpRecoveryPatch(ctx, projectPath, runID, baseCommit) // best effort; rebuild proceeds either way
			if err := RemoveRunWorktree(ctx, projectPath, runID); err != nil {
				if !leftBehind(ctx, projectPath, wt) {
					return "", "", false, fmt.Errorf("recreating stale worktree: %w", err)
				}
				log.Printf("worktree %s left behind, checking wave/%s out at a fresh path: %v", wt, runID, err)
			}
		}
		// a removed legacy tree comes back under the short root, so the path is the one the claim returns
		wt, err := CreateRunWorktree(ctx, projectPath, runID, baseCommit)
		if err != nil {
			return "", "", false, err
		}
		created, err := WorktreeHeadCommit(ctx, projectPath, runID)
		if err != nil {
			return "", "", false, fmt.Errorf("reading new worktree head: %w", err)
		}
		return wt, created, true, nil
	}
	if statErr == nil {
		if worktreeOnBranch(ctx, wt, runID) {
			status, err := git(ctx, wt, "status", "--porcelain")
			if err == nil && strings.TrimSpace(status) == "" {
				return wt, head, false, nil
			}
			DumpRecoveryPatch(ctx, projectPath, runID, baseCommit) // best effort; rebuild proceeds either way
		}
		if err := removeWorktreeDir(ctx, projectPath, wt); err != nil {
			if !leftBehind(ctx, projectPath, wt) {
				return "", "", false, fmt.Errorf("recreating worktree: %w", err)
			}
			log.Printf("worktree %s left behind, checking wave/%s out at a fresh path: %v", wt, runID, err)
		}
	}
	// a registration whose directory is already gone makes the add refuse
	if _, err := gitLocked(ctx, projectPath, "worktree", "prune"); err != nil {
		return "", "", false, fmt.Errorf("pruning worktrees: %w", err)
	}
	wt, err := claimLaneTreeDir(projectPath, runID)
	if err != nil {
		return "", "", false, fmt.Errorf("checking out worktree from wave/%s: %w", runID, err)
	}
	if _, err := addWorktree(ctx, projectPath, wt, nil, "wave/"+runID); err != nil {
		return "", "", false, fmt.Errorf("checking out worktree from wave/%s: %w", runID, err)
	}
	return wt, head, true, nil
}

// checkLandingTree refuses a run whose landing tree is no longer its wave/<runId> checkout. git run in a
// leftover directory acts on the project checkout above it, which would land the run on the human's branch.
func checkLandingTree(ctx context.Context, owner *waveobj.Run) error {
	if owner.LandPath == "" || worktreeOnBranch(ctx, owner.LandPath, owner.ID) {
		return nil
	}
	return fmt.Errorf("landing tree %s is not a checkout of wave/%s: restore it with `git worktree prune && git worktree add %s wave/%s` from the project", owner.LandPath, owner.ID, owner.LandPath, owner.ID)
}

// landingTreeChanges lists the tracked files with uncommitted changes in a run's own landing tree, or with unstaged
// only those changed and not added. Nothing merges them, and the land removes the tree with them. Empty for a run
// landing in the checkout, whose uncommitted changes are the human's and other sessions', and for a tree that is gone.
func landingTreeChanges(ctx context.Context, run *waveobj.Run, unstaged bool) ([]string, error) {
	if run.LandPath == "" || !worktreeOnBranch(ctx, run.LandPath, run.ID) {
		return nil, nil
	}
	args := []string{"diff", "--name-only", "HEAD"}
	if unstaged {
		args = args[:2]
	}
	out, err := git(ctx, run.LandPath, args...)
	if err != nil {
		return nil, fmt.Errorf("listing uncommitted changes in the landing tree %s: %w", run.LandPath, err)
	}
	var files []string
	for _, line := range strings.Split(out, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			files = append(files, line)
		}
	}
	return files, nil
}

// landingHead is the commit a run's next lane is cut from. A run landing on its own branch reads the branch,
// which outlives its tree; one landing in the checkout reads the checkout's head.
func landingHead(ctx context.Context, owner *waveobj.Run) (string, error) {
	if owner.LandPath != "" {
		return WorktreeHeadCommit(ctx, owner.ProjectPath, owner.ID)
	}
	return ProjectHeadCommit(ctx, owner.ProjectPath)
}

// worktreeOnBranch reports whether wt is a checked-out tree of wave/<runID>. A directory whose registration
// git already dropped is not one, and git run inside it acts on the project checkout above it.
func worktreeOnBranch(ctx context.Context, wt, runID string) bool {
	branch, err := git(ctx, wt, "rev-parse", "--abbrev-ref", "HEAD")
	return err == nil && branch == "wave/"+runID
}

// DumpRecoveryPatch writes the worktree's own work to a patch file so a cancelled or recreated run's work
// is not silently lost: its branch's commits since it forked from landHead, the head lanes land on (empty
// = the project head), and uncommitted changes inside the linked tree. Diffing from the fork point keeps
// out the lanes that landed before it was cut and anything committed on landHead since.
func DumpRecoveryPatch(ctx context.Context, projectPath, runID, landHead string) error {
	return dumpRecoveryPatch(ctx, projectPath, runID, landHead, runID)
}

// dumpRecoveryPatch is DumpRecoveryPatch writing to recovery/<name>.patch.
func dumpRecoveryPatch(ctx context.Context, projectPath, runID, landHead, name string) error {
	if landHead == "" {
		landHead = "HEAD"
	}
	patch, err := git(ctx, projectPath, "diff", landHead+"...wave/"+runID)
	if err != nil {
		return err
	}
	wt := laneTree(ctx, projectPath, runID)
	// a leftover directory git no longer knows as the branch's tree is not one: git run there stages the project checkout
	if worktreeOnBranch(ctx, wt, runID) {
		// dump paths are discard/rebuild paths, so staging here is safe — and it pulls untracked
		// files into the diff, which plain `diff HEAD` would silently drop
		git(ctx, wt, "add", "-A")
		dirty, derr := git(ctx, wt, "diff", "--cached", "HEAD")
		if derr == nil && strings.TrimSpace(dirty) != "" {
			patch += "\n" + dirty
		}
	}
	recDir := filepath.Join(projectPath, ".waveterm", "recovery")
	if err := os.MkdirAll(recDir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(recDir, name+".patch"), []byte(patch), 0o644)
}

// WorktreeHeadCommit returns the worktree branch's HEAD sha.
func WorktreeHeadCommit(ctx context.Context, projectPath, runID string) (string, error) {
	return git(ctx, projectPath, "rev-parse", "wave/"+runID)
}
