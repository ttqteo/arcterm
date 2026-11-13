// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"reflect"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// pauseFixture is a git-free orchestrator run whose lead runs in tab:lead, with a dag of running tasks: task <id>'s
// worker runs in tab:w-<id>. A task's run and the lead hold a session each, as a live run does.
type pauseFixture struct {
	ctx     context.Context
	channel string
	ownerID string
	dagID   string
	project string
	workers map[string]string // task id -> its child run id
}

func newPauseFixture(t *testing.T, taskIDs ...string) *pauseFixture {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "pause-"+t.Name(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	owner.Runtime, owner.SessionId = "claude", "lead-sess"
	owner.Phases[0].WorkerOrefs = []string{"tab:lead"}
	tasks := make([]waveobj.TaskNode, len(taskIDs))
	for i, id := range taskIDs {
		tasks[i] = waveobj.TaskNode{ID: id, Label: id}
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", len(taskIDs), false, tasks, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	owner.DagORef = g.OID
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	f := &pauseFixture{ctx: ctx, channel: ch.OID, ownerID: owner.ID, dagID: g.OID, project: ch.ProjectPath, workers: map[string]string{}}
	for i, id := range taskIDs {
		child := jarvis.NewRun("child "+id, "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
		child.Runtime, child.SessionId, child.DagORef = "claude", "sess-"+id, g.OID
		child.Phases[0].WorkerOrefs = []string{"tab:w-" + id}
		if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
			t.Fatal(err)
		}
		f.workers[id] = child.ID
		g.Tasks[i].RunID, g.Tasks[i].State = child.ID, TaskState_Running
	}
	g.PlanApprovedTs = 1
	RecomputeDagStatus(&g)
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *pauseFixture) dag(t *testing.T) *waveobj.TaskGroup {
	t.Helper()
	g, err := wstore.GetDag(f.ctx, f.dagID)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func (f *pauseFixture) run(t *testing.T, runID string) *waveobj.Run {
	t.Helper()
	r, err := wstore.GetRun(f.ctx, f.channel, runID)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// markPaused marks the fixture as a pause leaves it, without stopping anything: the owner's Pause record, each
// child's PausedUnder and the dag's PausedTs.
func (f *pauseFixture) markPaused(t *testing.T) {
	t.Helper()
	if err := wstore.UpdateRun(f.ctx, f.channel, f.ownerID, func(r *waveobj.Run) error {
		jarvis.SetRunPause(r, &waveobj.RunPause{PausedTs: time.Now().UnixMilli(), By: "manual"})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for _, runID := range f.workers {
		if err := wstore.UpdateRun(f.ctx, f.channel, runID, func(r *waveobj.Run) error {
			r.PausedUnder = f.ownerID
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(g *waveobj.TaskGroup) error {
		g.PausedTs = time.Now().UnixMilli()
		RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

// stubSuspend scripts jarvis.SuspendRunWorker, whose body is another task's, and returns the tabs it was asked to
// suspend, in order.
func stubSuspend(t *testing.T, fn func(ctx context.Context, tab string) error) *[]string {
	t.Helper()
	var mu sync.Mutex
	var tabs []string
	old := jarvis.SuspendRunWorker
	jarvis.SuspendRunWorker = func(ctx context.Context, tab string) error {
		mu.Lock()
		tabs = append(tabs, tab)
		mu.Unlock()
		if fn == nil {
			return nil
		}
		return fn(ctx, tab)
	}
	restoreAfterStages(t, func() { jarvis.SuspendRunWorker = old })
	return &tabs
}

// reopened is one call of the stubbed jarvis.ResumeRunWorker.
type reopened struct{ tab, runtime, session, nudge string }

func stubResume(t *testing.T, fn func(ctx context.Context, r reopened) error) *[]reopened {
	t.Helper()
	var calls []reopened
	old := jarvis.ResumeRunWorker
	jarvis.ResumeRunWorker = func(ctx context.Context, tab, runtime, session, nudge string) error {
		r := reopened{tab, runtime, session, nudge}
		calls = append(calls, r)
		if fn == nil {
			return nil
		}
		return fn(ctx, r)
	}
	restoreAfterStages(t, func() { jarvis.ResumeRunWorker = old })
	stubTranscripts(t, true)
	return &calls
}

// stubTranscripts makes every Claude session read as having a transcript to resume, or none.
func stubTranscripts(t *testing.T, present bool) {
	t.Helper()
	old := claudeTranscriptFn
	claudeTranscriptFn = func(string) bool { return present }
	restoreAfterStages(t, func() { claudeTranscriptFn = old })
}

func TestRecomputeDagStatusReadsPausedWhilePausedTsIsSet(t *testing.T) {
	cases := map[string]func(g *waveobj.TaskGroup){
		"running":         func(g *waveobj.TaskGroup) {},
		"blocked":         func(g *waveobj.TaskGroup) { g.Tasks[0].State = TaskState_Failed },
		"awaiting review": func(g *waveobj.TaskGroup) { g.Tasks[0].State, g.Tasks[0].Gate = TaskState_Done, true },
		"finalizing":      func(g *waveobj.TaskGroup) { g.Tasks[0].State = TaskState_Done },
		"plan review": func(g *waveobj.TaskGroup) {
			g.PlanReview = &waveobj.PlanReviewStage{State: PlanReviewState_Reviewing}
		},
	}
	for name, setup := range cases {
		t.Run(name, func(t *testing.T) {
			g, err := NewTaskGroup("run", "chan", "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
			if err != nil {
				t.Fatal(err)
			}
			setup(&g)
			RecomputeDagStatus(&g)
			if g.Status == DagStatus_Paused {
				t.Fatalf("fixture reads paused without a pause")
			}
			derived := g.Status
			g.PausedTs = 5
			RecomputeDagStatus(&g)
			if g.Status != DagStatus_Paused {
				t.Fatalf("with PausedTs set the dag reads %q, want paused", g.Status)
			}
			g.PausedTs = 0
			RecomputeDagStatus(&g)
			if g.Status != derived {
				t.Fatalf("after the resume the dag reads %q, want %q again", g.Status, derived)
			}
		})
	}
}

func TestRecomputeDagStatusKeepsDoneAndCancelledOverAPause(t *testing.T) {
	g, err := NewTaskGroup("run", "chan", "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	g.Tasks[0].State = TaskState_Done
	g.Final = &waveobj.FinalStage{State: FinalState_Passed}
	g.PausedTs = 5
	RecomputeDagStatus(&g)
	if g.Status != DagStatus_Done {
		t.Fatalf("a done dag with PausedTs reads %q, want done", g.Status)
	}
	g.Status = DagStatus_Cancelled
	RecomputeDagStatus(&g)
	if g.Status != DagStatus_Cancelled {
		t.Fatalf("a cancelled dag with PausedTs reads %q, want cancelled", g.Status)
	}
}

func TestCancelGroupClearsThePause(t *testing.T) {
	g, err := NewTaskGroup("run", "chan", "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	g.PausedTs = 5
	RecomputeDagStatus(&g)
	CancelGroup(&g)
	if g.PausedTs != 0 || g.Status != DagStatus_Cancelled {
		t.Fatalf("after cancel PausedTs=%d status=%q, want 0 and cancelled", g.PausedTs, g.Status)
	}
}

func TestWatchdogDoesNotListPausedDags(t *testing.T) {
	if slices.Contains(watchdogStatuses, DagStatus_Paused) {
		t.Fatalf("watchdogStatuses %v lists %q, so the watchdog would tick a paused dag", watchdogStatuses, DagStatus_Paused)
	}
}

// the order is the invariant: every exit a suspend causes must already read paused
func TestPauseDagMarksEveryRunBeforeSuspendingAnyAgent(t *testing.T) {
	f := newPauseFixture(t, "t-0", "t-1")
	var seen, bad []string
	tabs := stubSuspend(t, func(ctx context.Context, tab string) error {
		seen = append(seen, tab)
		g := f.dag(t)
		if g.PausedTs == 0 || g.Status != DagStatus_Paused {
			bad = append(bad, tab+": the dag was not paused yet")
		}
		for id, runID := range f.workers {
			if r := f.run(t, runID); r.PausedUnder != f.ownerID {
				bad = append(bad, tab+": run of "+id+" was not marked yet")
			}
		}
		return nil
	})
	got, err := PauseDag(f.ctx, f.dagID, f.ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if len(bad) > 0 {
		t.Fatalf("a suspend ran before the marks were written: %v", bad)
	}
	want := []waveobj.PausedSession{
		{RunId: f.ownerID, WorkerORef: "tab:lead", Runtime: "claude", SessionId: "lead-sess"},
		{RunId: f.workers["t-0"], WorkerORef: "tab:w-t-0", Runtime: "claude", SessionId: "sess-t-0"},
		{RunId: f.workers["t-1"], WorkerORef: "tab:w-t-1", Runtime: "claude", SessionId: "sess-t-1"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("suspended sessions = %+v, want %+v", got, want)
	}
	if !slices.Equal(*tabs, []string{"tab:lead", "tab:w-t-0", "tab:w-t-1"}) {
		t.Fatalf("suspended tabs = %v", *tabs)
	}
	if owner := f.run(t, f.ownerID); owner.PausedUnder != "" {
		t.Fatalf("the top-level run was marked PausedUnder %q: it carries the Pause record instead", owner.PausedUnder)
	}
	if g := f.dag(t); g.PausedTs == 0 || g.Status != DagStatus_Paused {
		t.Fatalf("dag PausedTs=%d status=%q", g.PausedTs, g.Status)
	}
}

func TestPauseDagMarksTheDagOwnerWhenItIsAChildRun(t *testing.T) {
	f := newPauseFixture(t, "t-0")
	stubSuspend(t, nil)
	if _, err := PauseDag(f.ctx, f.dagID, "top-run"); err != nil {
		t.Fatal(err)
	}
	if owner := f.run(t, f.ownerID); owner.PausedUnder != "top-run" {
		t.Fatalf("the dag's owner run is marked %q, want top-run", owner.PausedUnder)
	}
	if child := f.run(t, f.workers["t-0"]); child.PausedUnder != "top-run" {
		t.Fatalf("the task's run is marked %q, want top-run", child.PausedUnder)
	}
}

func TestPauseDagSkipsRunsThatAreNotLive(t *testing.T) {
	f := newPauseFixture(t, "t-0", "t-1")
	// t-0 finished: its run is done, so no session of it is running
	if err := wstore.UpdateRun(f.ctx, f.channel, f.workers["t-0"], func(r *waveobj.Run) error {
		next, err := jarvis.CompletePhase(*r, 0, nil, 2)
		*r = next
		return err
	}); err != nil {
		t.Fatal(err)
	}
	tabs := stubSuspend(t, nil)
	got, err := PauseDag(f.ctx, f.dagID, f.ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(*tabs, "tab:w-t-0") || len(got) != 2 {
		t.Fatalf("suspended %v (%d sessions), want the lead and t-1 only", *tabs, len(got))
	}
	if r := f.run(t, f.workers["t-0"]); r.PausedUnder != f.ownerID {
		t.Fatalf("a finished run is still marked, so its tab-close reads paused: %q", r.PausedUnder)
	}
}

func TestPauseDagStopsVerifyAndFinalAndReleasesTheWorkerClaim(t *testing.T) {
	f := newPauseFixture(t, "t-0")
	stubSuspend(t, nil)
	verifyCtx, stopVerify := context.WithCancel(context.Background())
	defer stopVerify()
	l, err := claimProject(f.project, f.dagID, "t-0")
	if err != nil {
		t.Fatal(err)
	}
	defer releaseProject(f.project, l)
	landings.Lock()
	l.cancel = stopVerify
	landings.Unlock()
	finalCtx, stopFinal := context.WithCancel(context.Background())
	defer stopFinal()
	finalRuns.Lock()
	finalRuns.byDag[f.dagID] = stopFinal
	finalRuns.verdicts[f.dagID] = finalVerdict{round: 1}
	finalRuns.Unlock()
	defer func() {
		finalRuns.Lock()
		delete(finalRuns.byDag, f.dagID)
		finalRuns.Unlock()
	}()
	workerClaims.Lock()
	workerClaims.byDag[f.dagID] = 2
	workerClaims.Unlock()

	if _, err := PauseDag(f.ctx, f.dagID, f.ownerID); err != nil {
		t.Fatal(err)
	}
	if verifyCtx.Err() == nil {
		t.Fatal("the running Verify was not cancelled")
	}
	if finalCtx.Err() == nil {
		t.Fatal("the running final commands were not cancelled")
	}
	finalRuns.Lock()
	_, held := finalRuns.verdicts[f.dagID]
	finalRuns.Unlock()
	if held {
		t.Fatal("the held final verdict was kept")
	}
	workerClaims.Lock()
	claim := workerClaims.byDag[f.dagID]
	workerClaims.Unlock()
	if claim != 0 {
		t.Fatalf("the dag still holds %d worker claims", claim)
	}
}

func TestPauseDagRefusesADoneOrCancelledDagAndIsIdempotent(t *testing.T) {
	f := newPauseFixture(t, "t-0")
	tabs := stubSuspend(t, nil)
	if _, err := PauseDag(f.ctx, f.dagID, f.ownerID); err != nil {
		t.Fatal(err)
	}
	first := f.dag(t).PausedTs
	*tabs = nil
	again, err := PauseDag(f.ctx, f.dagID, f.ownerID)
	if err != nil || len(again) != 0 || len(*tabs) != 0 {
		t.Fatalf("pausing a paused dag: sessions=%v tabs=%v err=%v, want no change and no error", again, *tabs, err)
	}
	if got := f.dag(t).PausedTs; got != first {
		t.Fatalf("a second pause moved PausedTs from %d to %d", first, got)
	}
	for status, set := range map[string]func(*waveobj.TaskGroup){
		DagStatus_Cancelled: func(g *waveobj.TaskGroup) { CancelGroup(g) },
		DagStatus_Done: func(g *waveobj.TaskGroup) {
			g.Tasks[0].State, g.Final, g.PausedTs = TaskState_Done, &waveobj.FinalStage{State: FinalState_Passed}, 0
		},
	} {
		if err := wstore.UpdateDag(f.ctx, f.dagID, func(g *waveobj.TaskGroup) error {
			set(g)
			RecomputeDagStatus(g)
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := PauseDag(f.ctx, f.dagID, f.ownerID); err == nil {
			t.Fatalf("pausing a %s dag succeeded", status)
		}
	}
}

// the merge holds the dag lock, and a pause waits for it: the lane is on the branch or it is not, never half
func TestPauseDagWaitsForAMergeUnderWayThenPauses(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.finish(t, "t-0")
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(release) }) })
	stubMerge(t, func(context.Context, string, string, string) (string, error) {
		close(entered)
		<-release
		return "sha-1", nil
	})
	stubCleanupRemover(t, func(context.Context, string, string) error { return nil })
	stubSuspend(t, nil)
	merged := make(chan struct{})
	go func() {
		AutoMergeReady(f.ctx, f.dagID)
		close(merged)
	}()
	<-entered
	paused := make(chan error, 1)
	go func() {
		_, err := PauseDag(f.ctx, f.dagID, f.ownerID)
		paused <- err
	}()
	select {
	case err := <-paused:
		t.Fatalf("the pause finished while the merge held the dag lock (err=%v)", err)
	case <-time.After(300 * time.Millisecond):
	}
	if g := f.dag(t); g.PausedTs != 0 {
		t.Fatal("the dag was marked paused mid-merge")
	}
	once.Do(func() { close(release) })
	select {
	case err := <-paused:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the pause never finished after the merge")
	}
	<-merged
	g := f.dag(t)
	if g.PausedTs == 0 || !g.Tasks[0].Merged {
		t.Fatalf("PausedTs=%d merged=%v, want a paused dag whose merge finished", g.PausedTs, g.Tasks[0].Merged)
	}
}

// Setup holds the dag lock for up to SetupTimeout: the pause cuts it off at once, and the task is not failed for it
func TestPauseDagCancelsARunningSetupAtOnce(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	var spawned []string
	stubSpawn(t, &spawned)
	stubSuspend(t, nil)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(release) }) })
	stubPlanCommand(t, func(ctx context.Context, _, command string) error {
		if command != setupCmd {
			return nil
		}
		close(entered)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-release:
			return nil
		}
	})
	ticked := make(chan error, 1)
	go func() { ticked <- Schedule(f.ctx, f.dagID) }()
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("Setup never started")
	}
	paused := make(chan error, 1)
	go func() {
		_, err := PauseDag(f.ctx, f.dagID, f.ownerID)
		paused <- err
	}()
	select {
	case err := <-paused:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the pause waited for Setup instead of cutting it off")
	}
	if err := <-ticked; err != nil {
		t.Fatal(err)
	}
	g := f.dag(t)
	if g.PausedTs == 0 {
		t.Fatal("the dag is not paused")
	}
	if task := g.Tasks[0]; task.State != TaskState_Pending || task.Attempts != 0 || task.RunID != "" {
		t.Fatalf("a Setup the pause cut off left the task %q (attempts %d, run %q), want pending and untried", task.State, task.Attempts, task.RunID)
	}
	if len(spawned) != 0 {
		t.Fatalf("a worker was spawned after its Setup was cut off: %d", len(spawned))
	}
}

// a Setup waiting for a heavy-job slot holds the dag lock with no bound on the wait: a cancel cuts it off at once, as
// a pause does, instead of waiting behind it
func TestCancelCutsOffARunningSetupAtOnce(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	var spawned []string
	stubSpawn(t, &spawned)
	stubSuspend(t, nil)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(release) }) })
	stubPlanCommand(t, func(ctx context.Context, _, command string) error {
		if command != setupCmd {
			return nil
		}
		close(entered)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-release:
			return nil
		}
	})
	ticked := make(chan error, 1)
	go func() { ticked <- Schedule(f.ctx, f.dagID) }()
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("Setup never started")
	}
	cancelled := make(chan error, 1)
	go func() { cancelled <- Cancel(f.ctx, f.dagID) }()
	select {
	case err := <-cancelled:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the cancel waited for Setup instead of cutting it off")
	}
	if err := <-ticked; err != nil {
		t.Fatal(err)
	}
	if g := f.dag(t); g.Status != DagStatus_Cancelled {
		t.Fatalf("dag status %q, want cancelled", g.Status)
	}
	if len(spawned) != 0 {
		t.Fatalf("a worker was spawned after its Setup was cut off: %d", len(spawned))
	}
}

// the final stage's own Setup runs under the dag lock too (advanceFinal): cut off by a pause it fails nothing
func TestPausedDagFinalTreeSetupIsCutOffNotFailed(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	stubPlanCommand(t, func(ctx context.Context, _, command string) error {
		<-ctx.Done()
		return ctx.Err()
	})
	owner, err := wstore.GetRun(f.ctx, f.channel, f.ownerID)
	if err != nil {
		t.Fatal(err)
	}
	endPausing := stopDagSetup(f.dagID)
	defer endPausing()
	tree, _, err := finalTree(f.ctx, f.dag(t), owner)
	if !errors.Is(err, errSetupPaused) || tree != "" {
		t.Fatalf("finalTree = %q, %v; want a cut-off Setup to return errSetupPaused, not a Setup failure", tree, err)
	}
}

// the base Check judges the base, not the pause: cut off, it leaves its state running for the next tick to run again
func TestPausedDagBaseCheckIsCutOffAndRecordsNothing(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	head := gitCmd(t, f.project, "rev-parse", "HEAD")
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(g *waveobj.TaskGroup) error {
		g.Check = "check-base"
		g.BaseCheck = &waveobj.BaseCheck{State: BaseCheckState_Running, Commit: head}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	stubPlanCommand(t, func(ctx context.Context, _, command string) error {
		<-ctx.Done()
		return ctx.Err()
	})
	endPausing := stopDagSetup(f.dagID)
	defer endPausing()
	startBaseCheck(f.dagID, f.ownerID, f.project, head, "", "check-base")
	waitStages(t)
	if got := f.dag(t).BaseCheck; got == nil || got.State != BaseCheckState_Running {
		t.Fatalf("a base Check the pause cut off recorded %+v, want it still running", got)
	}
}

func TestPausedDagTickSpawnsNothing(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	var spawned []string
	stubSpawn(t, &spawned)
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(g *waveobj.TaskGroup) error {
		g.PausedTs = time.Now().UnixMilli()
		RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if g := f.dag(t); len(spawned) != 0 || g.Tasks[0].State != TaskState_Pending || g.Status != DagStatus_Paused {
		t.Fatalf("a paused dag's tick spawned %d workers; task %q, dag %q", len(spawned), g.Tasks[0].State, g.Status)
	}
}

func TestPausedDagTickMergesNothing(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.finish(t, "t-0")
	calls := stubMerge(t, func(context.Context, string, string, string) (string, error) { return "sha-1", nil })
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(g *waveobj.TaskGroup) error {
		g.PausedTs = time.Now().UnixMilli()
		RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	AutoMergeReady(f.ctx, f.dagID)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if *calls != 0 || f.dag(t).Tasks[0].Merged {
		t.Fatalf("a paused dag merged (%d merges)", *calls)
	}
}

// the pause check of a merge is the dag's own, not the run's: a hand merge RPC reaches it too
func TestPausedDagRefusesAMergeAlreadyUnderWay(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, {ID: "t-1", Label: "second"}})
	f.finish(t, "t-0")
	f.finish(t, "t-1")
	calls := stubMerge(t, func(context.Context, string, string, string) (string, error) { return "sha-1", nil })
	stubCleanupRemover(t, func(context.Context, string, string) error { return nil })
	stubStopRunWorkers(t)
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(g *waveobj.TaskGroup) error {
		g.PausedTs = time.Now().UnixMilli()
		RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := MergeTask(f.ctx, f.channel, f.ownerID, "t-0"); err == nil {
		t.Fatal("a hand merge of a paused dag succeeded")
	}
	if *calls != 0 {
		t.Fatalf("a paused dag merged %d lanes", *calls)
	}
}

func TestRetryCleanupDebtDoesNothingForAPausedDag(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	var removed atomic.Int32
	stubCleanupRemover(t, func(context.Context, string, string) error {
		removed.Add(1)
		return nil
	})
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State, g.Tasks[0].Merged, g.Tasks[0].CleanupPending = TaskState_Done, true, true
		g.PausedTs = time.Now().UnixMilli()
		RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	RetryCleanupDebt(f.ctx, f.dagID)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if removed.Load() != 0 || !f.dag(t).Tasks[0].CleanupPending {
		t.Fatalf("a paused dag retried its cleanup debt (%d removals)", removed.Load())
	}
}

func TestPausedDagTickDoesNotStallATaskWhoseControllerIsGone(t *testing.T) {
	f := newPauseFixture(t, "t-0")
	f.markPaused(t)
	old := workerControllerGone
	workerControllerGone = func(context.Context, *waveobj.Run) bool { return true }
	t.Cleanup(func() { workerControllerGone = old })
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if task := f.dag(t).Tasks[0]; task.State != TaskState_Running {
		t.Fatalf("a suspended worker's task reads %q after a paused tick, want running", task.State)
	}
}

func TestPausedDagLeavesAStalledTaskToItsResume(t *testing.T) {
	f := newPauseFixture(t, "t-0")
	f.markPaused(t)
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State = TaskState_Stalled
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if retried := autoRetryStalled(f.ctx, f.dagID, stalledTask{taskID: "t-0", runID: f.workers["t-0"]}); retried {
		t.Fatal("a paused dag's stalled task was retried")
	}
	if task := f.dag(t).Tasks[0]; task.State != TaskState_Stalled || task.RunID != f.workers["t-0"] {
		t.Fatalf("the stalled task became %q run %q", task.State, task.RunID)
	}
	if r := f.run(t, f.workers["t-0"]); r.Status == jarvis.RunStatus_Cancelled {
		t.Fatal("the stalled task's run was cancelled")
	}
}

func TestWatchdogTickLeavesAPausedDagAlone(t *testing.T) {
	for _, status := range []string{DagStatus_Paused, DagStatus_Running} {
		t.Run("status "+status, func(t *testing.T) {
			ctx, g, _, _ := seedDispatchDag(t, "watchdog-paused-"+status)
			var spawned []string
			stubSpawn(t, &spawned)
			if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
				cur.PausedTs = time.Now().UnixMilli()
				RecomputeDagStatus(cur)
				// a row a writer left reading running while PausedTs is set is still never advanced
				cur.Status = status
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			watchdogTick(ctx)
			got, err := wstore.GetDag(ctx, g.OID)
			if err != nil {
				t.Fatal(err)
			}
			if got.Tasks[0].State != TaskState_Pending || got.Tasks[0].RunID != "" {
				t.Fatalf("the watchdog advanced a paused dag: task %q run %q", got.Tasks[0].State, got.Tasks[0].RunID)
			}
		})
	}
}

// the Verify the pause killed judged nothing: its tips stay verifying, and the resume runs it again
func TestPausedDagVerifyIsCutOffRecordsNothingAndResumeRerunsIt(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, {ID: "t-1", Label: "second"}})
	f.setPlanCommands(t, "verify-all", "")
	f.finish(t, "t-0")
	stubMerge(t, func(context.Context, string, string, string) (string, error) { return "sha-1", nil })
	stubCleanupRemover(t, func(context.Context, string, string) error { return nil })
	stubStopRunWorkers(t)
	stubSuspend(t, nil)
	var spawned []string
	stubSpawn(t, &spawned)
	var verifies atomic.Int32
	started := make(chan struct{}, 4)
	stubPlanCommand(t, func(ctx context.Context, _, command string) error {
		if command != "verify-all" {
			return nil
		}
		if verifies.Add(1) == 1 {
			started <- struct{}{}
			<-ctx.Done()
			return ctx.Err()
		}
		return nil
	})
	AutoMergeReady(f.ctx, f.dagID)
	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("Verify never started")
	}
	if _, err := PauseDag(f.ctx, f.dagID, f.ownerID); err != nil {
		t.Fatal(err)
	}
	// what runpause leaves: the top-level run keeps its Pause record while the dag resumes
	if err := wstore.UpdateRun(f.ctx, f.channel, f.ownerID, func(r *waveobj.Run) error {
		jarvis.SetRunPause(r, &waveobj.RunPause{PausedTs: time.Now().UnixMilli(), By: "manual"})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	waitStages(t)
	g := f.dag(t)
	if g.Tasks[0].State != TaskState_Verifying {
		t.Fatalf("the cut-off Verify recorded %q on its tip, want verifying", g.Tasks[0].State)
	}
	if n := countEvents(t, f.ctx, f.channel, f.ownerID, waveobj.RunEventKindTaskVerifyFailed); n != 0 {
		t.Fatalf("the cut-off Verify recorded %d verify-failed events", n)
	}
	if len(spawned) != 0 {
		t.Fatalf("the paused dag spawned %d workers", len(spawned))
	}

	if err := ResumeDag(f.ctx, f.dagID, nil); err != nil {
		t.Fatal(err)
	}
	waitStages(t)
	g = f.dag(t)
	if g.PausedTs != 0 {
		t.Fatalf("the dag is still paused: %d", g.PausedTs)
	}
	if g.Tasks[0].State != TaskState_Done || verifies.Load() != 2 {
		t.Fatalf("after the resume t-0 is %q after %d Verify runs, want done after 2", g.Tasks[0].State, verifies.Load())
	}
	if g.Tasks[1].State != TaskState_Running || len(spawned) != 1 {
		t.Fatalf("after the resume t-1 is %q with %d workers spawned, want the tick to dispatch it", g.Tasks[1].State, len(spawned))
	}
	if owner, err := wstore.GetRun(f.ctx, f.channel, f.ownerID); err != nil || owner.Pause == nil {
		t.Fatalf("ResumeDag cleared the top-level run's Pause record (err=%v); pkg/runpause owns it", err)
	}
}

// a resume can beat the record of the Verify the pause killed, when the kill is slow: the cut-off command's result is
// still no verdict, and must not be read as a failure now that the dag is no longer paused
func TestResumeDagBeforeACutOffVerifyRecordsItsResultIsNotAFailure(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, {ID: "t-1", Label: "second"}})
	f.setPlanCommands(t, "verify-all", "")
	f.finish(t, "t-0")
	stubMerge(t, func(context.Context, string, string, string) (string, error) { return "sha-1", nil })
	stubCleanupRemover(t, func(context.Context, string, string) error { return nil })
	stubSuspend(t, nil)
	var verifies atomic.Int32
	started, slowKill := make(chan struct{}, 4), make(chan struct{})
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(slowKill) }) })
	stubPlanCommand(t, func(ctx context.Context, _, command string) error {
		if command != "verify-all" {
			return nil
		}
		if verifies.Add(1) == 1 {
			started <- struct{}{}
			<-ctx.Done()
			<-slowKill
			return ctx.Err()
		}
		return nil
	})
	AutoMergeReady(f.ctx, f.dagID)
	<-started
	if _, err := PauseDag(f.ctx, f.dagID, f.ownerID); err != nil {
		t.Fatal(err)
	}
	if err := ResumeDag(f.ctx, f.dagID, nil); err != nil {
		t.Fatal(err)
	}
	// the old Verify still holds its claim, so the resume could not restart it; now it ends and records
	once.Do(func() { close(slowKill) })
	waitStages(t)
	if n := countEvents(t, f.ctx, f.channel, f.ownerID, waveobj.RunEventKindTaskVerifyFailed); n != 0 {
		t.Fatalf("the cut-off Verify's result was recorded as %d failures after the resume", n)
	}
	if got := f.dag(t).Tasks[0]; got.State != TaskState_Done || verifies.Load() != 2 {
		t.Fatalf("t-0 is %q after %d Verify runs, want done after a second Verify judged it", got.State, verifies.Load())
	}
}

