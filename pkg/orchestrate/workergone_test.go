// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// seedSpawnedClaudeChild records a running task whose claude child was spawned moments ago under workerTab and
// has written no transcript: inside every deadline, so only its process can say anything about it.
func seedSpawnedClaudeChild(t *testing.T, name, workerTab string) (context.Context, *waveobj.TaskGroup, string) {
	t.Helper()
	allowWorkerHarnessForTest(t)
	stubSessionsRoot(t, t.TempDir())
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, name, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	spawnedTs := time.Now().Add(-10 * time.Second).UnixMilli()
	child := jarvis.NewRun("child", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), spawnedTs)
	child.Runtime = "claude"
	child.DagORef = g.OID
	child.SessionId = liveSession
	if workerTab != "" {
		child.Phases[0].WorkerOrefs = []string{workerTab}
	}
	if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
		t.Fatal(err)
	}
	g.Tasks[0].RunID = child.ID
	g.Tasks[0].State = TaskState_Running
	g.Tasks[0].LastActivity = spawnedTs
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		*cur = g
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return ctx, &g, child.ID
}

func newTabORef() string {
	return waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String()
}

// useRealWorkerGone undoes TestMain's stub, which reads every fixture's worker as present.
func useRealWorkerGone(t *testing.T) {
	t.Helper()
	prev := workerControllerGone
	workerControllerGone = readWorkerGone
	t.Cleanup(func() { workerControllerGone = prev })
}

// run d8fe96ab's t-2: the worker exited a second after its spawn, the exit reached nobody, and its tab closed
// itself. No transcript to age and no controller reading init, so the task read running until the lead
// retried it by hand 15 minutes later.
func TestScheduleOnceStallsATaskWhoseWorkerTabIsGone(t *testing.T) {
	f := newFakeLead(t)
	useRealWorkerGone(t)
	ctx, g, _ := seedSpawnedClaudeChild(t, "worker-tab-gone", newTabORef())

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	if g.Tasks[0].State != TaskState_Stalled {
		t.Fatalf("a running task whose worker tab is deleted must stall, got %s", g.Tasks[0].State)
	}
	if want := taskWorkerGoneWake("t-0"); len(f.sends) != 1 || !strings.Contains(f.sends[0], want) {
		t.Fatalf("the lead is woken with %q, got %q", want, f.sends)
	}
}

// with no lead alive to judge it, a worker that is gone is the engine's to retry
func TestScheduleOnceRetriesAGoneWorkerWithoutALead(t *testing.T) {
	newFakeLead(t).state.Alive = false
	useRealWorkerGone(t)
	ctx, g, oldRun := seedSpawnedClaudeChild(t, "worker-tab-gone-no-lead", newTabORef())
	// the respawned worker records no tab, which reads unknown, not gone
	stubSpawnWorker(t, "", nil)

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	if task := g.Tasks[0]; task.State != TaskState_Running || task.RunID == oldRun || task.StallRetries != 1 {
		t.Fatalf("a gone worker is respawned under a new run, got state=%s run=%q (was %q) stallretries=%d", task.State, task.RunID, oldRun, task.StallRetries)
	}
}

// the verdict kills live work when it is wrong, so everything short of a deleted tab leaves the task alone
func TestScheduleOnceLeavesAWorkerItCannotResolveRunning(t *testing.T) {
	newFakeLead(t)
	useRealWorkerGone(t)
	ctx, g, _ := seedSpawnedClaudeChild(t, "worker-tab-unknown", "")

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	if g.Tasks[0].State != TaskState_Running {
		t.Fatalf("a worker with no recorded tab is unknown, not gone: want running, got %s", g.Tasks[0].State)
	}
}

