package orchestrate

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func mkTasks() []waveobj.TaskNode {
	return []waveobj.TaskNode{
		{ID: "t-0", Label: "setup"},
		{ID: "t-1", Label: "api", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "ship", Deps: []string{"t-0", "t-1"}, Gate: true},
	}
}

func mustGroup(t *testing.T, tasks []waveobj.TaskNode) *waveobj.TaskGroup {
	t.Helper()
	g, err := NewTaskGroup("run-1", "ch-1", "g", 2, false, tasks, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	return &g
}

func TestNewTaskGroupSetsIdentity(t *testing.T) {
	g, err := NewTaskGroup("run-1", "ch-1", "ship", 2, false, mkTasks(), 1000, nil)
	if err != nil {
		t.Fatalf("NewTaskGroup: %v", err)
	}
	if g.RunID != "run-1" || g.ChannelId != "ch-1" || g.Parallelism != 2 || g.ID == "" {
		t.Fatalf("bad identity: %+v", g)
	}
}

func TestNewTaskGroupRejectsInvalidAuthoringAndEngineState(t *testing.T) {
	cases := []struct {
		name        string
		title       string
		parallelism int
		tasks       []waveobj.TaskNode
	}{
		{name: "blank title", title: "   ", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "t", Label: "a"}}},
		{name: "blank label", title: "g", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "t", Label: "   "}}},
		{name: "duplicate dependency", title: "g", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "a", Label: "a"}, {ID: "b", Label: "b", Deps: []string{"a", "a"}}}},
		{name: "zero parallelism", title: "g", parallelism: 0, tasks: []waveobj.TaskNode{{ID: "t", Label: "a"}}},
		{name: "excess parallelism", title: "g", parallelism: 9, tasks: []waveobj.TaskNode{{ID: "t", Label: "a"}}},
		{name: "state", title: "g", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "t", Label: "a", State: TaskState_Running}}},
		{name: "run id", title: "g", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "t", Label: "a", RunID: "run"}}},
		{name: "released", title: "g", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "t", Label: "a", Released: true}}},
		{name: "last activity", title: "g", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "t", Label: "a", LastActivity: 1}}},
		{name: "attempts", title: "g", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "t", Label: "a", Attempts: 1}}},
		{name: "lastfailurekind", title: "g", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "t", Label: "a", LastFailureKind: "timeout"}}},
		{name: "escalations", title: "g", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "t", Label: "a", Escalations: 1}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := NewTaskGroup("run", "channel", tc.title, tc.parallelism, false, tc.tasks, 1, nil); err == nil {
				t.Fatal("want validation error")
			}
		})
	}
}