// a merge that landed just before the pause starts its Verify after it: the tips stay verifying for the resume
func TestPausedDagStartsNoVerifyForItsVerifyingTips(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "verify-all", "")
	f.finish(t, "t-0")
	var verifies atomic.Int32
	stubPlanCommand(t, func(_ context.Context, _, command string) error {
		if command == "verify-all" {
			verifies.Add(1)
		}
		return nil
	})
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State, g.Tasks[0].Merged = TaskState_Verifying, true
		g.PausedTs = time.Now().UnixMilli()
		RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	g := f.dag(t)
	resumeVerify(f.ctx, g)
	waitStages(t)
	if verifies.Load() != 0 || f.dag(t).Tasks[0].State != TaskState_Verifying {
		t.Fatalf("a paused dag ran %d Verify commands; tip %q", verifies.Load(), f.dag(t).Tasks[0].State)
	}
	// and its claim on the project went with it, so the resume's Verify can take it
	owner, err := wstore.GetRun(f.ctx, f.channel, f.ownerID)
	if err != nil {
		t.Fatal(err)
	}
	l, err := claimProject(jarvis.LandPath(owner), f.dagID, "t-0")
	if err != nil {
		t.Fatalf("the project is still claimed: %v", err)
	}
	releaseProject(jarvis.LandPath(owner), l)
}

