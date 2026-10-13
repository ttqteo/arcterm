// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// passVerify is a Verify the final stage can run for real and pass.
const passVerify = "true"

// finalFixture is a checkout-landed git dag whose one task has landed, with the plan's Verify, Check and
// Final commands set. Its next tick starts the final stage.
func finalFixture(t *testing.T, verify, check, finalCmd string) *mergeFixture {
	t.Helper()
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.finish(t, "t-0")
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].Merged = true
		cur.Verify, cur.Check, cur.FinalCmd = verify, check, finalCmd
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return f
}

// awaitFinal returns a func that blocks until one more final stage's commands have run, their result is
// recorded, and the dag was ticked.
func awaitFinal(t *testing.T) func() {
	t.Helper()
	done := make(chan struct{}, 16)
	orig := finalFinished
	finalFinished = func(string) { done <- struct{}{} }
	restoreAfterStages(t, func() { finalFinished = orig })
	return func() {
		t.Helper()
		select {
		case <-done:
		case <-time.After(60 * time.Second):
			t.Fatal("the final stage did not finish")
		}
	}
}

// runFinal ticks f's dag and waits for its final commands to finish.
func runFinal(t *testing.T, f *mergeFixture) *waveobj.TaskGroup {
	t.Helper()
	await := awaitFinal(t)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()
	return f.dag(t)
}

func TestLandedDagStatusFollowsTheFinalStage(t *testing.T) {
	cases := []struct {
		final *waveobj.FinalStage
		want  string
	}{
		{nil, DagStatus_Finalizing},
		{&waveobj.FinalStage{Round: 2}, DagStatus_Finalizing},
		{&waveobj.FinalStage{State: FinalState_Checking, Round: 1}, DagStatus_Finalizing},
		{&waveobj.FinalStage{State: FinalState_Final, Round: 1}, DagStatus_Finalizing},
		{&waveobj.FinalStage{State: FinalState_Verifying, Round: 1}, DagStatus_Finalizing},
		{&waveobj.FinalStage{State: FinalState_Passed, Round: 1}, DagStatus_Done},
		{&waveobj.FinalStage{State: FinalState_Unverified, Round: 1}, DagStatus_Done},
		{&waveobj.FinalStage{State: FinalState_Failed, Round: 1}, DagStatus_Blocked},
	}
	for _, c := range cases {
		g := mustGroup(t, []waveobj.TaskNode{{ID: "t-0", Label: "a"}})
		g.Tasks[0].State = TaskState_Done
		g.Final = c.final
		RecomputeDagStatus(g)
		if g.Status != c.want {
			t.Fatalf("final %+v: want %s, got %s", c.final, c.want, g.Status)
		}
	}
	// a dag done before the final stage existed is not judged again
	g := mustGroup(t, []waveobj.TaskNode{{ID: "t-0", Label: "a"}})
	g.Tasks[0].State = TaskState_Done
	g.Status = DagStatus_Done
	RecomputeDagStatus(g)
	if g.Status != DagStatus_Done || g.Final != nil {
		t.Fatalf("an old done dag stays done, got %s / %+v", g.Status, g.Final)
	}
}

func TestFinalRunsVerifyUnscopedAfterCheck(t *testing.T) {
	out := filepath.ToSlash(t.TempDir())
	verify := `test -z "$ARC_VERIFY_CHANGED" && test -f ` + out + `/check && echo verify > ` + out + `/verify`
	f := finalFixture(t, verify, "echo check > "+out+"/check", "")

	g := runFinal(t, f)

	if g.Final.Detail != "" {
		t.Fatalf("Check then an unscoped Verify pass, got %q", g.Final.Detail)
	}
	if _, err := os.Stat(filepath.Join(out, "verify")); err != nil {
		t.Fatalf("the final stage runs the plan's Verify, unscoped, after Check: %v", err)
	}
}

