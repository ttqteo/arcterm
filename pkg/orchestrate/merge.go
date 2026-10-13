package orchestrate

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
)

var ErrMergeConflict = errors.New("merge conflict")

// runTrailer names the lane a squash commit landed, which is how a retried merge recognizes its own commit.
const runTrailer = jarvis.RunTrailerKey

// taskTrailer names each task a squash commit landed, so `git log --grep Arc-Task` finds a task's commit even
// when its lane landed several tasks as one.
const taskTrailer = "Arc-Task"

// modelTrailer names the harness and model behind each task a squash commit landed, so blaming a later fix
// reaches the model that wrote the line after the run and its transcripts are gone.
const modelTrailer = "Arc-Model"

// MergeLane is what a lane's squash commit names: Title is its task titles, joined, and TaskIDs the tasks it
// lands. Skipped tasks are in neither, since they landed nothing. Routes is "<task> <harness> [model]" for each
// task whose worker run is known.
type MergeLane struct {
	Title   string
	TaskIDs []string
	Routes  []string
}

// MergeRunWorktree squash-merges wave/<runID> into the project branch and returns the merge commit
// sha, or "" when the branch had nothing to land. The commit carries the branch's own commit messages;
// lane's title stands in only when they are empty. fold names uncommitted files in the project checkout that
// belong in the same commit: the run's spec and plan, on its first merge. Worktree removal is the caller's step (CleanupTaskWorktree) so a cleanup
// failure can never obscure an already-landed merge. On conflict the tree is left mid-merge
// (ErrMergeConflict) and the caller resolves then calls MergeContinue.
func MergeRunWorktree(ctx context.Context, projectPath, runID string, lane MergeLane, fold []string) (string, error) {
	if !IsGitRepo(projectPath) {
		return "", ErrNotGitRepo
	}
	branch := "wave/" + runID
	// Idempotency: if the branch is already gone, the squash commit landed on a
	// prior attempt that failed only on worktree cleanup. Return that commit without
	// re-merging so the caller can still stamp Merged/EndCommit and clean up.
	if _, err := git(ctx, projectPath, "rev-parse", "--verify", branch); err != nil {
		if sha, gerr := landedHead(ctx, projectPath, runID); gerr == nil {
			return sha, nil
		}
		return "", fmt.Errorf("squash merge: %w", err)
	}
	if _, err := git(ctx, projectPath, "merge", "--squash", branch); err != nil {
		if strings.Contains(err.Error(), "CONFLICT") {
			return "", ErrMergeConflict
		}
		// the branch is an ancestor of HEAD: it has no commit of its own to land
		if strings.Contains(err.Error(), "Already up to date") {
			if sha, gerr := landedHead(ctx, projectPath, runID); gerr == nil {
				return sha, nil
			}
		}
		return "", fmt.Errorf("squash merge: %w", err)
	}
	return finishMerge(ctx, projectPath, runID, lane, fold, false)
}

// MergeContinue completes a merge after the caller resolved conflicts in the project tree.
func MergeContinue(ctx context.Context, projectPath, runID string, lane MergeLane, fold []string) (string, error) {
	status, err := git(ctx, projectPath, "status", "--porcelain")
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(status, "\n") {
		if strings.HasPrefix(line, "UU ") || strings.HasPrefix(line, "AA ") || strings.HasPrefix(line, "DD ") {
			return "", fmt.Errorf("unresolved conflict: %s", line)
		}
	}
	return finishMerge(ctx, projectPath, runID, lane, fold, true)
}

// finishMerge stages fold after the squash, where the automatic path's clean-index check is already behind
// it, then commits. A path git refuses to stage, because it is ignored or outside the repository, is logged
// and left out: the docs are not worth failing a merge over. resolved is a continue after a conflict, whose
// resolver may already have committed the result under a message of their own.
func finishMerge(ctx context.Context, projectPath, runID string, lane MergeLane, fold []string, resolved bool) (string, error) {
	for _, path := range fold {
		staged, err := foldIntoTree(ctx, projectPath, path)
		if err == nil {
			_, err = git(ctx, projectPath, "add", "--", staged)
		}
		if err != nil {
			log.Printf("merge %s: not committing %s with the squash: %v", runID, path, err)
		}
	}
	if _, err := git(ctx, projectPath, "commit", "-m", mergeMessage(ctx, projectPath, runID, lane)); err != nil {
		// "nothing to commit": the resolver's own commit, a retry whose squash commit already landed on the
		// prior attempt, or a branch whose commits change nothing
		if strings.Contains(err.Error(), "nothing to commit") || strings.Contains(err.Error(), "no changes added") || strings.Contains(err.Error(), "nothing added") {
			if resolved {
				return git(ctx, projectPath, "rev-parse", "HEAD")
			}
			return landedHead(ctx, projectPath, runID)
		}
		return "", fmt.Errorf("merge commit: %w", err)
	}
	return git(ctx, projectPath, "rev-parse", "HEAD")
}