func TestPausedDagVerifyResultRecordsNothing(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.finish(t, "t-0")
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State, g.Tasks[0].Merged = TaskState_Verifying, true
		g.PausedTs = time.Now().UnixMilli()
		RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	out := batchOutcome{batch: []string{"t-0"}, failed: "t-0", err: errors.New("exit 1"), output: "boom"}
	if err := recordBatchVerifyLocked(f.ctx, f.dagID, out, 5); err != nil {
		t.Fatal(err)
	}
	if got := f.dag(t).Tasks[0]; got.State != TaskState_Verifying || got.VerifyError != "" {
		t.Fatalf("a result for a paused dag moved the tip to %q (%q)", got.State, got.VerifyError)
	}
}

func TestPausedDagFinalResultRecordsNothing(t *testing.T) {
	f := newPauseFixture(t, "t-0")
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State = TaskState_Done
		g.Final = &waveobj.FinalStage{State: FinalState_Final, Round: 1, Step: FinalStep_Final, StepTs: 7, Tree: "tree"}
		g.PausedTs = time.Now().UnixMilli()
		RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var removeTree bool
	err := WithDagMutation(f.dagID, func() error {
		var rerr error
		removeTree, rerr = recordFinalLocked(f.ctx, f.ctx, f.dagID, &waveobj.Run{}, finalResult{round: 1, tree: "tree", detail: "Final failed", killed: true, onStage: true})
		return rerr
	})
	if err != nil {
		t.Fatal(err)
	}
	g := f.dag(t)
	if g.Final.State != FinalState_Final || g.Final.Detail != "" || g.Final.Step != FinalStep_Final {
		t.Fatalf("a result for a paused dag changed the stage: %+v", g.Final)
	}
	if removeTree {
		t.Fatal("the stage's own tree was removed")
	}
}