func TestFinalVerifyFailureFailsTheStage(t *testing.T) {
	f := finalFixture(t, "echo '--- FAIL: TestX'; exit 1", "", "")

	g := runFinal(t, f)

	if g.Final.State != FinalState_Failed || !strings.Contains(g.Final.Detail, "Verify `echo '--- FAIL: TestX'; exit 1` failed on the merged result (exit 1)") {
		t.Fatalf("a failing Verify fails the stage with its command and exit, got %s %q", g.Final.State, g.Final.Detail)
	}
	if !strings.Contains(g.Final.Detail, "--- FAIL: TestX") {
		t.Fatalf("Detail keeps the output, got %q", g.Final.Detail)
	}
}

func TestFinalCheckFailureFailsTheStageWithItsTailAndWakesTheLead(t *testing.T) {
	lead := newFakeLead(t)
	// the branch name shows the Check ran in a detached tree, not in the shared checkout
	f := finalFixture(t, passVerify, "git rev-parse --abbrev-ref HEAD; echo 'vet: x.go:3: unreachable code'; exit 1", "")

	g := runFinal(t, f)

	if g.Final.State != FinalState_Failed || g.Status != DagStatus_Blocked || BlockingKind(g) != BlockingKindFinalFailed {
		t.Fatalf("a failing Check fails the stage and blocks the dag, got %s / %s / %q", g.Final.State, g.Status, BlockingKind(g))
	}
	if !strings.Contains(g.Final.Detail, "(exit 1)") || !strings.Contains(g.Final.Detail, "HEAD\nvet: x.go:3: unreachable code") {
		t.Fatalf("Detail holds the exit and the output tail from the detached tree, got %q", g.Final.Detail)
	}
	if len(lead.sends) != 1 || !strings.Contains(lead.sends[0], g.Final.Detail) || !strings.Contains(lead.sends[0], "wsh jarvis dag submit --round") {
		t.Fatalf("the lead is woken with the Detail whole and the fix round, got %q", lead.sends)
	}
	if _, err := os.Stat(worktreeDir(f.project, f.ownerID+"-final")); !os.IsNotExist(err) {
		t.Fatalf("the detached final tree is removed once the stage ends, stat err %v", err)
	}
}

