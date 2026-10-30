// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// silentSiblingDag builds a two-task dag whose t-1 is running behind a silent child (a tracked
// runtime with no session to read, and a last-activity older than StallThreshold), and applies
// mutate to shape t-0 into whatever non-running condition the test needs. Returns the dag id and a
// spawn counter that must stay at zero: a dag parked for the human may be observed, never advanced.
func silentSiblingDag(t *testing.T, name string, mutate func(*waveobj.TaskGroup)) (context.Context, string, *int) {
	t.Helper()
	allowWorkerHarnessForTest(t)
	// a live lead judges a stall; with none the engine retries the task itself (autoRetryStalled)
	newFakeLead(t)
	ctx := context.Background()
	oldRoot := sessionsRootFor
	sessionsRootFor = func(string) string { return t.TempDir() }
	t.Cleanup(func() { sessionsRootFor = oldRoot })

	ch, err := wstore.CreateChannel(ctx, name, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, name, 2, false, []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
		{ID: "t-1", Label: "b"},
	}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	child := jarvis.NewRun("child", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	// tracked runtime launched under a session id: the probe has a file to look for, so silence is a verdict
	child.Runtime = "pi"
	child.DagORef = g.OID
	child.SessionId = liveSession
	if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[1].State = TaskState_Running
		cur.Tasks[1].RunID = child.ID
		cur.Tasks[1].LastActivity = time.Now().Add(-StallThreshold - time.Minute).UnixMilli()
		mutate(cur)
		RecomputeDagStatus(cur)
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	spawns := 0
	old := spawnWorker
	spawnWorker = func(_ context.Context, _ runroute.Capability, _, _, cwd, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		// watchdogTick also ticks dags other tests left in the store; only this dag's spawns break the rule
		if strings.HasPrefix(filepath.Clean(cwd), filepath.Clean(ch.ProjectPath)) {
			spawns++
		}
		return "tab:worker", nil
	}
	restoreAfterStages(t, func() { spawnWorker = old })
	return ctx, g.OID, &spawns
}

func assertSiblingStalled(t *testing.T, ctx context.Context, dagID string, spawns *int, wantStatus string) {
	t.Helper()
	got, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != wantStatus {
		t.Fatalf("dag status = %q, want %q", got.Status, wantStatus)
	}
	if got.Tasks[1].State != TaskState_Stalled {
		t.Fatalf("silent sibling = %q, want stalled: the watchdog is the only thing that notices", got.Tasks[1].State)
	}
	if *spawns != 0 {
		t.Fatalf("observing a parked dag spawned %d workers; it must not advance dispatch", *spawns)
	}
}

// A failed task parks the dag for the human, but its siblings keep running. Stall detection lives in
// the schedule tick, so a watchdog that only scans running dags stops watching those siblings the
// moment any one task fails — exactly when supervision matters most.
func TestWatchdogTickDetectsStallInBlockedDag(t *testing.T) {
	ctx, dagID, spawns := silentSiblingDag(t, "watchdog-blocked", func(g *waveobj.TaskGroup) {
		g.Tasks[0].State = TaskState_Failed
	})

	watchdogTick(ctx)

	assertSiblingStalled(t, ctx, dagID, spawns, DagStatus_Blocked)
}

func TestWatchdogTickDetectsStallInAwaitingReviewDag(t *testing.T) {
	ctx, dagID, spawns := silentSiblingDag(t, "watchdog-gate", func(g *waveobj.TaskGroup) {
		g.Tasks[0].State = TaskState_Done
		g.Tasks[0].Gate = true
		g.Tasks[0].Released = false
	})

	watchdogTick(ctx)

	assertSiblingStalled(t, ctx, dagID, spawns, DagStatus_AwaitingReview)
}

// Terminal dags are done being watched: re-scheduling them forever is pure noise.
func TestWatchdogTickSkipsTerminalDags(t *testing.T) {
	ctx, dagID, _ := silentSiblingDag(t, "watchdog-cancelled", func(g *waveobj.TaskGroup) {
		g.Tasks[0].State = TaskState_Cancelled
	})

	watchdogTick(ctx)

	got, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != DagStatus_Cancelled {
		t.Fatalf("dag status = %q, want %q", got.Status, DagStatus_Cancelled)
	}
	if got.Tasks[1].State == TaskState_Stalled {
		t.Fatal("a cancelled dag must not be advanced by the watchdog")
	}
}

func TestEndedRunSettles(t *testing.T) {
	landed := &waveobj.RunLand{State: LandState_Landed}
	held := &waveobj.RunLand{State: LandState_Held}
	cases := []struct {
		name       string
		dag, run   string
		land       *waveobj.RunLand
		wantSettle bool
	}{
		{"done run, failed final", DagStatus_Blocked, jarvis.RunStatus_Done, held, true},
		{"done run, landed past a pending final", DagStatus_Finalizing, jarvis.RunStatus_Done, landed, true},
		{"done run, final still deciding its held land", DagStatus_Finalizing, jarvis.RunStatus_Done, held, false},
		{"done run, children still working", DagStatus_Running, jarvis.RunStatus_Done, landed, false},
		{"cancelled run", DagStatus_Running, jarvis.RunStatus_Cancelled, nil, true},
		{"cancelled run, finalizing", DagStatus_Finalizing, jarvis.RunStatus_Cancelled, nil, true},
		{"live run, blocked", DagStatus_Blocked, jarvis.RunStatus_Executing, nil, false},
		{"done dag", DagStatus_Done, jarvis.RunStatus_Done, landed, false},
		{"cancelled dag", DagStatus_Cancelled, jarvis.RunStatus_Cancelled, nil, false},
	}
	for _, c := range cases {
		g := &waveobj.TaskGroup{Status: c.dag}
		owner := &waveobj.Run{Status: c.run, Land: c.land}
		if got := endedRunSettles(g, owner); got != c.wantSettle {
			t.Errorf("%s: endedRunSettles = %v, want %v", c.name, got, c.wantSettle)
		}
	}
}

// endedRunDag stores a one-task dag whose task landed, with final as its final stage, owned by a done run whose land
// is land. Returns the dag id and the owner's id.
func endedRunDag(t *testing.T, name string, final *waveobj.FinalStage, land *waveobj.RunLand) (string, string, string) {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, name, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	owner.Status = jarvis.RunStatus_Done
	owner.Land = land
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, name, 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	g.Tasks[0].State = TaskState_Done
	g.Final = final
	RecomputeDagStatus(&g)
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	return g.OID, ch.OID, owner.ID
}

// A lead that completes its run past a failed final stage, or a run that lands while a later round's final is
// pending, leaves a dag nothing else moves: the watchdog's pass settles it, which is also what clears the dags
// already stuck in a store.
func TestWatchdogTickSettlesDagOfEndedRun(t *testing.T) {
	ctx := context.Background()
	var sources []any
	oldAppend := appendRunEvent
	appendRunEvent = func(ctx context.Context, channelID, runID, kind string, phase *int, detail any) {
		if m, ok := detail.(map[string]any); ok && kind == waveobj.RunEventKindDagCancelled {
			sources = append(sources, m["source"])
		}
		oldAppend(ctx, channelID, runID, kind, phase, detail)
	}
	restoreAfterStages(t, func() { appendRunEvent = oldAppend })

	failed, failedCh, failedOwner := endedRunDag(t, "ended-final-failed",
		&waveobj.FinalStage{Round: 1, State: FinalState_Failed, Detail: "Verify failed"}, &waveobj.RunLand{State: LandState_Held})
	pending, _, _ := endedRunDag(t, "ended-final-pending",
		&waveobj.FinalStage{Round: 2, State: FinalState_Checking}, &waveobj.RunLand{State: LandState_Landed})
	if g, _ := wstore.GetDag(ctx, failed); g.Status != DagStatus_Blocked {
		t.Fatalf("fixture: failed-final dag = %q, want blocked", g.Status)
	}

	watchdogTick(ctx)

	for _, id := range []string{failed, pending} {
		got, err := wstore.GetDag(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if got.Status != DagStatus_Cancelled {
			t.Fatalf("dag %s = %q, want cancelled once its run ended", id, got.Status)
		}
	}
	got, _ := wstore.GetDag(ctx, failed)
	if got.Final == nil || got.Final.State != FinalState_Failed || got.Final.Detail != "Verify failed" {
		t.Fatalf("settling must keep what the final stage found, got %+v", got.Final)
	}
	if got.Tasks[0].State != TaskState_Done {
		t.Fatalf("a landed task stays done, got %q", got.Tasks[0].State)
	}
	owner, err := wstore.GetRun(ctx, failedCh, failedOwner)
	if err != nil {
		t.Fatal(err)
	}
	if owner.Status != jarvis.RunStatus_Done {
		t.Fatalf("the owner run stays done, got %q", owner.Status)
	}
	runEnded := 0
	for _, s := range sources {
		if s == "run-ended" {
			runEnded++
		}
	}
	if runEnded < 2 {
		t.Fatalf("dag-cancelled sources = %v, want run-ended for both settled dags", sources)
	}
}
