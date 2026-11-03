// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// newInterruptedRun stores a quick run whose phase is running under "tab:worker", after mutate.
func newInterruptedRun(t *testing.T, mutate func(*waveobj.Run)) (string, waveobj.Run) {
	t.Helper()
	ch, err := wstore.CreateChannel(context.Background(), "interrupted", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	run := jarvis.NewRun("goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	run.Phases[0].WorkerOrefs = []string{"tab:worker"}
	if mutate != nil {
		mutate(&run)
	}
	if err := wstore.AppendRun(context.Background(), ch.OID, run); err != nil {
		t.Fatal(err)
	}
	return ch.OID, run
}

// captureRunEvents records the kinds appended per run id while the test runs.
func captureRunEvents(t *testing.T) map[string][]string {
	t.Helper()
	kinds := map[string][]string{}
	old := appendRunEvent
	appendRunEvent = func(_ context.Context, _, runId, kind string, _ *int, _ any) {
		kinds[runId] = append(kinds[runId], kind)
	}
	restoreAfterStages(t, func() { appendRunEvent = old })
	return kinds
}

// the fixture has no session, so there is nothing to resume and the run stays blocked
func TestMarkInterruptedRunsBlocksAnExecutingRunOnce(t *testing.T) {
	kinds := captureRunEvents(t)
	channelId, run := newInterruptedRun(t, nil)
	if run.Status != jarvis.RunStatus_Executing {
		t.Fatalf("fixture status = %q, want executing", run.Status)
	}
	ctx := context.Background()
	MarkInterruptedRuns(ctx)
	MarkInterruptedRuns(ctx) // a second boot finds nothing left to mark
	got, err := wstore.GetRun(ctx, channelId, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != jarvis.RunStatus_Blocked || got.Phases[0].State != jarvis.PhaseState_Failed {
		t.Fatalf("run status=%q phase=%q, want blocked and failed", got.Status, got.Phases[0].State)
	}
	if k := kinds[run.ID]; len(k) != 1 || k[0] != waveobj.RunEventKindInterrupted {
		t.Fatalf("want one interrupted event, got %v", k)
	}
}

func TestMarkInterruptedRunsLeavesOtherRunsAlone(t *testing.T) {
	for name, mutate := range map[string]func(*waveobj.Run){
		"dag run":          func(r *waveobj.Run) { r.DagORef = "dag:1" },
		"awaiting review":  func(r *waveobj.Run) { r.Status = jarvis.RunStatus_AwaitingReview },
		"no worker":        func(r *waveobj.Run) { r.Phases[0].WorkerOrefs = nil },
		"already finished": func(r *waveobj.Run) { next, _ := jarvis.CompletePhase(*r, 0, nil, 2); *r = next },
	} {
		t.Run(name, func(t *testing.T) {
			kinds := captureRunEvents(t)
			channelId, run := newInterruptedRun(t, mutate)
			ctx := context.Background()
			MarkInterruptedRuns(ctx)
			got, err := wstore.GetRun(ctx, channelId, run.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got.Status != run.Status || got.Phases[0].State != run.Phases[0].State {
				t.Fatalf("run changed: status %q -> %q, phase %q -> %q", run.Status, got.Status, run.Phases[0].State, got.Phases[0].State)
			}
			if len(kinds[run.ID]) != 0 {
				t.Fatalf("want no events, got %v", kinds[run.ID])
			}
		})
	}
}

// A run the app restart stopped sat blocked until someone noticed and pressed Resume (run 3d3dc6ac, 7 days):
// a quick run and a lead that has not submitted its plan both come back in their own session at boot.
func TestMarkInterruptedRunsResumesARunWithASession(t *testing.T) {
	for name, c := range map[string]struct{ mode, kind string }{
		"quick run":            {jarvis.RunMode_Quick, jarvis.PhaseKind_Execute},
		"lead before its plan": {jarvis.RunMode_Orchestrator, jarvis.PhaseKind_Orchestrate},
	} {
		t.Run(name, func(t *testing.T) {
			kinds := captureRunEvents(t)
			sessionId := "sess-" + c.mode
			var resumed []string
			old := jarvis.ResumeRunWorker
			jarvis.ResumeRunWorker = func(_ context.Context, tab, _, sid, _ string) error {
				resumed = append(resumed, tab+" "+sid)
				return nil
			}
			restoreAfterStages(t, func() { jarvis.ResumeRunWorker = old })
			channelId, run := newInterruptedRun(t, func(r *waveobj.Run) {
				r.Mode, r.Phases[0].Kind, r.Runtime, r.SessionId = c.mode, c.kind, "claude", sessionId
			})
			ctx := context.Background()
			MarkInterruptedRuns(ctx)
			got, err := wstore.GetRun(ctx, channelId, run.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got.Status != jarvis.RunStatus_Executing || got.Phases[0].State != jarvis.PhaseState_Running {
				t.Fatalf("run status=%q phase=%q, want executing and running", got.Status, got.Phases[0].State)
			}
			// the store is shared with other tests' runs, so only this run's resume is looked for
			if !slices.Contains(resumed, "tab:worker "+sessionId) {
				t.Fatalf("want the worker resumed in its session, got %v", resumed)
			}
			want := []string{waveobj.RunEventKindInterrupted, waveobj.RunEventKindWorkerResumed}
			if k := kinds[run.ID]; !slices.Equal(k, want) {
				t.Fatalf("events = %v, want %v", k, want)
			}
		})
	}
}

func TestMarkInterruptedRunsLeavesARunBlockedWhenItsRestartFails(t *testing.T) {
	captureRunEvents(t)
	old := jarvis.ResumeRunWorker
	jarvis.ResumeRunWorker = func(context.Context, string, string, string, string) error {
		return errors.New("the worker's tab is gone")
	}
	restoreAfterStages(t, func() { jarvis.ResumeRunWorker = old })
	channelId, run := newInterruptedRun(t, func(r *waveobj.Run) { r.Runtime, r.SessionId = "claude", "sess-gone" })
	ctx := context.Background()
	MarkInterruptedRuns(ctx)
	got, err := wstore.GetRun(ctx, channelId, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != jarvis.RunStatus_Blocked || got.Phases[0].State != jarvis.PhaseState_Failed {
		t.Fatalf("run status=%q phase=%q, want blocked and failed", got.Status, got.Phases[0].State)
	}
}

// The land resolver is a stage session the dag's fields do not name: the owner's land does, and the land driver holds
// the land when the resolver ends without a merge. A quit does not cancel it behind the driver's back.
func TestMarkInterruptedRunsLeavesTheLandResolverTheOwnersLandNames(t *testing.T) {
	ctx, dag, owner, child := seedRunningDag(t)
	if err := wstore.UpdateRun(ctx, dag.ChannelId, child.ID, func(r *waveobj.Run) error { r.DagORef = dag.OID; return nil }); err != nil {
		t.Fatal(err)
	}
	resolver := jarvis.NewRun("resolve", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	resolver.DagORef = dag.OID
	resolver.StageRole = jarvis.UsageRole_LandResolver
	resolver.Phases[0].WorkerOrefs = []string{"tab:resolver"}
	if err := wstore.AppendRun(ctx, dag.ChannelId, resolver); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateRun(ctx, dag.ChannelId, owner.ID, func(r *waveobj.Run) error {
		r.DagORef = dag.OID
		r.Land = &waveobj.RunLand{State: LandState_Resolving, Resolver: resolver.ID}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var stopped []string
	oldStop := stopRunWorkers
	stopRunWorkers = func(_ context.Context, r *waveobj.Run) error {
		stopped = append(stopped, r.ID)
		return nil
	}
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })

	MarkInterruptedRuns(ctx)

	got, err := wstore.GetRun(ctx, dag.ChannelId, resolver.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != jarvis.RunStatus_Executing || len(stopped) != 0 {
		t.Fatalf("the land's resolver: status %s, stopped %v; want it left executing for tendResolver", got.Status, stopped)
	}
}

// A tick records each child run before it starts its worker, and commits the dag only at the end of the batch: a
// quit in between leaves runs no task names, which read executing forever while the task is dispatched again.
func TestMarkInterruptedRunsCancelsDagRunsNoTaskReferences(t *testing.T) {
	ctx, dag, owner, child := seedRunningDag(t)
	tagged := func(r waveobj.Run) waveobj.Run {
		r.DagORef = dag.OID
		return r
	}
	if err := wstore.UpdateRun(ctx, dag.ChannelId, child.ID, func(r *waveobj.Run) error { *r = tagged(*r); return nil }); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateRun(ctx, dag.ChannelId, owner.ID, func(r *waveobj.Run) error { *r = tagged(*r); return nil }); err != nil {
		t.Fatal(err)
	}
	orphan := tagged(jarvis.NewRun("child", "ws-1", t.TempDir(), nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1))
	orphan.TaskId = "t-0"
	orphan.Phases[0].WorkerOrefs = []string{"tab:orphan"}
	if err := wstore.AppendRun(ctx, dag.ChannelId, orphan); err != nil {
		t.Fatal(err)
	}
	var stopped []string
	oldStop := stopRunWorkers
	stopRunWorkers = func(_ context.Context, r *waveobj.Run) error {
		stopped = append(stopped, r.ID)
		return nil
	}
	restoreAfterStages(t, func() { stopRunWorkers = oldStop })

	MarkInterruptedRuns(ctx)

	for id, want := range map[string]string{orphan.ID: jarvis.RunStatus_Cancelled, child.ID: jarvis.RunStatus_Executing, owner.ID: jarvis.RunStatus_Executing} {
		got, err := wstore.GetRun(ctx, dag.ChannelId, id)
		if err != nil {
			t.Fatal(err)
		}
		if got.Status != want {
			t.Fatalf("run %s: status %s, want %s", id, got.Status, want)
		}
	}
	if !slices.Equal(stopped, []string{orphan.ID}) {
		t.Fatalf("stopped %v, want only the orphan %s, so a resync cannot start its worker again", stopped, orphan.ID)
	}
}