// the base broke before any task, so the run's own Check result cannot be told apart from it
func TestFinalCheckFailureTheBaseSharesIsUnverified(t *testing.T) {
	f := finalFixture(t, passVerify, "echo 'error TS2345: new'; exit 1", "")
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.BaseCheck = &waveobj.BaseCheck{State: BaseCheckState_Failed, Commit: "abc", Detail: "exit 1: error TS2307"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	g := runFinal(t, f)

	if g.Final.State == FinalState_Failed || g.Final.Detail != "" {
		t.Fatalf("a Check failure the base shares does not fail the stage, got %s %q", g.Final.State, g.Final.Detail)
	}
	// both outputs, and no claim the run added nothing: the human compares them
	i := slices.IndexFunc(g.Final.Unverified, func(s string) bool { return strings.Contains(s, "already failed on the base") })
	if i < 0 {
		t.Fatalf("it is an unverified reason, got %q", g.Final.Unverified)
	}
	if r := g.Final.Unverified[i]; !strings.Contains(r, "TS2345") || !strings.Contains(r, "TS2307") || !strings.Contains(r, "may include failures the run introduced") {
		t.Fatalf("the reason shows both failures and says the run's may be among them, got %q", r)
	}
}

func TestFinalExit3IsUnverifiedWithItsLastLine(t *testing.T) {
	f := finalFixture(t, passVerify, "", "echo booting; echo 'no dev app: cargo missing'; exit 3")

	g := runFinal(t, f)

	if g.Final.State != FinalState_Unverified || g.Status != DagStatus_Done {
		t.Fatalf("exit 3 is unverified and the dag is done, got %s / %s", g.Final.State, g.Status)
	}
	if want := []string{"no dev app: cargo missing"}; !reflect.DeepEqual(g.Final.Unverified, want) {
		t.Fatalf("the reason is the last output line, got %q", g.Final.Unverified)
	}
}

func TestFinalOtherExitFails(t *testing.T) {
	f := finalFixture(t, passVerify, "", "echo 'FAIL board-layout'; exit 2")

	g := runFinal(t, f)

	if g.Final.State != FinalState_Failed || !strings.Contains(g.Final.Detail, "(exit 2)") || !strings.Contains(g.Final.Detail, "FAIL board-layout") {
		t.Fatalf("exit 2 fails with the exit and the tail, got %s %q", g.Final.State, g.Final.Detail)
	}
}

func TestAFinalCommandThatHangsTimesOut(t *testing.T) {
	orig := finalCommandTimeout
	finalCommandTimeout = time.Second
	restoreAfterStages(t, func() { finalCommandTimeout = orig })
	f := finalFixture(t, passVerify, "", "sleep 30")

	start := time.Now()
	g := runFinal(t, f)

	if g.Final.State != FinalState_Failed || !strings.Contains(g.Final.Detail, "timed out") {
		t.Fatalf("a hanging Final fails with timed out, got %s %q", g.Final.State, g.Final.Detail)
	}
	if took := time.Since(start); took > 20*time.Second {
		t.Fatalf("the timeout must end the command, took %s", took)
	}
}

func TestFinalWithOnlyAPassingVerifyPasses(t *testing.T) {
	lead := newFakeLead(t)
	f := finalFixture(t, passVerify, "", "")

	g := runFinal(t, f)

	if g.Final == nil || g.Final.State != FinalState_Passed || g.Final.Round != 1 || g.Status != DagStatus_Done {
		t.Fatalf("a passing Verify, no Check, no Final and nothing unverified passes, got %+v / %s", g.Final, g.Status)
	}
	if want := runFinishedWake + "\nThe final stage passed on the merged result.\n" + roundLeftLine; len(lead.sends) != 1 || lead.sends[0] != want {
		t.Fatalf("want %q, got %q", want, lead.sends)
	}
}

// run a088e568: the lead completed on a clean "run finished", and the land held on a conflict with a main commit
// 25 minutes old, after the lead's tab had closed
func TestRunFinishedWakeNamesTheConflictsTheLandWouldHoldOn(t *testing.T) {
	passed := runFinishedWake + "\nThe final stage passed on the merged result.\n" + roundLeftLine
	cases := []struct {
		name     string
		conflict bool
		want     string
	}{
		{"a conflict the lead can still fix", true, passed + "\nThe land into main will conflict in base.txt: merge main into this tree, resolve, commit, then complete."},
		{"a clean land adds nothing", false, passed},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			lead := newFakeLead(t)
			f := finalFixture(t, passVerify, "", "")
			tree := f.land(t)
			if err := wstore.UpdateRun(f.ctx, f.channel, f.ownerID, func(r *waveobj.Run) error {
				r.BaseBranch = "main"
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			commitOnBranch(t, tree, "base.txt", "branch\n")
			if c.conflict {
				commitOnBase(t, f.project, "base.txt", "main\n")
			}

			runFinal(t, f)

			if len(lead.sends) != 1 || lead.sends[0] != c.want {
				t.Fatalf("want %q, got %q", c.want, lead.sends)
			}
		})
	}
}

// the verifier is briefed with the reviewers' caveats, so its pass answers them; a missing Verify still counts
func TestAVerifiersPassSettlesReviewCaveatsButNotAMissingVerify(t *testing.T) {
	f := finalFixture(t, "", "", "")
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].ReviewUnverified = "the timeout path has no test"
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}

	g := f.dag(t)
	want := []string{"the plan has no Verify"}
	if g.Final.State != FinalState_Unverified || !reflect.DeepEqual(g.Final.Unverified, want) {
		t.Fatalf("want unverified with %q, got %s %q", want, g.Final.State, g.Final.Unverified)
	}
}

// with no verdict (the verifier gave up, there was no tree, the human ended the stage) nothing answered them
func TestReviewCaveatsCountWhenNoVerifierJudged(t *testing.T) {
	g := mustGroup(t, []waveobj.TaskNode{{ID: "t-0", Label: "a"}})
	g.Verify = verifyCmd
	g.Tasks[0].State, g.Tasks[0].ReviewUnverified = TaskState_Done, "the timeout path has no test"
	g.Final = &waveobj.FinalStage{State: FinalState_Verifying, Round: 1}
	var afterCommit []func()

	finishFinal(context.Background(), g, false, &afterCommit)

	want := []string{"t-0: reviewer: the timeout path has no test"}
	if g.Final.State != FinalState_Unverified || !reflect.DeepEqual(g.Final.Unverified, want) {
		t.Fatalf("want unverified with %q, got %s %q", want, g.Final.State, g.Final.Unverified)
	}

	g.Final = &waveobj.FinalStage{State: FinalState_Verifying, Round: 1}
	finishFinal(context.Background(), g, true, &afterCommit)
	if g.Final.State != FinalState_Passed || len(g.Final.Unverified) != 0 {
		t.Fatalf("a verifier's verdict settles the caveats, got %s %q", g.Final.State, g.Final.Unverified)
	}
}

