package orchestrate

import (
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func groupWith(states ...string) *waveobj.TaskGroup {
	tasks := []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
		{ID: "t-1", Label: "b", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "c", Deps: []string{"t-0"}},
		{ID: "t-3", Label: "d", Deps: []string{"t-1", "t-2"}},
	}
	g, err := NewTaskGroup("run-1", "ch-1", "g", 2, false, tasks, 1, nil)
	if err != nil {
		panic(err)
	}
	for i, s := range states {
		g.Tasks[i].State = s
	}
	RecomputeDagStatus(&g)
	return &g
}

func TestReadyTasksDepsAndOrder(t *testing.T) {
	g := groupWith(TaskState_Done)
	if got := ReadyTasks(g); !reflect.DeepEqual(got, []string{"t-1", "t-2"}) {
		t.Fatalf("want [t-1 t-2], got %v", got)
	}
}

func TestReadyTasksGateHalt(t *testing.T) {
	g := groupWith(TaskState_Done, TaskState_Done, TaskState_Done)
	g.Tasks[2].Gate = true // done gate with open successor t-3
	if got := ReadyTasks(g); len(got) != 0 {
		t.Fatalf("gate must halt ready tasks, got %v", got)
	}
	if _, err := ApproveGate(g, "t-2"); err != nil {
		t.Fatal(err)
	}
	if got := ReadyTasks(g); !reflect.DeepEqual(got, []string{"t-3"}) {
		t.Fatalf("after approve want [t-3], got %v", got)
	}
}

func TestNextToSpawnParallelismCap(t *testing.T) {
	g := groupWith(TaskState_Done, TaskState_Running)
	// one running (t-1), cap 2 -> only one more may spawn
	if got := NextToSpawn(g); !reflect.DeepEqual(got, []string{"t-2"}) {
		t.Fatalf("want [t-2], got %v", got)
	}
	g2 := groupWith(TaskState_Done)
	if got := NextToSpawn(g2); !reflect.DeepEqual(got, []string{"t-1", "t-2"}) {
		t.Fatalf("want [t-1 t-2], got %v", got)
	}
}