func TestNewTaskGroupSanitizesDeepCopy(t *testing.T) {
	tasks := []waveobj.TaskNode{
		{ID: "a", Label: "a", RunSpec: waveobj.RunSpec{Runtime: "claude", Model: "sonnet"}},
		{ID: "b", Label: "b", Deps: []string{"a"}},
	}
	g, err := NewTaskGroup("run", "channel", "g", 1, false, tasks, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	tasks[0].Label = "changed"
	tasks[1].Deps[0] = "changed"
	if g.Tasks[0].Label != "a" || g.Tasks[1].Deps[0] != "a" {
		t.Fatalf("group shares caller task data: %+v", g.Tasks)
	}
	for _, task := range g.Tasks {
		if task.State != TaskState_Pending {
			t.Fatalf("task %s state = %q, want pending", task.ID, task.State)
		}
	}
}

func TestSameDagProposalUsesOnlyAuthoringShape(t *testing.T) {
	a := mustGroup(t, mkTasks())
	b := *a
	b.Tasks = append([]waveobj.TaskNode(nil), a.Tasks...)
	b.OID = "different"
	b.ID = "different"
	b.Version = 99
	b.Status = DagStatus_Blocked
	b.Failures = 2
	b.CreatedTs = 50
	b.UpdatedTs = 60
	b.Tasks[0].State = TaskState_Done
	b.Tasks[0].RunID = "child"
	b.Tasks[0].Released = true
	b.Tasks[0].LastActivity = 100
	b.Tasks[0].Attempts = 2
	b.Tasks[0].LastFailureKind = FailureKindTimeout
	b.Tasks[0].Escalations = 1
	if !SameDagProposal(a, &b) {
		t.Fatal("engine state changed proposal identity")
	}
	b.Tasks[0].Label = "changed"
	if SameDagProposal(a, &b) {
		t.Fatal("authoring change treated as identical proposal")
	}
}

func TestValidateRejects(t *testing.T) {
	cases := []struct {
		name  string
		tasks []waveobj.TaskNode
	}{
		{"dup id", []waveobj.TaskNode{{ID: "t-1"}, {ID: "t-1"}}},
		{"unknown dep", []waveobj.TaskNode{{ID: "t-1", Deps: []string{"nope"}}}},
		{"self dep", []waveobj.TaskNode{{ID: "t-1", Deps: []string{"t-1"}}}},
		{"cycle", []waveobj.TaskNode{{ID: "t-1", Deps: []string{"t-2"}}, {ID: "t-2", Deps: []string{"t-1"}}}},
		{"empty id", []waveobj.TaskNode{{ID: ""}}},
		{"blank id", []waveobj.TaskNode{{ID: "   ", Label: "a"}}},
	}
	for _, c := range cases {
		if err := ValidateTasks(c.tasks); err == nil {
			t.Errorf("%s: expected error", c.name)
		}
	}
	if err := ValidateTasks(mkTasks()); err != nil {
		t.Errorf("valid tasks rejected: %v", err)
	}
}

func TestRecomputeStatusDerivation(t *testing.T) {
	g := mustGroup(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "setup"},
		{ID: "t-1", Label: "api", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "gate", Deps: []string{"t-0", "t-1"}, Gate: true},
		{ID: "t-3", Label: "ship", Deps: []string{"t-2"}},
	})
	g.Tasks[0].State = TaskState_Done
	g.Tasks[1].State = TaskState_Done
	RecomputeDagStatus(g)
	if g.Status != DagStatus_Running {
		t.Fatalf("gate not yet done: want running, got %s", g.Status)
	}
	g.Tasks[2].State = TaskState_Done // done, unreleased gate with open successor
	RecomputeDagStatus(g)
	if g.Status != DagStatus_AwaitingReview {
		t.Fatalf("want awaiting-review, got %s", g.Status)
	}
	g.Tasks[3].State = TaskState_Done
	RecomputeDagStatus(g)
	if g.Status != DagStatus_AwaitingReview {
		t.Fatalf("gate still unreleased: want awaiting-review, got %s", g.Status)
	}
	g.Tasks[2].Released = true
	RecomputeDagStatus(g)
	if g.Status != DagStatus_Finalizing {
		t.Fatalf("released gate: want finalizing, got %s", g.Status)
	}
	g2 := mustGroup(t, mkTasks())
	g2.Tasks[1].State = TaskState_Failed
	RecomputeDagStatus(g2)
	if g2.Status != DagStatus_Blocked {
		t.Fatalf("want blocked, got %s", g2.Status)
	}
	g3 := mustGroup(t, mkTasks())
	g3.Failures = 3
	RecomputeDagStatus(g3)
	if g3.Status != DagStatus_Blocked {
		t.Fatalf("want circuit-break blocked, got %s", g3.Status)
	}
}

func TestRecomputeStatusCleanupDebt(t *testing.T) {
	// merge-required dag with a merged task carrying cleanup debt stays non-terminal (08-27
	// acceptance: pending cleanup keeps the dag non-terminal and the lead available).
	g4 := mustGroup(t, mkTasks())
	g4.MergeRequired = true
	for i := range g4.Tasks {
		g4.Tasks[i].State = TaskState_Done
		g4.Tasks[i].Merged = true
	}
	g4.Tasks[2].Released = true // released gate
	RecomputeDagStatus(g4)
	if g4.Status != DagStatus_Finalizing {
		t.Fatalf("clean merged dag: want finalizing, got %s", g4.Status)
	}
	g4.Tasks[0].CleanupPending = true
	RecomputeDagStatus(g4)
	if g4.Status != DagStatus_Running {
		t.Fatalf("cleanup pending: want running, got %s", g4.Status)
	}
	g4.Tasks[0].CleanupPending = false
	g4.Tasks[0].CleanupError = "locked"
	RecomputeDagStatus(g4)
	if g4.Status != DagStatus_Running {
		t.Fatalf("cleanup failed: want running, got %s", g4.Status)
	}
	g4.Tasks[0].CleanupError = ""
	RecomputeDagStatus(g4)
	if g4.Status != DagStatus_Finalizing {
		t.Fatalf("cleanup cleared: want finalizing, got %s", g4.Status)
	}
}