// what the workers could not verify counts as much as what their reviewers could not
func TestWorkerCaveatsCountWhenNoVerifierJudged(t *testing.T) {
	ctx, g := caveatDag(t)
	g.Verify = verifyCmd
	g.Final = &waveobj.FinalStage{State: FinalState_Verifying, Round: 1}
	var afterCommit []func()

	finishFinal(ctx, g, false, &afterCommit)

	if g.Final.State != FinalState_Unverified || !reflect.DeepEqual(g.Final.Unverified, caveatDagLines) {
		t.Fatalf("want unverified with %q, got %s %q", caveatDagLines, g.Final.State, g.Final.Unverified)
	}
}

func TestANonGitDagIsUnverified(t *testing.T) {
	newFakeLead(t)
	h := newNotifyHarness(t, 1, []waveobj.TaskNode{{ID: "t-0", Label: "a"}})
	h.finishTask(t, "t-0", jarvis.RunStatus_Done)

	h.scheduleTimes(t, 1)

	g := h.loadDag(t)
	if g.Status != DagStatus_Done || g.Final.State != FinalState_Unverified || !strings.Contains(g.Final.Unverified[0], "not a git repository") {
		t.Fatalf("want done and unverified naming the missing repository, got %s / %+v", g.Status, g.Final)
	}
}

func TestAFixRoundsStageKeepsItsRound(t *testing.T) {
	f := finalFixture(t, passVerify, "", "")
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Final = &waveobj.FinalStage{Round: 2}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	g := runFinal(t, f)

	if g.Final.Round != 2 || g.Final.State != FinalState_Passed || !strings.HasSuffix(g.Final.OutDir, "/2") {
		t.Fatalf("the round a fix round set up runs as that round, got %+v", g.Final)
	}
}

