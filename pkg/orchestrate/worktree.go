package orchestrate

import (
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
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

var ErrNotGitRepo = errors.New("not a git repo")

// worktreeDir is the per-run linked-worktree root inside the project.
func worktreeDir(projectPath, runID string) string {
	return filepath.Join(projectPath, ".waveterm", "worktrees", runID)
}

func git(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git %v: %w: %s", args, err, dropProgress(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
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

// addWorktree runs `git worktree add` in project. A tree nests the checkout under .waveterm\worktrees\<key>\, so on
// Windows a path that fits under MAX_PATH in the project can pass it in the tree; core.longpaths, set in the repo
// config rather than per command, lets the worker's own git in the tree reach those paths too.
func addWorktree(ctx context.Context, project string, args ...string) (string, error) {
	if runtime.GOOS == "windows" {
		// a value set at any level, false included, is the user's choice
		if _, err := git(ctx, project, "config", "--get", "core.longpaths"); err != nil {
			if _, err := gitLocked(ctx, project, "config", "core.longpaths", "true"); err != nil {
				return "", fmt.Errorf("enabling long paths: %w", err)
			}
		}
	}
	return gitLocked(ctx, project, append([]string{"worktree", "add"}, args...)...)
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

// CreateRunWorktree links a worktree at <project>/.waveterm/worktrees/<runID> on branch
// wave/<runID>, checked out at baseCommit (empty = current branch head).
func CreateRunWorktree(ctx context.Context, projectPath, runID, baseCommit string) (string, error) {
	if !IsGitRepo(projectPath) {
		return "", ErrNotGitRepo
	}
	wt := worktreeDir(projectPath, runID)
	args := []string{"-b", "wave/" + runID, wt}
	if baseCommit != "" {
		args = append(args, baseCommit)
	}
	if _, err := addWorktree(ctx, projectPath, args...); err != nil {
		return "", fmt.Errorf("creating worktree: %w", err)
	}
	return wt, nil
}

// RemoveRunWorktree removes the linked worktree and its branch.
func RemoveRunWorktree(ctx context.Context, projectPath, runID string) error {
	wt := worktreeDir(projectPath, runID)
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
// whether this call created the tree, so one-time preparation runs only on a fresh tree. An existing branch
// is continued, never discarded: its commits are the finished tasks earlier in the lane, or an earlier
// attempt's work, which the next task builds on and the lane's merge lands. A clean tree on the branch is
// reused; a dirty one has its uncommitted state dumped to a recovery patch, and a dirty or missing one is
// checked out again from the branch. With no branch, the tree is created at baseCommit.
func EnsureRunWorktree(ctx context.Context, projectPath, runID, baseCommit string) (string, string, bool, error) {
	wt := worktreeDir(projectPath, runID)
	_, statErr := os.Stat(wt)
	head, headErr := WorktreeHeadCommit(ctx, projectPath, runID)
	if headErr != nil {
		if statErr == nil {
			DumpRecoveryPatch(ctx, projectPath, runID, baseCommit) // best effort; rebuild proceeds either way
			if err := RemoveRunWorktree(ctx, projectPath, runID); err != nil {
				return "", "", false, fmt.Errorf("recreating stale worktree: %w", err)
			}
		}
		if _, err := CreateRunWorktree(ctx, projectPath, runID, baseCommit); err != nil {
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
			return "", "", false, fmt.Errorf("recreating worktree: %w", err)
		}
	}
	// a registration whose directory is already gone makes the add refuse
	if _, err := gitLocked(ctx, projectPath, "worktree", "prune"); err != nil {
		return "", "", false, fmt.Errorf("pruning worktrees: %w", err)
	}
	if _, err := addWorktree(ctx, projectPath, wt, "wave/"+runID); err != nil {
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
	wt := worktreeDir(projectPath, runID)
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
