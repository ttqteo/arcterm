package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestMergeSquash(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, _ := CreateRunWorktree(context.Background(), dir, "run-1", base)
	os.WriteFile(filepath.Join(wt, "feature.txt"), []byte("feat\n"), 0o644)
	gitCmd(t, wt, "add", ".")
	gitCmd(t, wt, "commit", "-m", "feature")
	sha, err := MergeRunWorktree(context.Background(), dir, "run-1", MergeLane{Title: "do the thing"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "feature.txt")); err != nil {
		t.Fatalf("merged file missing: %v", err)
	}
	if len(sha) != 40 {
		t.Fatalf("bad merge sha %q", sha)
	}
	// integration is separate from resource cleanup: the worktree stays until the caller
	// runs CleanupTaskWorktree, so a cleanup failure can never obscure an already-landed merge.
	if _, err := os.Stat(wt); err != nil {
		t.Fatalf("worktree removal must be left to the cleanup helper: %v", err)
	}
}

// a lane lands under the messages its workers wrote, oldest first and each once, not the plan's task titles,
// without the agent's attribution; the lane and its task are named in trailers
func TestMergeSquashKeepsTheWorkersCommitMessages(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, _ := CreateRunWorktree(context.Background(), dir, "run-1", base)
	attributed := "feat(x): add the feature\n\nwhy it exists\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_1"
	for i, msg := range []string{attributed, "docs: record the feature", "docs: record the feature"} {
		os.WriteFile(filepath.Join(wt, fmt.Sprintf("f%d.txt", i)), []byte("x\n"), 0o644)
		gitCmd(t, wt, "add", ".")
		gitCmd(t, wt, "commit", "-m", msg)
	}
	if _, err := MergeRunWorktree(context.Background(), dir, "run-1", MergeLane{Title: "Add the feature", TaskIDs: []string{"t-1"}}, nil); err != nil {
		t.Fatal(err)
	}
	want := "feat(x): add the feature\n\nwhy it exists\n\ndocs: record the feature\n\nArc-Run: run-1\nArc-Task: t-1"
	if got := gitCmd(t, dir, "log", "-1", "--format=%B"); got != want {
		t.Fatalf("squash message = %q, want %q", got, want)
	}
}