func TestCancelStopsARunningFinalCommand(t *testing.T) {
	f := finalFixture(t, passVerify, "", "sleep 30")
	await := awaitFinal(t)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(30 * time.Second)
	for f.dag(t).Final.State != FinalState_Final {
		if time.Now().After(deadline) {
			t.Fatal("the Final command did not start")
		}
		time.Sleep(20 * time.Millisecond)
	}

	if err := Cancel(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await() // returns well before the sleep only if cancel stopped the command

	g := f.dag(t)
	if g.Status != DagStatus_Cancelled || g.Final.State != FinalState_Final {
		t.Fatalf("a cancelled dag records no final result, got %s / %s", g.Status, g.Final.State)
	}
}

func TestFinalTree(t *testing.T) {
	ctx := context.Background()
	t.Run("a checkout-landed dag gets a detached tree at HEAD, prepared by Setup and removed by cleanup", func(t *testing.T) {
		repo := newGitRepo(t)
		owner := &waveobj.Run{ID: "run-f", ProjectPath: repo}
		g := &waveobj.TaskGroup{OID: "dag-f", Setup: "echo prepared > setup.txt"}
		tree, cleanup, err := finalTree(ctx, g, owner)
		if err != nil {
			t.Fatal(err)
		}
		if tree == repo || gitCmd(t, tree, "rev-parse", "--abbrev-ref", "HEAD") != "HEAD" {
			t.Fatalf("want a detached tree of its own, got %s", tree)
		}
		if gitCmd(t, tree, "rev-parse", "HEAD") != gitCmd(t, repo, "rev-parse", "HEAD") {
			t.Fatal("the tree is at the checkout's HEAD")
		}
		if _, err := os.Stat(filepath.Join(tree, "setup.txt")); err != nil {
			t.Fatalf("Setup ran in the tree: %v", err)
		}
		cleanup()
		if _, err := os.Stat(tree); !os.IsNotExist(err) {
			t.Fatalf("cleanup removes the tree, stat err %v", err)
		}
		if strings.Contains(gitCmd(t, repo, "worktree", "list"), filepath.Base(tree)) {
			t.Fatal("cleanup unregisters the tree")
		}
	})
	t.Run("a stale final tree that cannot be removed leaves the stage a tree beside it", func(t *testing.T) {
		repo := newGitRepo(t)
		owner := &waveobj.Run{ID: "run-h", ProjectPath: repo}
		g := &waveobj.TaskGroup{OID: "dag-h"}
		stale, _, err := finalTree(ctx, g, owner)
		if err != nil {
			t.Fatal(err)
		}
		removeStaleFinalTree = func(context.Context, string, string) error {
			return fmt.Errorf("being used by another process")
		}
		t.Cleanup(func() { removeStaleFinalTree = removeWorktreeDir })
		tree, cleanup, err := finalTree(ctx, g, owner)
		if err != nil {
			t.Fatal(err)
		}
		if tree == stale || filepath.Dir(tree) != filepath.Dir(stale) {
			t.Fatalf("want another directory beside %s, got %s", stale, tree)
		}
		if gitCmd(t, tree, "rev-parse", "--abbrev-ref", "HEAD") != "HEAD" || gitCmd(t, tree, "rev-parse", "HEAD") != gitCmd(t, repo, "rev-parse", "HEAD") {
			t.Fatalf("want a detached tree at the checkout's HEAD, got %s", tree)
		}
		// nothing holds the stale tree here, so the retrying removal it was handed to takes it at once
		if _, err := os.Stat(stale); !os.IsNotExist(err) {
			t.Fatalf("the stale tree is handed to the retrying removal, stat err %v", err)
		}
		cleanup()
		if _, err := os.Stat(tree); !os.IsNotExist(err) {
			t.Fatalf("cleanup removes the tree the stage used, stat err %v", err)
		}
	})
	t.Run("a stale final tree that can be removed gives its directory to the next round", func(t *testing.T) {
		repo := newGitRepo(t)
		owner := &waveobj.Run{ID: "run-s", ProjectPath: repo}
		g := &waveobj.TaskGroup{OID: "dag-s"}
		stale, _, err := finalTree(ctx, g, owner)
		if err != nil {
			t.Fatal(err)
		}
		tree, cleanup, err := finalTree(ctx, g, owner)
		if err != nil || tree != stale {
			t.Fatalf("want the stale tree's directory %s again, got %s (%v)", stale, tree, err)
		}
		cleanup()
	})
	t.Run("a branch-landed dag runs in its landing tree", func(t *testing.T) {
		repo := newGitRepo(t)
		wt, err := CreateRunWorktree(ctx, repo, "run-b", "")
		if err != nil {
			t.Fatal(err)
		}
		owner := &waveobj.Run{ID: "run-b", ProjectPath: repo, LandPath: wt}
		tree, cleanup, err := finalTree(ctx, &waveobj.TaskGroup{OID: "dag-b"}, owner)
		if err != nil || tree != wt {
			t.Fatalf("want the landing tree %s, got %s (%v)", wt, tree, err)
		}
		cleanup()
		if _, err := os.Stat(wt); err != nil {
			t.Fatalf("cleanup leaves the landing tree: %v", err)
		}
	})
	t.Run("a dag outside git has no tree", func(t *testing.T) {
		owner := &waveobj.Run{ID: "run-n", ProjectPath: t.TempDir()}
		if _, _, err := finalTree(ctx, &waveobj.TaskGroup{OID: "dag-n"}, owner); err == nil || !strings.Contains(err.Error(), "not a git repository") {
			t.Fatalf("want not a git repository, got %v", err)
		}
	})
}

func TestFinalCommandGetsAFreshOutDir(t *testing.T) {
	out := filepath.ToSlash(filepath.Join(t.TempDir(), "arc-final", "1"))
	if err := os.MkdirAll(out, 0o755); err != nil {
		t.Fatal(err)
	}
	stale := filepath.Join(out, "stale.png")
	if err := os.WriteFile(stale, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}

	exit, tail, err := runFinalCommand(context.Background(), t.TempDir(), `test -d "$ARC_FINAL_OUT" && echo "$ARC_FINAL_OUT"`, out, time.Minute, nil)

	if err != nil || exit != 0 || tail != out {
		t.Fatalf("ARC_FINAL_OUT is set to an existing directory, got exit %d tail %q err %v", exit, tail, err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("an earlier attempt's output is cleared, stat err %v", err)
	}
}

func TestRunFinishedWakeStatesTheOutcome(t *testing.T) {
	long := strings.Repeat("the board's filter row is missing its count ", 40)
	w := RunFinishedWake(&waveobj.FinalStage{State: FinalState_Unverified, Unverified: []string{"no dev app: cargo missing", long}})
	lines := strings.Split(w, "\n")
	if lines[0] != runFinishedWake {
		t.Fatalf("the first line stays the finished line, got %q", lines[0])
	}
	for _, want := range []string{"- no dev app: cargo missing", "- " + long} {
		if !strings.Contains(w, want) {
			t.Fatalf("every reason is listed whole; missing %q in %q", want, w)
		}
	}
	if RunFinishedWake(nil) != runFinishedWake {
		t.Fatal("a dag with no final stage gets the plain finished line")
	}
}

func TestAFinishedRunWithNoLeadLaunchesNoneUnlessTheFinalStageFailed(t *testing.T) {
	f := newFakeLead(t)
	f.state = leadState{NoLead: true}
	launched := stubLaunch(t)
	ctx := context.Background()

	PostWake(ctx, wakeChannel, wakeRun, RunFinishedWake(&waveobj.FinalStage{State: FinalState_Passed}))
	PostWake(ctx, wakeChannel, wakeRun, RunFinishedWake(&waveobj.FinalStage{State: FinalState_Unverified, Unverified: []string{"no dev app"}}))
	if len(*launched) != 0 {
		t.Fatalf("a passed or unverified finish launches no lead, got %q", *launched)
	}

	PostWake(ctx, wakeChannel, wakeRun, finalFailedWake(1, wakeRun, "Check failed", false))
	if len(*launched) != 1 || !strings.Contains((*launched)[0], "the final stage failed") {
		t.Fatalf("a failed final stage launches the lead, got %q", *launched)
	}
}

func TestFinalFailedWakeAfterTheLastRoundGoesToTheHuman(t *testing.T) {
	w := finalFailedWake(MaxFinalRounds, "run-1", "Final failed (exit 1):\nFAIL board", true)
	if !strings.Contains(w, "the last") || !strings.Contains(w, "Put it to the human") || strings.Contains(w, "--round") {
		t.Fatalf("after the last round the lead forwards, got %q", w)
	}
	// the land runs after complete closes the lead's tab, so only the lead can warn the human first
	if !strings.Contains(w, "completing will not merge the branch") || !strings.Contains(w, "wsh runs land run-1 --force") {
		t.Fatalf("the last-round wake must say the land holds and how to force it, got %q", w)
	}
	if !strings.HasSuffix(w, "Final failed (exit 1):\nFAIL board") {
		t.Fatalf("the detail is carried whole, got %q", w)
	}
}

// finalStepEvents is the run's final-step events, oldest first, each as "<step> <ok>".
func finalStepEvents(t *testing.T, f *mergeFixture) []string {
	t.Helper()
	events := runEventsOfKind(t, f.ctx, f.channel, f.ownerID, waveobj.RunEventKindFinalStep)
	var out []string
	for i := len(events) - 1; i >= 0; i-- {
		var d struct {
			Step string `json:"step"`
			OK   bool   `json:"ok"`
			MS   *int64 `json:"ms"`
		}
		if err := json.Unmarshal(events[i].Detail, &d); err != nil || d.MS == nil {
			t.Fatalf("a final-step event carries its step, ms and ok, got %s (%v)", events[i].Detail, err)
		}
		out = append(out, fmt.Sprintf("%s %v", d.Step, d.OK))
	}
	return out
}

func TestFinalShowsTheRunningStepWithItsOutputAndRecordsEachStep(t *testing.T) {
	stop := filepath.ToSlash(filepath.Join(t.TempDir(), "stop"))
	f := finalFixture(t, passVerify, "echo checked", "echo booting; while [ ! -f "+stop+" ]; do sleep 0.05; done")
	// the stage stays verifying, as under a real verifier, so only the commands' own end can clear their step
	orig := startVerifier
	startVerifier = func(context.Context, context.Context, *waveobj.TaskGroup, *waveobj.Run, *[]func()) {}
	restoreAfterStages(t, func() { startVerifier = orig })
	await := awaitFinal(t)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(30 * time.Second)
	for {
		fs := f.dag(t).Final
		if fs.Step == FinalStep_Final && strings.Contains(fs.Output, "booting") {
			if fs.State != FinalState_Final || fs.StepTs == 0 {
				t.Fatalf("the running Final command shows as the final state with its start, got %+v", fs)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the Final command's step and output never showed, got %+v", fs)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err := os.WriteFile(stop, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	await()

	fs := f.dag(t).Final
	if fs.State != FinalState_Verifying || fs.Step != "" || fs.StepTs != 0 || fs.Output != "" {
		t.Fatalf("passed commands hand over to the verifier with no step showing, got %s step %q ts %d output %q", fs.State, fs.Step, fs.StepTs, fs.Output)
	}
	if got, want := finalStepEvents(t, f), []string{"tree true", "check true", "verify true", "final true"}; !slices.Equal(got, want) {
		t.Fatalf("each step records an event in order: want %v, got %v", want, got)
	}
}

func TestAFailedFinalStepIsRecordedAndTheStepsAfterItDoNotRun(t *testing.T) {
	f := finalFixture(t, "exit 1", "", "echo never")

	g := runFinal(t, f)

	if g.Final.State != FinalState_Failed || g.Final.Step != "" {
		t.Fatalf("a failed Verify fails the stage with no step left showing, got %s / %q", g.Final.State, g.Final.Step)
	}
	if got, want := finalStepEvents(t, f), []string{"tree true", "verify false"}; !slices.Equal(got, want) {
		t.Fatalf("want %v, got %v", want, got)
	}
}

func TestALateTailDoesNotLandOnTheNextStep(t *testing.T) {
	f := finalFixture(t, passVerify, "", "")
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Final = &waveobj.FinalStage{State: FinalState_Checking, Round: 1, Step: FinalStep_Verify}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if err := recordFinalOutputLocked(f.ctx, f.dagID, 1, FinalStep_Check, "check's last words"); err != nil {
		t.Fatal(err)
	}
	if out := f.dag(t).Final.Output; out != "" {
		t.Fatalf("a finished step's tail is dropped, got %q", out)
	}
	if err := recordFinalOutputLocked(f.ctx, f.dagID, 1, FinalStep_Verify, "ok  pkg/x"); err != nil {
		t.Fatal(err)
	}
	if out := f.dag(t).Final.Output; out != "ok  pkg/x" {
		t.Fatalf("the running step's tail shows, got %q", out)
	}
}

// the engine says whether a round is left, so the lead never guesses; the first line stays the finished line
// a lead-free run keys on (Review Focus)
func TestRunFinishedWakeSaysWhetherARoundIsLeft(t *testing.T) {
	cases := []struct {
		name  string
		final *waveobj.FinalStage
		want  string
	}{
		{"passed with a round left", &waveobj.FinalStage{State: FinalState_Passed, Round: 1}, roundLeftLine},
		{"unverified with a round left", &waveobj.FinalStage{State: FinalState_Unverified, Round: 1, Unverified: []string{"no dev app"}}, roundLeftLine},
		{"passed the last round", &waveobj.FinalStage{State: FinalState_Passed, Round: MaxFinalRounds}, noRoundLeftLine},
	}
	for _, c := range cases {
		w := RunFinishedWake(c.final)
		if !strings.HasSuffix(w, "\n"+c.want) {
			t.Fatalf("%s: the wake should end with %q, got %q", c.name, c.want, w)
		}
		if !onlyRunFinished([]string{w}) {
			t.Fatalf("%s: a lead-free run must still close by itself on %q", c.name, w)
		}
	}
}