// a worker's complete lands just before its process exits and its tab closes: a tick that loaded the run
// before the complete and looked for the worker after it must not stall a finished task
func TestScheduleOnceDoesNotStallAWorkerThatCompletedBeforeItsTabClosed(t *testing.T) {
	newFakeLead(t)
	ctx, g, childID := seedSpawnedClaudeChild(t, "worker-completed-then-gone", newTabORef())
	prev := workerControllerGone
	workerControllerGone = func(ctx context.Context, run *waveobj.Run) bool {
		if run != nil && run.ID == childID {
			if err := wstore.UpdateRun(ctx, g.ChannelId, childID, func(r *waveobj.Run) error {
				r.Status = jarvis.RunStatus_Done
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		}
		return readWorkerGone(ctx, run)
	}
	t.Cleanup(func() { workerControllerGone = prev })

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	if g.Tasks[0].State == TaskState_Stalled {
		t.Fatal("a worker whose run completed is finished, not gone")
	}
}

func TestReadWorkerGone(t *testing.T) {
	ctx := context.Background()
	withTab := func(oref string) *waveobj.Run {
		return &waveobj.Run{Phases: []waveobj.RunPhase{{WorkerOrefs: []string{oref}}}}
	}
	noController, noBlocks := uuid.NewString(), uuid.NewString()
	for _, tab := range []*waveobj.Tab{
		{OID: noController, BlockIds: []string{uuid.NewString()}},
		{OID: noBlocks},
	} {
		if err := wstore.DBInsert(ctx, tab); err != nil {
			t.Fatal(err)
		}
	}
	cases := []struct {
		name string
		run  *waveobj.Run
		want bool
	}{
		{name: "no run", run: nil, want: false},
		{name: "a run with no worker tab", run: &waveobj.Run{}, want: false},
		{name: "a deleted tab", run: withTab(newTabORef()), want: true},
		{name: "a block no controller runs", run: withTab("tab:" + noController), want: true},
		{name: "a tab with no block", run: withTab("tab:" + noBlocks), want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := readWorkerGone(ctx, tc.run); got != tc.want {
				t.Fatalf("want %v, got %v", tc.want, got)
			}
		})
	}
}

// stubStartWorker scripts the launch of a spawned worker's process.
func stubStartWorker(t *testing.T, start func(ctx context.Context, workerORef string) error) {
	t.Helper()
	prev := startWorker
	startWorker = start
	restoreAfterStages(t, func() { startWorker = prev })
}

// the exit hook fails a worker through its run row and the owner stamp on its tab. Run d8fe96ab's t-2 exited a
// second after its spawn, while the tick was still writing them, and its exit failed nothing.
func TestDispatchRecordsAWorkerBeforeStartingIt(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx, g, channelID, _ := seedDispatchDag(t, "dispatch-record-then-start")
	stubSpawnWorker(t, "tab:worker", nil)
	stamped := map[string]string{}
	oldStamp := stampSpawnedWorker
	stampSpawnedWorker = func(_ context.Context, worker, runORef, _ string) error {
		stamped[worker] = runORef
		return nil
	}
	restoreAfterStages(t, func() { stampSpawnedWorker = oldStamp })
	starts := 0
	stubStartWorker(t, func(ctx context.Context, worker string) error {
		starts++
		runORef, err := waveobj.ParseORef(stamped[worker])
		if err != nil {
			t.Fatalf("worker %s started before its tab was stamped with its run: %v", worker, err)
		}
		if _, err := wstore.GetRun(ctx, channelID, runORef.OID); err != nil {
			t.Fatalf("worker %s started before its run row existed: %v", worker, err)
		}
		return nil
	})

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	if starts == 0 {
		t.Fatal("the dispatched worker was never started")
	}
}

// a worker whose process will not start leaves no run reading as working
func TestDispatchFailsATaskWhoseWorkerWillNotStart(t *testing.T) {
	allowWorkerHarnessForTest(t)
	newFakeLead(t)
	ctx, g, channelID, _ := seedDispatchDag(t, "dispatch-start-fails")
	stubSpawnWorker(t, "tab:worker", nil)
	var runID string
	oldAppend := appendChildRun
	appendChildRun = func(ctx context.Context, channel string, run waveobj.Run) error {
		runID = run.ID
		return oldAppend(ctx, channel, run)
	}
	restoreAfterStages(t, func() { appendChildRun = oldAppend })
	stubStartWorker(t, func(context.Context, string) error { return errors.New("no pty") })
	spendDispatchRetries(t, ctx, g.OID)

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	task := g.Tasks[0]
	if task.State != TaskState_Failed || task.LastFailureKind != FailureKindSpawn || task.RunID != "" {
		t.Fatalf("want the task failed as a spawn failure with no run, got state=%s kind=%s run=%q", task.State, task.LastFailureKind, task.RunID)
	}
	if run, err := wstore.GetRun(ctx, channelID, runID); err != nil || run.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("the unstarted worker's run is cancelled, got %+v err=%v", run, err)
	}
}