// one worker's subject names only its own task, so a lane of several lands under their titles, with the
// workers' messages as the body and a task and model trailer per task; a retry still finds the commit by its run trailer
func TestMergeSquashOfASeveralTaskLaneNamesEveryTask(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, _ := CreateRunWorktree(context.Background(), dir, "run-1", base)
	for i, msg := range []string{"feat(schema): add the table", "feat(ui): show the table"} {
		os.WriteFile(filepath.Join(wt, fmt.Sprintf("f%d.txt", i)), []byte("x\n"), 0o644)
		gitCmd(t, wt, "add", ".")
		gitCmd(t, wt, "commit", "-m", msg)
	}
	lane := MergeLane{Title: "schema; ui", TaskIDs: []string{"t-1", "t-4"}, Routes: []string{"t-1 claude claude-opus-5-5", "t-4 pi opencode-go/deepseek-v4-flash"}}
	landed, err := MergeRunWorktree(context.Background(), dir, "run-1", lane, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := "feat: schema; ui\n\nfeat(schema): add the table\n\nfeat(ui): show the table\n\nArc-Run: run-1\nArc-Task: t-1\nArc-Task: t-4\nArc-Model: t-1 claude claude-opus-5-5\nArc-Model: t-4 pi opencode-go/deepseek-v4-flash"
	if got := gitCmd(t, dir, "log", "-1", "--format=%B"); got != want {
		t.Fatalf("squash message = %q, want %q", got, want)
	}
	if sha, err := MergeRunWorktree(context.Background(), dir, "run-1", lane, nil); err != nil || sha != landed {
		t.Fatalf("retry: want %s, got %q (%v)", landed, sha, err)
	}
}

// run 33880f82's t-2 + t-3 lane joined two task titles into a ~150-character subject; the body still names both
func TestMergeSquashOfASeveralTaskLaneCutsItsSubjectLine(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, _ := CreateRunWorktree(context.Background(), dir, "run-1", base)
	for i, msg := range []string{"feat(orchestrate): show how long a merge gate has sat", "feat(cockpit): show a waiting merge gate"} {
		os.WriteFile(filepath.Join(wt, fmt.Sprintf("f%d.txt", i)), []byte("x\n"), 0o644)
		gitCmd(t, wt, "add", ".")
		gitCmd(t, wt, "commit", "-m", msg)
	}
	title := "F16 — the digest carries the merge gate's clock; `dag status` shows its age; F16 — the lead card shows a waiting merge gate and its age"
	if _, err := MergeRunWorktree(context.Background(), dir, "run-1", MergeLane{Title: title, TaskIDs: []string{"t-2", "t-3"}}, nil); err != nil {
		t.Fatal(err)
	}
	subject := gitCmd(t, dir, "log", "-1", "--format=%s")
	if n := utf8.RuneCountInString(subject); n > maxLandTitleLen || !strings.HasPrefix(subject, "feat: F16 — the digest carries") {
		t.Fatalf("subject = %q (%d runes), want the lane title cut to %d", subject, n, maxLandTitleLen)
	}
	body := gitCmd(t, dir, "log", "-1", "--format=%b")
	for _, want := range []string{"feat(cockpit): show a waiting merge gate", "Arc-Task: t-2", "Arc-Task: t-3"} {
		if !strings.Contains(body, want) {
			t.Fatalf("body lost %q:\n%s", want, body)
		}
	}
}

// a skipped task landed nothing, so the squash commit names it neither in its subject nor in a trailer
func TestMergeLaneLeavesOutSkippedTasks(t *testing.T) {
	g := laneGroup(t, true, map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Skipped, "t-3": TaskState_Done})
	want := MergeLane{Title: "schema; ui", TaskIDs: []string{"t-1", "t-3"}}
	if got := mergeLane(context.Background(), g, []string{"t-1", "t-2", "t-3"}); !reflect.DeepEqual(got, want) {
		t.Fatalf("lane = %+v, want %+v", got, want)
	}
}

// the model trailer names the run behind each task, its pinned model when no transcript reports one, and leaves
// out a task whose run is gone rather than failing the merge
func TestMergeLaneNamesEachTasksWorkerRoute(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "mergelane-"+uuid.NewString(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	g := laneGroup(t, true, map[string]string{"t-1": TaskState_Done, "t-2": TaskState_Done, "t-3": TaskState_Done})
	g.ChannelId = ch.OID
	for _, r := range []waveobj.Run{{ID: "run-t-1", Runtime: "pi", Model: "opencode-go/deepseek-v4-flash"}, {ID: "run-t-2"}} {
		if err := wstore.AppendRun(ctx, ch.OID, r); err != nil {
			t.Fatal(err)
		}
	}
	got := mergeLane(ctx, g, []string{"t-1", "t-2", "t-3"}).Routes
	if want := []string{"t-1 pi opencode-go/deepseek-v4-flash", "t-2 claude"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("routes = %q, want %q", got, want)
	}
}

func TestStripAttributionDropsAgentCreditAndKeepsTheRunTrailer(t *testing.T) {
	msg := "feat(x): add it\n\nwhy\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_1\nArc-Run: run-1"
	if got, want := stripAttribution(msg), "feat(x): add it\n\nwhy\n\nArc-Run: run-1"; got != want {
		t.Fatalf("stripAttribution = %q, want %q", got, want)
	}
}

// a branch whose commits carry no message lands under the lane's task titles
func TestMergeSquashFallsBackToTheLaneLabel(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, _ := CreateRunWorktree(context.Background(), dir, "run-1", base)
	os.WriteFile(filepath.Join(wt, "feature.txt"), []byte("feat\n"), 0o644)
	gitCmd(t, wt, "add", ".")
	gitCmd(t, wt, "commit", "--allow-empty-message", "-m", "")
	if _, err := MergeRunWorktree(context.Background(), dir, "run-1", MergeLane{Title: "Add the feature"}, nil); err != nil {
		t.Fatal(err)
	}
	if got, want := gitCmd(t, dir, "log", "-1", "--format=%B"), "chore: Add the feature\n\nArc-Run: run-1"; got != want {
		t.Fatalf("squash message = %q, want %q", got, want)
	}
}

func TestMergeConflictBlocked(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, _ := CreateRunWorktree(context.Background(), dir, "run-1", base)
	os.WriteFile(filepath.Join(wt, "base.txt"), []byte("child change\n"), 0o644)
	gitCmd(t, wt, "add", ".")
	gitCmd(t, wt, "commit", "-m", "child")
	os.WriteFile(filepath.Join(dir, "base.txt"), []byte("parent change\n"), 0o644)
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "parent")
	_, err := MergeRunWorktree(context.Background(), dir, "run-1", MergeLane{Title: "do the thing"}, nil)
	if !errors.Is(err, ErrMergeConflict) {
		t.Fatalf("want ErrMergeConflict, got %v", err)
	}
	// resolve in the project tree, then continue
	os.WriteFile(filepath.Join(dir, "base.txt"), []byte("resolved\n"), 0o644)
	gitCmd(t, dir, "add", ".")
	if _, err := MergeContinue(context.Background(), dir, "run-1", MergeLane{Title: "do the thing"}, nil); err != nil {
		t.Fatal(err)
	}
}