// cleanupDebtGroup is a merge-required dag whose tasks are all done and merged, with t-0 carrying a
// failed-cleanup error after the given number of attempts.
func cleanupDebtGroup(t *testing.T, attempts int, merged bool) *waveobj.TaskGroup {
	t.Helper()
	g := mustGroup(t, mkTasks())
	g.MergeRequired = true
	for i := range g.Tasks {
		g.Tasks[i].State = TaskState_Done
		g.Tasks[i].Merged = true
	}
	g.Tasks[2].Released = true
	g.Tasks[0].Merged = merged
	g.Tasks[0].CleanupError = "being used by another process"
	g.Tasks[0].CleanupAttempts = attempts
	return g
}

func TestDoneDagStaysNonTerminalUnderTheCleanupCap(t *testing.T) {
	g := cleanupDebtGroup(t, MaxCleanupAttempts-1, true)
	RecomputeDagStatus(g)
	if g.Status == DagStatus_Done {
		t.Fatalf("debt under the cap must keep the dag non-terminal, got %s", g.Status)
	}
}

func TestDoneDagGoesTerminalOnceCleanupGivesUp(t *testing.T) {
	g := cleanupDebtGroup(t, MaxCleanupAttempts, true)
	RecomputeDagStatus(g)
	if g.Status != DagStatus_Finalizing {
		t.Fatalf("debt over the cap must not wedge the dag, got %s", g.Status)
	}
	if !HasCleanupDebt(g) {
		t.Fatal("a given-up task must still report cleanup debt for the digest")
	}
}

func TestUnmergedTaskStillBlocksTerminalityOverTheCap(t *testing.T) {
	g := cleanupDebtGroup(t, MaxCleanupAttempts+3, false)
	RecomputeDagStatus(g)
	if g.Status == DagStatus_Done {
		t.Fatal("an unmerged task is a real incomplete merge, not debt, and must still block")
	}
}

func TestDeriveTaskStatesFromRuns(t *testing.T) {
	g := mustGroup(t, mkTasks())
	g.Tasks[0].State = TaskState_Running
	g.Tasks[0].RunID = "r-0"
	runs := map[string]*waveobj.Run{"r-0": {ID: "r-0", Status: jarvis.RunStatus_Done}}
	DeriveTaskStates(g, runs)
	if g.Tasks[0].State != TaskState_Done {
		t.Fatalf("want done, got %s", g.Tasks[0].State)
	}
}

func TestNewTaskGroupRejectsLifecycleFields(t *testing.T) {
	tasks := []waveobj.TaskNode{{
		ID: "t-1", Label: "one", Merged: true,
		CleanupPending: true, CleanupError: "locked",
	}}
	if _, err := NewTaskGroup("run", "channel", "title", 1, true, tasks, 1, nil); err == nil {
		t.Fatal("caller-supplied merge and cleanup fields must be rejected")
	}
}