// the commands the pause killed may record after the resume: stopDagFinal cancelled them, so what they found is no result
func TestPausedDagFinalCutOffResultRecordsNothingAfterTheResume(t *testing.T) {
	f := newPauseFixture(t, "t-0")
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State = TaskState_Done
		g.Final = &waveobj.FinalStage{State: FinalState_Final, Round: 1, Step: FinalStep_Final, StepTs: 7}
		RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var removeTree bool
	if err := WithDagMutation(f.dagID, func() error {
		var rerr error
		removeTree, rerr = recordFinalLocked(f.ctx, f.ctx, f.dagID, &waveobj.Run{}, finalResult{round: 1, tree: "made-by-commands", detail: "Final failed", killed: true, cutOff: true})
		return rerr
	}); err != nil {
		t.Fatal(err)
	}
	if g := f.dag(t); g.Final.State != FinalState_Final || g.Final.Detail != "" {
		t.Fatalf("a cut-off result changed the stage: %+v", g.Final)
	}
	if !removeTree {
		t.Fatal("a tree only the cut-off commands made was kept")
	}
}

func TestResumeDagReopensEverySessionBeforeItClearsThePause(t *testing.T) {
	f := newPauseFixture(t, "t-0", "t-1")
	stubSuspend(t, nil)
	sessions, err := PauseDag(f.ctx, f.dagID, f.ownerID)
	if err != nil {
		t.Fatal(err)
	}
	// the owner is top-level, so it carries the Pause record that outlives the dag's resume
	if err := wstore.UpdateRun(f.ctx, f.channel, f.ownerID, func(r *waveobj.Run) error {
		jarvis.SetRunPause(r, &waveobj.RunPause{PausedTs: 1, By: "manual", Sessions: sessions})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var stillPaused []string
	calls := stubResume(t, func(ctx context.Context, r reopened) error {
		if f.dag(t).PausedTs == 0 {
			stillPaused = append(stillPaused, r.tab)
		}
		return nil
	})
	if err := ResumeDag(f.ctx, f.dagID, sessions); err != nil {
		t.Fatal(err)
	}
	if len(stillPaused) != 0 {
		t.Fatalf("sessions %v were reopened after the dag was unpaused: their exits would read as failures", stillPaused)
	}
	var want []reopened
	for _, s := range sessions {
		want = append(want, reopened{tab: s.WorkerORef, runtime: s.Runtime, session: s.SessionId, nudge: jarvis.PausedNudge(f.ctx, s.WorkerORef)})
	}
	if len(want) != 3 || !reflect.DeepEqual(*calls, want) {
		t.Fatalf("reopened %+v, want %+v", *calls, want)
	}
	g := f.dag(t)
	if g.PausedTs != 0 || g.Status != DagStatus_Running {
		t.Fatalf("after the resume PausedTs=%d status=%q", g.PausedTs, g.Status)
	}
	for id, runID := range f.workers {
		if r := f.run(t, runID); r.PausedUnder != "" {
			t.Fatalf("task %s's run is still marked paused under %q", id, r.PausedUnder)
		}
	}
	if owner := f.run(t, f.ownerID); owner.Pause == nil {
		t.Fatal("ResumeDag cleared the top-level run's Pause record; pkg/runpause owns it")
	}
}

func TestResumeDagGoesOnWhenASessionCannotBeReopened(t *testing.T) {
	f := newPauseFixture(t, "t-0", "t-1")
	stubSuspend(t, nil)
	sessions, err := PauseDag(f.ctx, f.dagID, f.ownerID)
	if err != nil {
		t.Fatal(err)
	}
	calls := stubResume(t, func(_ context.Context, r reopened) error {
		if r.tab == "tab:w-t-0" {
			return errors.New("the worker's tab is gone")
		}
		return nil
	})
	if err := ResumeDag(f.ctx, f.dagID, sessions); err != nil {
		t.Fatalf("one session that would not reopen failed the whole resume: %v", err)
	}
	if len(*calls) != 3 {
		t.Fatalf("reopened %d sessions, want an attempt at each of 3", len(*calls))
	}
	if f.dag(t).PausedTs != 0 {
		t.Fatal("the dag is still paused")
	}
}

func TestResumeDagLeavesANotPausedDagAlone(t *testing.T) {
	f := newPauseFixture(t, "t-0")
	calls := stubResume(t, nil)
	if err := ResumeDag(f.ctx, f.dagID, []waveobj.PausedSession{{RunId: f.ownerID, WorkerORef: "tab:lead", Runtime: "claude", SessionId: "lead-sess"}}); err != nil {
		t.Fatal(err)
	}
	if len(*calls) != 0 {
		t.Fatalf("a dag that is not paused had %d sessions reopened", len(*calls))
	}
}

// the pause must not count toward the stall clock: a worker silent for the whole pause is not stalled by it
func TestResumeDagDoesNotStallATaskWithAnOldTranscript(t *testing.T) {
	allowWorkerHarnessForTest(t)
	f := newPauseFixture(t, "t-0")
	oldRoot := sessionsRootFor
	root := t.TempDir()
	sessionsRootFor = func(string) string { return root }
	t.Cleanup(func() { sessionsRootFor = oldRoot })
	quiet := time.Now().Add(-StallThreshold - time.Hour)
	writeClaudeSession(t, root, f.project, liveSession, quiet)
	if err := wstore.UpdateRun(f.ctx, f.channel, f.workers["t-0"], func(r *waveobj.Run) error {
		r.SessionId = liveSession
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].LastActivity = quiet.UnixMilli()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	stubSuspend(t, nil)
	stubResume(t, nil)
	sessions, err := PauseDag(f.ctx, f.dagID, f.ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if err := ResumeDag(f.ctx, f.dagID, sessions); err != nil {
		t.Fatal(err)
	}
	task := f.dag(t).Tasks[0]
	if task.State != TaskState_Running {
		t.Fatalf("a resumed task reads %q on its first tick, want running", task.State)
	}
	if now := time.Now().UnixMilli(); now-task.LastActivity > 60_000 {
		t.Fatalf("the activity baseline is %d ms old, want the resume time", now-task.LastActivity)
	}
}

// insertTab stores a tab with a block, so a worker's tab exists for the owner stamp and the resume to find
func insertTab(t *testing.T, ctx context.Context) string {
	t.Helper()
	tabID, blockID := uuid.NewString(), uuid.NewString()
	oref := waveobj.MakeORef(waveobj.OType_Tab, tabID).String()
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabID, BlockIds: []string{blockID}, Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.DBInsert(ctx, &waveobj.Block{OID: blockID, ParentORef: oref, Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatal(err)
	}
	return oref
}

func TestReopenSessionResumesTheSessionInItsOwnTab(t *testing.T) {
	f := newPauseFixture(t, "t-0")
	tab := insertTab(t, f.ctx)
	calls := stubResume(t, nil)
	s := waveobj.PausedSession{RunId: f.workers["t-0"], WorkerORef: tab, Runtime: "claude", SessionId: "sess-t-0"}
	if err := ReopenSession(f.ctx, s, "carry on"); err != nil {
		t.Fatal(err)
	}
	if want := []reopened{{tab, "claude", "sess-t-0", "carry on"}}; !reflect.DeepEqual(*calls, want) {
		t.Fatalf("reopened %+v, want %+v", *calls, want)
	}
}

func TestReopenSessionResumesInANewTabWhenItsTabWasClosed(t *testing.T) {
	allowWorkerHarnessForTest(t)
	f := newPauseFixture(t, "t-0")
	closed := "tab:" + uuid.NewString()
	if err := wstore.UpdateRun(f.ctx, f.channel, f.workers["t-0"], func(r *waveobj.Run) error {
		r.Phases[0].WorkerOrefs = []string{closed}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var newTab string
	oldSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(ctx context.Context, _ runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		newTab = insertTab(t, ctx)
		return newTab, nil
	}
	restoreAfterStages(t, func() { jarvis.SpawnRunWorker = oldSpawn })
	calls := stubResume(t, nil)
	s := waveobj.PausedSession{RunId: f.workers["t-0"], WorkerORef: closed, Runtime: "claude", SessionId: "sess-t-0"}
	if err := ReopenSession(f.ctx, s, "carry on"); err != nil {
		t.Fatal(err)
	}
	if newTab == "" {
		t.Fatal("no new tab was made for the closed one")
	}
	if want := []reopened{{newTab, "claude", "sess-t-0", "carry on"}}; !reflect.DeepEqual(*calls, want) {
		t.Fatalf("reopened %+v, want %+v", *calls, want)
	}
	// the new tab takes the closed one's place on the phase that held it
	if got := f.run(t, f.workers["t-0"]).Phases[0].WorkerOrefs; !slices.Equal(got, []string{newTab}) {
		t.Fatalf("the phase's workers are %v, want %v", got, []string{newTab})
	}
}

// the restart returns before the process runs, so a lead the resume reopened gets the wake-confirm timeout to come up, as
// a launched one does; without it the first wake finds the process "not running" and hands the run over as if the lead
// had died
func TestReopenSessionGivesALeadTimeToComeUp(t *testing.T) {
	f := newPauseFixture(t, "t-0")
	origWakes := wakes
	wakes = newWaker()
	restoreAfterStages(t, func() { wakes = origWakes })
	stubResume(t, nil)
	leadTab, workerTab := insertTab(t, f.ctx), insertTab(t, f.ctx)

	worker := waveobj.PausedSession{RunId: f.workers["t-0"], WorkerORef: workerTab, Runtime: "claude", SessionId: "sess-t-0"}
	if err := ReopenSession(f.ctx, worker, "carry on"); err != nil {
		t.Fatal(err)
	}
	wakes.lock.Lock()
	_, tracked := wakes.runs[f.workers["t-0"]]
	wakes.lock.Unlock()
	if tracked {
		t.Fatal("a task's worker is not a lead: reopening it must not start a wake record")
	}

	lead := waveobj.PausedSession{RunId: f.ownerID, WorkerORef: leadTab, Runtime: "claude", SessionId: "lead-sess"}
	before := time.Now().UnixMilli()
	if err := ReopenSession(f.ctx, lead, "carry on"); err != nil {
		t.Fatal(err)
	}
	wakes.lock.Lock()
	rw := wakes.runs[f.ownerID]
	wakes.lock.Unlock()
	if rw == nil || rw.launchedAt < before {
		t.Fatalf("a reopened lead is stamped as just restarted, got %+v", rw)
	}
}

func TestReopenSessionRefusesASessionItsRunNoLongerHolds(t *testing.T) {
	f := newPauseFixture(t, "t-0")
	stubResume(t, nil)
	s := waveobj.PausedSession{RunId: f.workers["t-0"], WorkerORef: "tab:" + uuid.NewString(), Runtime: "claude", SessionId: "sess-t-0"}
	err := ReopenSession(f.ctx, s, "carry on")
	if err == nil || !strings.Contains(err.Error(), "tab") {
		t.Fatalf("reopening a tab the run does not hold: %v, want an error naming it", err)
	}
}

// a suspended worker's exit is not a failure: it must change no phase, task or event
func TestHandleRunWorkerExitOfAPausedRunRecordsNothing(t *testing.T) {
	for name, c := range pausedQuickRuns {
		t.Run(name, func(t *testing.T) {
			kinds := captureRunEvents(t)
			channelId, run := newPausedQuickRun(t, c.pause)
			if err := HandleRunWorkerExit(context.Background(), "tab:worker", jarvis.WorkerExit{ExitCode: 1, Output: "killed"}); err != nil {
				t.Fatal(err)
			}
			got, err := wstore.GetRun(context.Background(), channelId, run.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got.Phases[0].State != jarvis.PhaseState_Running || got.Status != c.status {
				t.Fatalf("a suspended worker's exit left phase=%q status=%q, want running and %q", got.Phases[0].State, got.Status, c.status)
			}
			// before recordWorkerOutput, so a suspended worker logs no worker-output row either
			if k := kinds[run.ID]; len(k) != 0 {
				t.Fatalf("a suspended worker's exit recorded %v", k)
			}
		})
	}
}

// pausedQuickRuns are the two shapes of a quick run whose worker a pause suspended: the top-level run, whose derived
// status reads paused, and a child run under a paused one, which keeps its executing status and carries only the mark.
var pausedQuickRuns = map[string]struct {
	pause  func(r *waveobj.Run)
	status string // the run's status while paused, which no exit or tab-close may change
}{
	"top-level run": {
		pause:  func(r *waveobj.Run) { jarvis.SetRunPause(r, &waveobj.RunPause{PausedTs: 1, By: "manual"}) },
		status: jarvis.RunStatus_Paused,
	},
	"child run": {
		pause:  func(r *waveobj.Run) { r.PausedUnder = "top-run" },
		status: jarvis.RunStatus_Executing,
	},
}

// newPausedQuickRun stores a quick run whose worker is "tab:worker", paused as pause says, and points the tab's owner
// stamp at it.
func newPausedQuickRun(t *testing.T, pause func(*waveobj.Run)) (string, waveobj.Run) {
	t.Helper()
	channelId, run := newInterruptedRun(t, nil)
	oldOwner := workerOwnerOf
	workerOwnerOf = func(context.Context, string) (string, string, error) {
		return waveobj.MakeORef(waveobj.OType_Run, run.ID).String(), waveobj.MakeORef(waveobj.OType_Channel, channelId).String(), nil
	}
	t.Cleanup(func() { workerOwnerOf = oldOwner })
	if err := wstore.UpdateRun(context.Background(), channelId, run.ID, func(r *waveobj.Run) error {
		pause(r)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return channelId, run
}

func TestHandleRunWorkerExitOfAPausedDagChildRecordsNoWorkerOutput(t *testing.T) {
	h := newChildOutcomeHarness(t, 1)
	childRunID := h.loadDag(t).Tasks[0].RunID
	if err := wstore.UpdateRun(h.ctx, h.channel, childRunID, func(r *waveobj.Run) error {
		r.PausedUnder = h.runID
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := HandleRunWorkerExit(h.ctx, h.workers[0], jarvis.WorkerExit{ExitCode: 137, Output: "killed"}); err != nil {
		t.Fatal(err)
	}
	if n := countEvents(t, h.ctx, h.channel, childRunID, waveobj.RunEventKindWorkerOutput); n != 0 {
		t.Fatalf("a suspended worker's exit logged %d worker-output rows", n)
	}
}

func TestHandleChildOutcomeOfAPausedRunChangesNoTask(t *testing.T) {
	for name, pause := range map[string]func(t *testing.T, h *childOutcomeHarness, childRunID string){
		"the child run is marked": func(t *testing.T, h *childOutcomeHarness, childRunID string) {
			if err := wstore.UpdateRun(h.ctx, h.channel, childRunID, func(r *waveobj.Run) error {
				r.PausedUnder = h.runID
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		},
		// a worker spawned in the instant before the dag lock was taken carries no mark yet
		"only the dag is paused": func(t *testing.T, h *childOutcomeHarness, _ string) {
			if err := wstore.UpdateDag(h.ctx, h.dagID, func(g *waveobj.TaskGroup) error {
				g.PausedTs = time.Now().UnixMilli()
				RecomputeDagStatus(g)
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			h := newChildOutcomeHarness(t, 1)
			before := h.loadDag(t).Tasks[0]
			pause(t, h, before.RunID)
			for _, status := range []string{"failed", "done"} {
				if err := HandleChildOutcome(h.ctx, h.workers[0], jarvis.OutcomeData{Status: status, Summary: "boom", ExitCode: 2}); err != nil {
					t.Fatal(err)
				}
			}
			got := h.loadDag(t)
			task := got.Tasks[0]
			if task.State != TaskState_Running || task.RunID != before.RunID || task.Attempts != 0 || got.Failures != 0 {
				t.Fatalf("a paused run's outcome moved the task: %+v failures=%d", task, got.Failures)
			}
		})
	}
}

func TestHandleWorkerTabCloseOfAPausedRunFailsNoPhase(t *testing.T) {
	for name, c := range pausedQuickRuns {
		t.Run(name, func(t *testing.T) {
			kinds := captureRunEvents(t)
			channelId, run := newPausedQuickRun(t, c.pause)
			HandleWorkerTabClose(context.Background(), "worker")
			got, err := wstore.GetRun(context.Background(), channelId, run.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got.Phases[0].State != jarvis.PhaseState_Running || got.Status != c.status {
				t.Fatalf("closing a suspended worker's tab left phase=%q status=%q, want running and %q", got.Phases[0].State, got.Status, c.status)
			}
			if k := kinds[run.ID]; len(k) != 0 {
				t.Fatalf("closing a suspended worker's tab recorded %v", k)
			}
		})
	}
}

func TestMarkInterruptedRunsSkipsAPausedRun(t *testing.T) {
	kinds := captureRunEvents(t)
	// a quick run a paused top-level run's lead spawned: executing, with a worker that is suspended, not dead
	channelId, run := newInterruptedRun(t, func(r *waveobj.Run) { r.PausedUnder = "top-run" })
	MarkInterruptedRuns(context.Background())
	got, err := wstore.GetRun(context.Background(), channelId, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Phases[0].State != jarvis.PhaseState_Running || len(kinds[run.ID]) != 0 {
		t.Fatalf("a paused run was marked interrupted: phase=%q events=%v", got.Phases[0].State, kinds[run.ID])
	}
}

func TestResumeInterruptedLeadsSkipsAPausedLead(t *testing.T) {
	var resumed []string
	old, oldGone := jarvis.ResumeRunWorker, workerControllerGone
	jarvis.ResumeRunWorker = func(_ context.Context, tab, _, sid, _ string) error {
		resumed = append(resumed, tab+" "+sid)
		return nil
	}
	workerControllerGone = func(context.Context, *waveobj.Run) bool { return true }
	t.Cleanup(func() { jarvis.ResumeRunWorker, workerControllerGone = old, oldGone })
	_, run := newInterruptedRun(t, func(r *waveobj.Run) {
		r.Mode, r.Phases[0].Kind, r.Runtime, r.SessionId = jarvis.RunMode_Orchestrator, jarvis.PhaseKind_Orchestrate, "claude", "sess-paused-lead"
		r.DagORef, r.PausedUnder = "dag:paused-lead", "top-run"
	})
	ResumeInterruptedLeads(context.Background())
	if slices.Contains(resumed, "tab:worker sess-paused-lead") {
		t.Fatalf("a paused lead was restarted at boot: %v (run %s)", resumed, run.ID)
	}
}

func TestCancelOrphanedDagRunSkipsAPausedRun(t *testing.T) {
	f := newPauseFixture(t, "t-0")
	orphan := jarvis.NewRun("orphan", "ws-1", f.project, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	orphan.DagORef, orphan.PausedUnder = f.dagID, f.ownerID
	orphan.Phases[0].WorkerOrefs = []string{"tab:orphan"}
	if err := wstore.AppendRun(f.ctx, f.channel, orphan); err != nil {
		t.Fatal(err)
	}
	stubStopRunWorkers(t)
	// as the boot pass reads it from the store, with its channel stamped: the function reads the owner through it
	stored := f.run(t, orphan.ID)
	cancelOrphanedDagRun(f.ctx, stored)
	if got := f.run(t, orphan.ID); got.Status == jarvis.RunStatus_Cancelled {
		t.Fatal("a paused run was cancelled as an orphan")
	}
}