// conflictedSquash leaves dir mid-squash of wave/run-1, conflicting in base.txt.
func conflictedSquash(t *testing.T) string {
	t.Helper()
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, _ := CreateRunWorktree(context.Background(), dir, "run-1", base)
	os.WriteFile(filepath.Join(wt, "base.txt"), []byte("child change\n"), 0o644)
	gitCmd(t, wt, "add", ".")
	gitCmd(t, wt, "commit", "-m", "child")
	os.WriteFile(filepath.Join(dir, "base.txt"), []byte("parent change\n"), 0o644)
	gitCmd(t, dir, "add", ".")
	gitCmd(t, dir, "commit", "-m", "parent")
	if _, err := MergeRunWorktree(context.Background(), dir, "run-1", MergeLane{Title: "do the thing"}, nil); !errors.Is(err, ErrMergeConflict) {
		t.Fatalf("want ErrMergeConflict, got %v", err)
	}
	return dir
}

// The conflict wake names the files a stopped squash left unmerged, read from the index.
func TestConflictedFilesNamesWhatTheSquashLeftUnmerged(t *testing.T) {
	dir := conflictedSquash(t)
	files, err := conflictedFiles(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(files, []string{"base.txt"}) {
		t.Fatalf("conflicted files = %q, want [base.txt]", files)
	}
	clean := newGitRepo(t)
	if files, err := conflictedFiles(context.Background(), clean); err != nil || len(files) != 0 {
		t.Fatalf("a tree with no stopped merge has no conflicted files, got %q, %v", files, err)
	}
}

// the lead resolves the files the squash left unmerged first, so the wake names them, from the landing tree's index
func TestMergeConflictWakeNamesTheConflictedFiles(t *testing.T) {
	lead := newFakeLead(t)
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	tree := f.land(t)
	f.finish(t, "t-0")
	f.laneCommit(t, "t-0", "base.txt")
	// the landing branch moved base.txt after the lane was cut from it
	if err := os.WriteFile(filepath.Join(tree, "base.txt"), []byte("landing change\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCmd(t, tree, "add", ".")
	gitCmd(t, tree, "commit", "-m", "landing change")

	if err := MergeTask(f.ctx, f.channel, f.ownerID, "t-0"); !errors.Is(err, ErrMergeConflict) {
		t.Fatalf("want ErrMergeConflict, got %v", err)
	}
	want := "wake: merge conflict landing lane ending at task t-0 in base.txt. wsh jarvis dag status t-0"
	if len(lead.sends) != 1 || lead.sends[0] != want {
		t.Fatalf("want %q, got %q", want, lead.sends)
	}
}

// A continue with nothing staged must not credit the lane with whatever is at HEAD: a squash the resolver threw
// away would mark the task merged on the previous lane's commit, and one they committed themselves lands without
// the run and task trailers that later merges and the run's evidence find it by.
func TestMergeContinueRefusesWhatTheLaneDidNotLand(t *testing.T) {
	t.Run("squash abandoned", func(t *testing.T) {
		dir := conflictedSquash(t)
		head := gitCmd(t, dir, "rev-parse", "HEAD")
		gitCmd(t, dir, "reset", "-q", "--hard")
		if sha, err := MergeContinue(context.Background(), dir, "run-1", MergeLane{Title: "do the thing"}, nil); err == nil {
			t.Fatalf("continue credited %q to a squash that was thrown away", sha)
		}
		if got := gitCmd(t, dir, "rev-parse", "HEAD"); got != head {
			t.Fatalf("a refused continue moved HEAD to %s", got)
		}
	})
	t.Run("resolver committed", func(t *testing.T) {
		dir := conflictedSquash(t)
		os.WriteFile(filepath.Join(dir, "base.txt"), []byte("parent change\nchild change\n"), 0o644)
		gitCmd(t, dir, "add", ".")
		gitCmd(t, dir, "commit", "-m", "resolve the base.txt conflict")
		_, err := MergeContinue(context.Background(), dir, "run-1", MergeLane{Title: "do the thing"}, nil)
		if err == nil || !strings.Contains(err.Error(), "git reset --soft HEAD~1") {
			t.Fatalf("continue over the resolver's own commit: err = %v, want a refusal naming the undo", err)
		}
		// the way out the refusal names lands the squash with its trailers
		gitCmd(t, dir, "reset", "-q", "--soft", "HEAD~1")
		if _, err := MergeContinue(context.Background(), dir, "run-1", MergeLane{Title: "do the thing", TaskIDs: []string{"t-1"}}, nil); err != nil {
			t.Fatal(err)
		}
		if msg := gitCmd(t, dir, "log", "-1", "--format=%B"); !strings.Contains(msg, "Arc-Run: run-1") || !strings.Contains(msg, "Arc-Task: t-1") {
			t.Fatalf("squash message lacks its trailers: %q", msg)
		}
	})
	// a continue run again after the first one committed the squash and failed afterwards: HEAD is this lane's
	t.Run("squash already committed by an earlier attempt", func(t *testing.T) {
		dir := conflictedSquash(t)
		os.WriteFile(filepath.Join(dir, "base.txt"), []byte("parent change\nchild change\n"), 0o644)
		gitCmd(t, dir, "add", ".")
		landed, err := MergeContinue(context.Background(), dir, "run-1", MergeLane{Title: "do the thing"}, nil)
		if err != nil {
			t.Fatal(err)
		}
		sha, err := MergeContinue(context.Background(), dir, "run-1", MergeLane{Title: "do the thing"}, nil)
		if err != nil || sha != landed {
			t.Fatalf("second continue = %q, %v, want the squash the first one landed, %s", sha, err, landed)
		}
	})
}

// a lane that landed nothing must not be credited with whatever commit is the project's tip: acceptance 2's
// report credited a verify-only task with its predecessor's commit
func TestMergeOfALaneThatLandedNothingReturnsNoCommit(t *testing.T) {
	cases := map[string]func(t *testing.T, wt string){
		"no commits": func(*testing.T, string) {},
		"commits that net to none": func(t *testing.T, wt string) {
			os.WriteFile(filepath.Join(wt, "scratch.txt"), []byte("scratch\n"), 0o644)
			gitCmd(t, wt, "add", ".")
			gitCmd(t, wt, "commit", "-m", "add scratch")
			gitCmd(t, wt, "rm", "-q", "scratch.txt")
			gitCmd(t, wt, "commit", "-m", "drop scratch")
		},
	}
	for name, work := range cases {
		t.Run(name, func(t *testing.T) {
			dir := newGitRepo(t)
			os.WriteFile(filepath.Join(dir, "earlier.txt"), []byte("earlier lane\n"), 0o644)
			gitCmd(t, dir, "add", ".")
			gitCmd(t, dir, "commit", "-m", "an earlier lane\n\nArc-Run: run-1")
			head := gitCmd(t, dir, "rev-parse", "HEAD")
			wt, err := CreateRunWorktree(context.Background(), dir, "run-2", head)
			if err != nil {
				t.Fatal(err)
			}
			work(t, wt)

			sha, err := MergeRunWorktree(context.Background(), dir, "run-2", MergeLane{Title: "verify only"}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if sha != "" {
				t.Fatalf("want no commit, got %q", sha)
			}
			if got := gitCmd(t, dir, "rev-parse", "HEAD"); got != head {
				t.Fatalf("nothing may be committed, HEAD moved to %s", got)
			}
		})
	}
}

// a merge retried after its squash already landed still reports that squash, whether the branch survived the
// earlier attempt or cleanup already deleted it
func TestMergeRetryAfterTheSquashLandedReturnsItsCommit(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, _ := CreateRunWorktree(context.Background(), dir, "run-1", base)
	os.WriteFile(filepath.Join(wt, "feature.txt"), []byte("feat\n"), 0o644)
	gitCmd(t, wt, "add", ".")
	gitCmd(t, wt, "commit", "-m", "feature")
	landed, err := MergeRunWorktree(context.Background(), dir, "run-1", MergeLane{Title: "do the thing"}, nil)
	if err != nil {
		t.Fatal(err)
	}

	if sha, err := MergeRunWorktree(context.Background(), dir, "run-1", MergeLane{Title: "do the thing"}, nil); err != nil || sha != landed {
		t.Fatalf("branch still present: want %s, got %q (%v)", landed, sha, err)
	}
	gitCmd(t, dir, "worktree", "remove", "--force", wt)
	gitCmd(t, dir, "branch", "-D", "wave/run-1")
	if sha, err := MergeRunWorktree(context.Background(), dir, "run-1", MergeLane{Title: "do the thing"}, nil); err != nil || sha != landed {
		t.Fatalf("branch deleted: want %s, got %q (%v)", landed, sha, err)
	}
}

func TestMergeRunWorktreeNonGit(t *testing.T) {
	dir := t.TempDir()
	_, err := MergeRunWorktree(context.Background(), dir, "run-1", MergeLane{Title: "x"}, nil)
	if !errors.Is(err, ErrNotGitRepo) {
		t.Fatalf("want ErrNotGitRepo, got %v", err)
	}
}

// the run's spec and plan sit uncommitted in the project checkout until its first merge, which lands them
// with the work they describe
func TestMergeRunWorktreeFoldsDocsIntoTheSquashCommit(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, _ := CreateRunWorktree(context.Background(), dir, "run-1", base)
	os.WriteFile(filepath.Join(wt, "feature.txt"), []byte("feat\n"), 0o644)
	gitCmd(t, wt, "add", ".")
	gitCmd(t, wt, "commit", "-m", "feature")
	spec := filepath.Join(dir, "spec.md")
	plan := filepath.Join(dir, "plan.md")
	os.WriteFile(spec, []byte("# spec\n"), 0o644)
	os.WriteFile(plan, []byte("# plan\n"), 0o644)
	outside := filepath.Join(t.TempDir(), "elsewhere.md")
	os.WriteFile(outside, []byte("# not in this repo\n"), 0o644)

	if _, err := MergeRunWorktree(context.Background(), dir, "run-1", MergeLane{Title: "lane"}, []string{spec, plan, outside}); err != nil {
		t.Fatalf("a path git will not stage must not fail the merge: %v", err)
	}
	files := strings.Fields(gitCmd(t, dir, "show", "--name-only", "--format=", "HEAD"))
	if want := []string{"feature.txt", "plan.md", "spec.md"}; !reflect.DeepEqual(files, want) {
		t.Fatalf("squash commit files = %v, want %v", files, want)
	}
}