// run 8e755abf: a slot went to leaf tasks by id order while a ready task with a chain behind it waited
// 7.8 min, and its dependent another 6.5
func TestNextToSpawnStartsTheLongestChainFirst(t *testing.T) {
	tasks := []waveobj.TaskNode{
		{ID: "t-1", Label: "leaf"},
		{ID: "t-2", Label: "fan", Deps: nil},
		{ID: "t-3", Label: "chain"},
		{ID: "t-4", Label: "fan a", Deps: []string{"t-2"}},
		{ID: "t-5", Label: "fan b", Deps: []string{"t-2"}},
		{ID: "t-6", Label: "chain a", Deps: []string{"t-3"}},
		{ID: "t-7", Label: "chain b", Deps: []string{"t-6"}},
	}
	g, err := NewTaskGroup("run-1", "ch-1", "g", 1, false, tasks, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := NextToSpawn(&g); !reflect.DeepEqual(got, []string{"t-3"}) {
		t.Fatalf("width 1 must start the task with the longest chain behind it, want [t-3], got %v", got)
	}
	g.Parallelism = 3
	if got := NextToSpawn(&g); !reflect.DeepEqual(got, []string{"t-3", "t-2", "t-1"}) {
		t.Fatalf("want [t-3 t-2 t-1], got %v", got)
	}
}

func TestNextToSpawnStalledHoldsSlot(t *testing.T) {
	// a stalled child is still an alive process: it must keep its parallelism slot until
	// retried or stopped, or actual concurrency overshoots Parallelism during stalls.
	g := groupWith(TaskState_Done, TaskState_Stalled)
	g.Parallelism = 1
	if got := NextToSpawn(g); len(got) != 0 {
		t.Fatalf("stalled task must hold its slot, got %v", got)
	}
	g.Tasks[1].State = TaskState_Failed // stopped (dead) tasks free the slot
	if got := NextToSpawn(g); !reflect.DeepEqual(got, []string{"t-2"}) {
		t.Fatalf("failed task must free its slot, got %v", got)
	}
}

func TestGateActionsTargetTaskAndError(t *testing.T) {
	// one approval must release only its own gate, and a non-gate or unknown id must error
	// rather than silently no-op — the lead has to know the dag did not move.
	g := groupWith(TaskState_Done, TaskState_Done, TaskState_Done)
	g.Tasks[1].Gate = true
	g.Tasks[2].Gate = true
	if _, err := ApproveGate(g, "t-0"); err == nil {
		t.Fatal("approving a non-gate task must error")
	}
	if _, err := ApproveGate(g, "nope"); err == nil {
		t.Fatal("unknown task id must error")
	}
	if _, err := ApproveGate(g, "t-1"); err != nil {
		t.Fatal(err)
	}
	if !g.Tasks[1].Released || g.Tasks[2].Released {
		t.Fatalf("approve must release only its target: t-1=%v t-2=%v", g.Tasks[1].Released, g.Tasks[2].Released)
	}
	if _, err := SendBackGate(g, "t-2"); err != nil {
		t.Fatal(err)
	}
	if _, err := SendBackGate(g, "nope"); err == nil {
		t.Fatal("unknown task id must error")
	}
	if g.Tasks[2].State != TaskState_Pending {
		t.Fatalf("sendback must reopen only its target, got %q", g.Tasks[2].State)
	}
}

func TestSendBackAndRetryReset(t *testing.T) {
	g := groupWith(TaskState_Done, TaskState_Done, TaskState_Done)
	g.Tasks[2].Gate = true
	if _, err := ApproveGate(g, "t-2"); err != nil {
		t.Fatal(err)
	}
	g.Tasks[3].State = TaskState_Running
	g.Tasks[3].RunID = "r-3"
	if _, err := SendBackGate(g, "t-2"); err != nil { // reopens the gate for re-spawn
		t.Fatal(err)
	}
	// a sent-back gate must return to pending so the scheduler re-spawns it — "running"
	// with no runid would count against the parallelism budget yet never spawn (deadlock).
	if g.Tasks[2].State != TaskState_Pending || g.Tasks[2].RunID != "" {
		t.Fatalf("sendback must return the gate to pending and clear runid: %+v", g.Tasks[2])
	}
	ready := ReadyTasks(g)
	found := false
	for _, id := range ready {
		if id == "t-2" {
			found = true
		}
	}
	if !found {
		t.Fatalf("sent-back gate must be spawnable again, ReadyTasks=%v", ready)
	}
	g2 := groupWith(TaskState_Done, TaskState_Failed)
	g2.Failures = 2
	if err := RetryTask(g2, "t-1"); err != nil {
		t.Fatal(err)
	}
	// a retried task must return to pending so NextToSpawn picks it up again — "running"
	// with no runid would count against the parallelism budget yet never spawn (deadlock).
	// the dag-wide failure streak is NOT cleared: one retry must not starve the circuit-break;
	// only a fresh success clears it (tick accounting).
	if g2.Tasks[1].State != TaskState_Pending || g2.Tasks[1].RunID != "" || g2.Failures != 2 {
		t.Fatalf("retry must re-open the task for spawn and preserve failures: %+v", g2.Tasks[1])
	}
	got := NextToSpawn(g2)
	if len(got) != 2 || got[0] != "t-1" {
		t.Fatalf("retried task must be spawnable again, NextToSpawn=%v", got)
	}
}

func TestCancelGroup(t *testing.T) {
	g := groupWith(TaskState_Done, TaskState_Running, TaskState_Stalled)
	g.Tasks[1].RunID = "r-1"
	g.Tasks[2].RunID = "r-2"
	CancelGroup(g)
	if g.Tasks[1].State != TaskState_Cancelled || g.Tasks[2].State != TaskState_Cancelled || g.Status != DagStatus_Cancelled {
		t.Fatalf("cancel: running=%s stalled=%s status=%s", g.Tasks[1].State, g.Tasks[2].State, g.Status)
	}
}

// a reviewing task has no worker: another lane may start in its slot while the reviewer judges the commit
func TestNextToSpawnReviewingFreesItsSlot(t *testing.T) {
	g := groupWith(TaskState_Done, TaskState_Reviewing)
	g.Parallelism = 1
	if got := NextToSpawn(g); !reflect.DeepEqual(got, []string{"t-2"}) {
		t.Fatalf("a reviewing task frees its slot for another lane, got %v", got)
	}
}

// the commit under review is in the lane's tree, so no task of that lane starts beside the reviewer
func TestNextToSpawnReviewingHoldsItsLane(t *testing.T) {
	g, err := NewTaskGroup("run-1", "ch-1", "g", 2, false, []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
		{ID: "t-1", Label: "b", Deps: []string{"t-0"}},
	}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	g.Tasks[1].State = TaskState_Reviewing
	if got := NextToSpawn(&g); len(got) != 0 {
		t.Fatalf("a retried task of a lane under review waits for the review, got %v", got)
	}
}

// a live worker still holds its slot, stalled or not
func TestSlotsInUseCountsLiveWorkersOnly(t *testing.T) {
	g := groupWith(TaskState_Running, TaskState_Stalled, TaskState_Reviewing, TaskState_Done)
	if got := slotsInUse(g); got != 2 {
		t.Fatalf("running and stalled hold a slot, reviewing does not: got %d", got)
	}
}

func TestReviewingTaskDoesNotSatisfyDependents(t *testing.T) {
	g := groupWith(TaskState_Done, TaskState_Reviewing, TaskState_Done)
	for _, id := range ReadyTasks(g) {
		if id == "t-3" {
			t.Fatal("t-3 depends on a task still under review")
		}
	}
}

func TestCancelGroupCancelsReviewStates(t *testing.T) {
	g := groupWith(TaskState_Done, TaskState_Reviewing, TaskState_ReviewFailed)
	CancelGroup(g)
	if g.Tasks[1].State != TaskState_Cancelled || g.Tasks[2].State != TaskState_Cancelled {
		t.Fatalf("cancel must end review states, got %s and %s", g.Tasks[1].State, g.Tasks[2].State)
	}
}