func TestNewTaskGroupPersistsMergeRequirement(t *testing.T) {
	g, err := NewTaskGroup("run", "channel", "title", 1, true, []waveobj.TaskNode{{ID: "t-1", Label: "one"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !g.MergeRequired {
		t.Fatal("git-backed dag must require merged tasks")
	}
}

// A caller that does not pin a width used to get a literal 2, so a dag with four independent tasks
// drained two at a time for no reason. The default is the shape of the plan.
func TestDefaultParallelismFollowsReadyWidth(t *testing.T) {
	four := []waveobj.TaskNode{{ID: "t-1"}, {ID: "t-2"}, {ID: "t-3"}, {ID: "t-4"}}
	if got := DefaultParallelism(four); got != 4 {
		t.Fatalf("four independent tasks want width 4, got %d", got)
	}
	chain := []waveobj.TaskNode{{ID: "t-1"}, {ID: "t-2", Deps: []string{"t-1"}}, {ID: "t-3", Deps: []string{"t-2"}}}
	if got := DefaultParallelism(chain); got != 1 {
		t.Fatalf("a chain can only start one task, got %d", got)
	}
	wide := make([]waveobj.TaskNode, MaxParallelism+4)
	for i := range wide {
		wide[i] = waveobj.TaskNode{ID: fmt.Sprintf("t-%d", i)}
	}
	if got := DefaultParallelism(wide); got != MaxParallelism {
		t.Fatalf("width must cap at MaxParallelism, got %d", got)
	}
	if got := DefaultParallelism(nil); got != 1 {
		t.Fatalf("no tasks must still be a legal width, got %d", got)
	}
}

func TestSameDagProposalComparesPlanCommands(t *testing.T) {
	a, err := NewTaskGroup("run", "channel", "title", 1, true, []waveobj.TaskNode{{ID: "t-1", Label: "one"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	b := a
	b.Verify = "task test"
	if SameDagProposal(&a, &b) {
		t.Fatal("a resubmitted plan with a different Verify is a different proposal")
	}
	b.Verify, b.Setup = "", "task worktree:prepare"
	if SameDagProposal(&a, &b) {
		t.Fatal("a resubmitted plan with a different Setup is a different proposal")
	}
	b.Setup, b.Check = "", "task check:ts"
	if SameDagProposal(&a, &b) {
		t.Fatal("a resubmitted plan with a different Check is a different proposal")
	}
}

// the plan header reaches every worker through taskPrompt, so a re-submit that edits it must not
// look identical: the stored dag would keep the old header and no worker would ever see the new one.
func TestSameDagProposalComparesThePlanHeader(t *testing.T) {
	a, err := NewTaskGroup("run", "channel", "title", 1, true, []waveobj.TaskNode{{ID: "t-1", Label: "one"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	b := a
	b.Preamble = "Never edit docs/."
	if SameDagProposal(&a, &b) {
		t.Fatal("a resubmitted plan with a different header is a different proposal")
	}
}

func TestDeriveTaskStatesKeepsLandingStates(t *testing.T) {
	for _, state := range []string{TaskState_BlockedMerge, TaskState_Verifying, TaskState_VerifyFailed} {
		g := mustGroup(t, mkTasks())
		g.Tasks[0].State = state
		g.Tasks[0].RunID = "r-0"
		DeriveTaskStates(g, map[string]*waveobj.Run{"r-0": {ID: "r-0", Status: jarvis.RunStatus_Done}})
		if g.Tasks[0].State != state {
			t.Fatalf("a done child must not overwrite %s, got %s", state, g.Tasks[0].State)
		}
	}
}

func TestSameDagProposalComparesPlanAndSpecPaths(t *testing.T) {
	a, err := NewTaskGroup("run-1", "ch-1", "g", 1, true, []waveobj.TaskNode{{ID: "t-1", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	a.PlanPath = "/docs/plan.md"
	b := a
	if !SameDagProposal(&a, &b) {
		t.Fatal("identical proposals must match")
	}
	b.SpecPath = "/docs/spec.md"
	if SameDagProposal(&a, &b) {
		t.Fatal("a resubmission naming a different spec is a different proposal")
	}
}
func TestDeriveTaskStatesSendsACommittedFinishToReview(t *testing.T) {
	g := mustGroup(t, mkTasks())
	g.Tasks[0].State = TaskState_Running
	g.Tasks[0].RunID = "r-0"
	g.Tasks[0].ReviewRespawns = 1
	g.Tasks[0].ReviewVerdict = ReviewVerdict_Fail
	DeriveTaskStates(g, map[string]*waveobj.Run{"r-0": {ID: "r-0", Status: jarvis.RunStatus_Done, BaseCommit: "base0", EndCommit: "work1"}})
	got := g.Tasks[0]
	if got.State != TaskState_Reviewing {
		t.Fatalf("a finished worker with a commit must be reviewed, got %s", got.State)
	}
	if got.ReviewBase != "base0" || got.ReviewRespawns != 0 || got.ReviewVerdict != "" {
		t.Fatalf("entering review must reset the round's bookkeeping and keep the base: %+v", got)
	}
}

func TestDeriveTaskStatesKeepsTheFirstReviewBase(t *testing.T) {
	g := mustGroup(t, mkTasks())
	g.Tasks[0].State = TaskState_Running
	g.Tasks[0].RunID = "r-0"
	g.Tasks[0].ReviewBase = "first"
	DeriveTaskStates(g, map[string]*waveobj.Run{"r-0": {ID: "r-0", Status: jarvis.RunStatus_Done, BaseCommit: "fix-base", EndCommit: "fix1"}})
	if g.Tasks[0].ReviewBase != "first" {
		t.Fatalf("a later round must diff the whole task, got base %q", g.Tasks[0].ReviewBase)
	}
}

func TestDeriveTaskStatesDoneWithoutACommitSkipsReview(t *testing.T) {
	g := mustGroup(t, mkTasks())
	g.Tasks[0].State = TaskState_Running
	g.Tasks[0].RunID = "r-0"
	DeriveTaskStates(g, map[string]*waveobj.Run{"r-0": {ID: "r-0", Status: jarvis.RunStatus_Done}})
	if g.Tasks[0].State != TaskState_Done {
		t.Fatalf("nothing committed means nothing to review, got %s", g.Tasks[0].State)
	}
}

func TestDeriveTaskStatesLeavesReviewStatesAlone(t *testing.T) {
	for _, state := range []string{TaskState_Reviewing, TaskState_ReviewFailed, TaskState_Done} {
		g := mustGroup(t, mkTasks())
		g.Tasks[0].State = state
		g.Tasks[0].RunID = "r-0"
		DeriveTaskStates(g, map[string]*waveobj.Run{"r-0": {ID: "r-0", Status: jarvis.RunStatus_Done, EndCommit: "work1"}})
		if g.Tasks[0].State != state {
			t.Fatalf("a done worker run must not move a %s task, got %s", state, g.Tasks[0].State)
		}
	}
}

func TestReviewFailedBlocksTheDag(t *testing.T) {
	g := mustGroup(t, mkTasks())
	g.Tasks[0].State = TaskState_ReviewFailed
	RecomputeDagStatus(g)
	if g.Status != DagStatus_Blocked {
		t.Fatalf("a failed review waits on judgment like a failed task, got %s", g.Status)
	}
}

func TestNewTaskGroupRejectsReviewFields(t *testing.T) {
	tasks := []waveobj.TaskNode{{ID: "t-1", Label: "one", ReviewVerdict: ReviewVerdict_Pass}}
	if _, err := NewTaskGroup("run", "channel", "title", 1, true, tasks, 1, nil); err == nil {
		t.Fatal("caller-supplied review fields must be rejected")
	}
}

func TestDeriveTaskStatesNoNewCommitSkipsReview(t *testing.T) {
	g := mustGroup(t, mkTasks())
	g.Tasks[0].State = TaskState_Running
	g.Tasks[0].RunID = "r-0"
	DeriveTaskStates(g, map[string]*waveobj.Run{"r-0": {ID: "r-0", Status: jarvis.RunStatus_Done, BaseCommit: "same", EndCommit: "same"}})
	if g.Tasks[0].State != TaskState_Done {
		t.Fatalf("a worker that committed nothing has nothing to review, got %s", g.Tasks[0].State)
	}
	g.Tasks[0].State = TaskState_Running
	g.Tasks[0].ReviewBase = "first"
	DeriveTaskStates(g, map[string]*waveobj.Run{"r-0": {ID: "r-0", Status: jarvis.RunStatus_Done, BaseCommit: "same", EndCommit: "same"}})
	if g.Tasks[0].State != TaskState_Reviewing {
		t.Fatalf("a fix round that committed nothing is still judged, got %s", g.Tasks[0].State)
	}
}

// declaredTaskStates parses dag.go and returns the value of every TaskState_* constant it declares.
func declaredTaskStates(t *testing.T) []string {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), "dag.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	var states []string
	for _, decl := range file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.CONST {
			continue
		}
		for _, spec := range gen.Specs {
			vs := spec.(*ast.ValueSpec)
			for i, name := range vs.Names {
				if !strings.HasPrefix(name.Name, "TaskState_") {
					continue
				}
				value, err := strconv.Unquote(vs.Values[i].(*ast.BasicLit).Value)
				if err != nil {
					t.Fatal(err)
				}
				states = append(states, value)
			}
		}
	}
	if len(states) == 0 {
		t.Fatal("found no TaskState_ constants in dag.go")
	}
	return states
}

// every TaskState_* constant declared in dag.go has a row in taskStates, so no reader's set leaves a state out
func TestEveryTaskStateIsClassified(t *testing.T) {
	states := declaredTaskStates(t)
	for _, s := range states {
		if _, ok := taskStates[s]; !ok {
			t.Errorf("task state %q has no row in taskStates", s)
		}
	}
	if len(taskStates) != len(states) {
		t.Errorf("taskStates has %d rows for %d states", len(taskStates), len(states))
	}
	// what CancelGroup writes must itself end the task. The landing states are the known exception: a cancelled dag
	// leaves a merge conflict or a Verify as it was (the fork cancels them; the owner decides in docs/open-issues.md).
	for s, c := range taskStates {
		if c.cancelTo == "" && !c.terminal && !c.landing {
			t.Errorf("state %q is neither terminal, a landing state nor cancelled by CancelGroup", s)
		}
		if c.cancelTo != "" && !taskStates[c.cancelTo].terminal {
			t.Errorf("state %q cancels to %q, which is not terminal", s, c.cancelTo)
		}
	}
}

// taskStates must answer, for every state, what the readers' own switches answered before it replaced them: the
// table is a refactor of ours, so no state moves into or out of a set. The sets here are written out by hand.
func TestTaskStatesClassifyAsTheSwitchesDid(t *testing.T) {
	in := func(state string, set ...string) bool { return slices.Contains(set, state) }
	for _, s := range declaredTaskStates(t) {
		c := taskStates[s]
		if want := in(s, TaskState_Running, TaskState_Stalled); c.active != want || taskActive(s) != want {
			t.Errorf("%s: active = %v, want %v", s, c.active, want)
		}
		if want := in(s, TaskState_Running, TaskState_Stalled, TaskState_Reviewing); c.inFlight != want || taskInFlight(s) != want {
			t.Errorf("%s: inFlight = %v, want %v", s, c.inFlight, want)
		}
		if want := in(s, TaskState_Reviewing, TaskState_ReviewFailed); c.review != want || reviewState(s) != want {
			t.Errorf("%s: review = %v, want %v", s, c.review, want)
		}
		if want := in(s, TaskState_BlockedMerge, TaskState_Verifying, TaskState_VerifyFailed); c.landing != want || landingState(s) != want {
			t.Errorf("%s: landing = %v, want %v", s, c.landing, want)
		}
		if want := in(s, TaskState_Done, TaskState_Skipped); c.settled != want {
			t.Errorf("%s: settled = %v, want %v", s, c.settled, want)
		}
		// allTasksTerminal's old switch: done, skipped, failed and cancelled continue; anything else stops the walk
		want := in(s, TaskState_Done, TaskState_Skipped, TaskState_Failed, TaskState_Cancelled)
		if c.terminal != want || allTasksTerminal(&waveobj.TaskGroup{Tasks: []waveobj.TaskNode{{ID: "t-1", State: s}}}) != want {
			t.Errorf("%s: terminal = %v, want %v", s, c.terminal, want)
		}
		// CancelGroup's old switch: not started -> skipped; a live worker or a review -> cancelled; the rest untouched
		wantCancel := s
		switch s {
		case TaskState_Pending, TaskState_Ready:
			wantCancel = TaskState_Skipped
		case TaskState_Running, TaskState_Stalled, TaskState_Reviewing, TaskState_ReviewFailed:
			wantCancel = TaskState_Cancelled
		}
		g := &waveobj.TaskGroup{Tasks: []waveobj.TaskNode{{ID: "t-1", State: s}}}
		if CancelGroup(g); g.Tasks[0].State != wantCancel {
			t.Errorf("%s: CancelGroup left %s, want %s", s, g.Tasks[0].State, wantCancel)
		}
	}
}