// foldIntoTree returns the path to stage for a fold doc. A run landing on its own branch merges in a tree
// other than the checkout its plan was written in, so a doc from another tree of the same repository is
// copied to its repo-relative path in tree first. That holds for a checkout run whose plan was written in
// another worktree too: the doc lands with the run's first merge. A file already at that path is never
// replaced.
func foldIntoTree(ctx context.Context, tree, path string) (string, error) {
	target, err := treeTarget(ctx, tree, path)
	if err != nil || target == path {
		return target, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	// the squash has already put the lane's version there, and that is the run's work
	if existing, err := os.ReadFile(target); err == nil {
		if !bytes.Equal(existing, data) {
			return "", fmt.Errorf("%s already exists with different content", target)
		}
		return target, nil
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return "", err
	}
	return target, os.WriteFile(target, data, 0o644)
}

// mergeMessage is the branch's commit messages, oldest first, each once and without agent attribution,
// then the run trailer and one task trailer per landed task. The branch always starts at a commit on the
// project branch, so HEAD..branch is exactly its workers' commits. A lane of several tasks takes its title
// as the subject, since any one worker's subject names only that worker's task, cut to a subject line as a land
// title is: two task titles joined run past it, typed from the workers' subjects. A one-task lane falls back to
// the title only when the messages are empty or unreadable.
func mergeMessage(ctx context.Context, projectPath, runID string, lane MergeLane) string {
	var msgs, subjects []string
	out, err := git(ctx, projectPath, "log", "--reverse", "--format=%B%x00", "HEAD..wave/"+runID)
	if err != nil {
		log.Printf("merge %s: reading the branch's commit messages: %v", runID, err)
	}
	for _, m := range strings.Split(out, "\x00") {
		if m = stripAttribution(m); m != "" && !slices.Contains(msgs, m) {
			msgs = append(msgs, m)
			subjects = append(subjects, firstLine(m))
		}
	}
	if len(lane.TaskIDs) > 1 || len(msgs) == 0 {
		msgs = append([]string{conventionalTitle(firstLine(lane.Title), subjects)}, msgs...)
	}
	trailers := []string{runTrailer + ": " + runID}
	for _, id := range lane.TaskIDs {
		trailers = append(trailers, taskTrailer+": "+id)
	}
	for _, r := range lane.Routes {
		trailers = append(trailers, modelTrailer+": "+r)
	}
	return strings.Join(msgs, "\n\n") + "\n\n" + strings.Join(trailers, "\n")
}

// attributionPrefixes start the credit lines an agent harness appends to its commits. The project never
// credits the agent, and a worker's harness adds them regardless of the project's rules.
var attributionPrefixes = []string{"co-authored-by: claude", "claude-session:", "🤖 generated with [claude code]"}

func stripAttribution(msg string) string {
	var kept []string
	for _, line := range strings.Split(msg, "\n") {
		l := strings.ToLower(strings.TrimSpace(line))
		if !slices.ContainsFunc(attributionPrefixes, func(p string) bool { return strings.HasPrefix(l, p) }) {
			kept = append(kept, line)
		}
	}
	return strings.TrimSpace(strings.Join(kept, "\n"))
}

// landedHead is HEAD when it is this branch's squash commit, and "" otherwise. A merge that commits nothing
// finds some other commit at HEAD, the previous lane's or a human's, and crediting the branch with it
// overstates what landed.
func landedHead(ctx context.Context, projectPath, runID string) (string, error) {
	out, err := git(ctx, projectPath, "log", "-1", "--format=%H %(trailers:key="+runTrailer+",valueonly)")
	if err != nil {
		return "", err
	}
	sha, landed, _ := strings.Cut(out, " ")
	if strings.TrimSpace(landed) != runID {
		return "", nil
	}
	return sha, nil
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if idx := strings.Index(s, "\n"); idx >= 0 {
		s = s[:idx]
	}
	s = strings.TrimSpace(s)
	if len(s) > 200 {
		s = s[:200]
	}
	if s == "" {
		return "merge"
	}
	return s
}
