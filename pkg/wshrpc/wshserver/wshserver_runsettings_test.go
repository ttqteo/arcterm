// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func strPtr(s string) *string { return &s }

func intPtr(n int) *int { return &n }

// newEngineRun creates a deferred engine orchestrator run — the session sheet's precondition. Deferred
// so no worker is spawned and the run stays exactly as the sheet would find it.
func newEngineRun(t *testing.T, ctx context.Context, name string, orchestration string) (*waveobj.Channel, *waveobj.Run) {
	t.Helper()
	stubRunServer(t, "pi", nil)
	ch, err := wstore.CreateChannel(ctx, name, t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	rtn, err := (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws", Goal: "reconfigure me", Runtime: "pi",
		Mode: jarvis.RunMode_Orchestrator, Orchestration: orchestration, DeferStart: true,
	})
	if err != nil {
		t.Fatalf("CreateRunCommand: %v", err)
	}
	return ch, rtn.Run
}

func mustRun(t *testing.T, ctx context.Context, channelId, runId string) *waveobj.Run {
	t.Helper()
	r, err := wstore.GetRun(ctx, channelId, runId)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	return r
}

// captureBroadcasts subscribes to waveobj updates so a handler's "did it publish" claim is observable.
func captureBroadcasts(t *testing.T) *captureClient {
	t.Helper()
	cc := &captureClient{}
	prev := wps.Broker.GetClient()
	wps.Broker.SetClient(cc)
	t.Cleanup(func() { wps.Broker.SetClient(prev) })
	routeId := "test-runsettings-route"
	wps.Broker.Subscribe(routeId, wps.SubscriptionRequest{Event: wps.Event_WaveObjUpdate, AllScopes: true})
	t.Cleanup(func() { wps.Broker.Unsubscribe(routeId, wps.Event_WaveObjUpdate) })
	return cc
}

func submitPlan(t *testing.T, ctx context.Context, ch *waveobj.Channel, runId string) *waveobj.TaskGroup {
	t.Helper()
	g, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{
		ChannelId: ch.OID, RunId: runId, Title: "plan", Parallelism: 2,
		Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "one"}, {ID: "t-2", Label: "two", Deps: []string{"t-1"}}},
	})
	if err != nil {
		t.Fatalf("DagSubmitCommand: %v", err)
	}
	return g
}

// Before the DAG exists the run carries the pending settings — DagSubmit already reads exactly these
// fields, so this writes the pending carrier rather than a second store.
func TestSetRunSettingsPersistsPendingOnRunBeforeDag(t *testing.T) {
	ctx := context.Background()
	ch, run := newEngineRun(t, ctx, "rs-pending", jarvis.Orchestration_Engine)
	route := &waveobj.RoutePin{Runtime: "pi"}
	if err := (&WshServer{}).SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, Parallelism: intPtr(3), WorkerRoute: route,
	}); err != nil {
		t.Fatalf("SetRunSettingsCommand: %v", err)
	}
	got := mustRun(t, ctx, ch.OID, run.ID)
	if got.Parallelism != 3 {
		t.Errorf("parallelism = %d, want 3", got.Parallelism)
	}
	if got.WorkerRoute == nil || *got.WorkerRoute != *route {
		t.Errorf("worker route = %+v, want %+v", got.WorkerRoute, route)
	}
}

func TestSetRunSettingsRejectsTerminalRun(t *testing.T) {
	ctx := context.Background()
	ch, run := newEngineRun(t, ctx, "rs-terminal", jarvis.Orchestration_Engine)
	if err := wstore.UpdateRun(ctx, ch.OID, run.ID, func(r *waveobj.Run) error {
		r.Status = jarvis.RunStatus_Cancelled
		return nil
	}); err != nil {
		t.Fatalf("UpdateRun: %v", err)
	}
	before := mustRun(t, ctx, ch.OID, run.ID).Parallelism
	if err := (&WshServer{}).SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, Parallelism: intPtr(3),
	}); err == nil {
		t.Fatal("expected a terminal run to be rejected")
	}
	if got := mustRun(t, ctx, ch.OID, run.ID).Parallelism; got != before {
		t.Fatalf("terminal run was rewritten: parallelism = %d", got)
	}
}

// An explicitly supplied width outside the engine's range is refused, and zero is outside it: omission is
// how a caller says "leave the width alone", so sending 0 is a wrong model of the dial, not an unset.
func TestSetRunSettingsRejectsOutOfRangeParallelism(t *testing.T) {
	ctx := context.Background()
	ch, run := newEngineRun(t, ctx, "rs-range", jarvis.Orchestration_Engine)
	ws := &WshServer{}
	for _, width := range []int{0, -1, orchestrate.MaxParallelism + 1} {
		if err := ws.SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
			ChannelId: ch.OID, RunId: run.ID, Parallelism: intPtr(width),
		}); err == nil {
			t.Fatalf("width %d: want a rejection", width)
		}
	}
	if got := mustRun(t, ctx, ch.OID, run.ID).Parallelism; got != 0 {
		t.Fatalf("a rejected width was persisted: %d", got)
	}
	// the omission is the legal "leave it alone" — legal all the way up to submission.
	if err := ws.SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID,
	}); err != nil {
		t.Fatalf("an omitted width must be legal: %v", err)
	}
}

func TestSetRunSettingsRejectsInvalidWorkerRoute(t *testing.T) {
	ctx := context.Background()
	ch, run := newEngineRun(t, ctx, "rs-badroute", jarvis.Orchestration_Engine)
	if err := (&WshServer{}).SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, WorkerRoute: &waveobj.RoutePin{Runtime: "openrouter"},
	}); err == nil {
		t.Fatal("expected an invalid worker route to be rejected")
	}
	if got := mustRun(t, ctx, ch.OID, run.ID); got.WorkerRoute != nil {
		t.Fatalf("invalid route was persisted: %+v", got.WorkerRoute)
	}
}

// agy runs task workers only: a worker route accepts it, a reviewer route (a judgment role) refuses it, and the
// refusal does not wait for the install check, so a stored default cannot name it either.
func TestRunSettingsAgyRoutes(t *testing.T) {
	old := validateHarness
	t.Cleanup(func() { validateHarness = old })
	validateHarness = func(runtime string, op harness.Operation) (harness.Spec, error) {
		return harness.ValidateCapable(runtime, op) // installed everywhere; capability is the question
	}
	agy := &waveobj.RoutePin{Runtime: "agy"}
	for _, requireInstalled := range []bool{true, false} {
		if err := validateRoute("workerRoute", harness.OperationRunWorker, agy, requireInstalled); err != nil {
			t.Errorf("requireInstalled=%v: agy worker route refused: %v", requireInstalled, err)
		}
		err := validateRoute("reviewerRoute", harness.OperationLead, agy, requireInstalled)
		if err == nil || !strings.Contains(err.Error(), `harness "agy" cannot lead a run`) {
			t.Errorf("requireInstalled=%v: agy reviewer route error = %v", requireInstalled, err)
		}
		for _, rt := range []string{"claude", "pi"} {
			if err := validateRoute("reviewerRoute", harness.OperationLead, &waveobj.RoutePin{Runtime: rt}, requireInstalled); err != nil {
				t.Errorf("requireInstalled=%v: %s reviewer route refused: %v", requireInstalled, rt, err)
			}
		}
	}
}

func TestStoredReviewerDefaultRefusesAgy(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "profile-agy-reviewer", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	if err := (&WshServer{}).SetChannelProfileCommand(ctx, wshrpc.CommandSetChannelProfileData{
		ChannelId: ch.OID, Override: &waveobj.ProfileOverride{ReviewerRoute: &waveobj.RoutePin{Runtime: "agy"}},
	}); err == nil || !strings.Contains(err.Error(), "cannot lead a run") {
		t.Fatalf("an agy reviewer default must be refused: %v", err)
	}
	if channelHasProfileMeta(t, ctx, ch.OID) {
		t.Fatal("a rejected reviewer default must not write channel meta")
	}
	if err := validateGlobalEngineDefaults(waveobj.JarvisProfile{ReviewerRoute: &waveobj.RoutePin{Runtime: "agy"}}); err == nil {
		t.Fatal("the global profile must refuse an agy reviewer too")
	}
	if err := validateGlobalEngineDefaults(waveobj.JarvisProfile{WorkerRoute: &waveobj.RoutePin{Runtime: "agy"}}); err != nil {
		t.Fatalf("the global profile may name agy as the worker: %v", err)
	}
}

// Post-DAG the group is the scheduler's source of truth.
func TestSetRunSettingsPersistsLiveOnTaskGroupAfterSubmit(t *testing.T) {
	ctx := context.Background()
	ch, run := newEngineRun(t, ctx, "rs-live", jarvis.Orchestration_Engine)
	g := submitPlan(t, ctx, ch, run.ID)
	if err := (&WshServer{}).SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, Parallelism: intPtr(5),
	}); err != nil {
		t.Fatalf("SetRunSettingsCommand: %v", err)
	}
	got, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatalf("GetDag: %v", err)
	}
	if got.Parallelism != 5 {
		t.Fatalf("group parallelism = %d, want 5", got.Parallelism)
	}
}

// The run keeps its launch snapshot: duplicating live truth onto it would leave two answers to one
// question, and the sheet would not know which to print.
func TestSetRunSettingsKeepsRunLaunchSnapshotAfterSubmit(t *testing.T) {
	ctx := context.Background()
	ch, run := newEngineRun(t, ctx, "rs-snapshot", jarvis.Orchestration_Engine)
	submitPlan(t, ctx, ch, run.ID)
	if err := (&WshServer{}).SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, Parallelism: intPtr(5),
	}); err != nil {
		t.Fatalf("SetRunSettingsCommand: %v", err)
	}
	if got := mustRun(t, ctx, ch.OID, run.ID).Parallelism; got != 0 {
		t.Fatalf("run parallelism rewritten to %d; the launch snapshot must stay put", got)
	}
}

// A submitted plan already holds a concrete width, so neither zero nor "unset" can put it back.
func TestSetRunSettingsRejectsZeroParallelismAfterSubmit(t *testing.T) {
	ctx := context.Background()
	ch, run := newEngineRun(t, ctx, "rs-zero-after", jarvis.Orchestration_Engine)
	g := submitPlan(t, ctx, ch, run.ID)
	if err := (&WshServer{}).SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, Parallelism: intPtr(0),
	}); err == nil {
		t.Fatal("expected 0 to be rejected once a group exists")
	}
	// an omitted width leaves the group's concrete width standing rather than clearing it.
	if err := (&WshServer{}).SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID,
	}); err != nil {
		t.Fatalf("an omitted width must be legal after submit: %v", err)
	}
	got, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatalf("GetDag: %v", err)
	}
	if got.Parallelism != g.Parallelism {
		t.Fatalf("omitted width moved the group's parallelism: %d -> %d", g.Parallelism, got.Parallelism)
	}
}

// Parallelism may be lowered below current occupancy: the scheduler waits, it does not cancel.
func TestSetRunSettingsAllowsLoweringBelowOccupancy(t *testing.T) {
	ctx := context.Background()
	ch, run := newEngineRun(t, ctx, "rs-lower", jarvis.Orchestration_Engine)
	g := submitPlan(t, ctx, ch, run.ID)
	if err := wstore.UpdateDag(ctx, g.OID, func(d *waveobj.TaskGroup) error {
		d.Tasks[0].State = orchestrate.TaskState_Running
		d.Tasks[0].RunID = "child-1"
		return nil
	}); err != nil {
		t.Fatalf("UpdateDag: %v", err)
	}
	if err := (&WshServer{}).SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, Parallelism: intPtr(1),
	}); err != nil {
		t.Fatalf("lowering parallelism must be valid: %v", err)
	}
	got, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatalf("GetDag: %v", err)
	}
	if got.Parallelism != 1 {
		t.Fatalf("parallelism = %d, want 1", got.Parallelism)
	}
	if got.Tasks[0].State != orchestrate.TaskState_Running {
		t.Fatalf("active worker was rewritten: %q", got.Tasks[0].State)
	}
}

// No optimistic success: a rejected write publishes nothing, so no view can show settings that never
// landed.
func TestSetRunSettingsPublishesOnlyAfterSuccess(t *testing.T) {
	ctx := context.Background()
	ch, run := newEngineRun(t, ctx, "rs-publish", jarvis.Orchestration_Engine)
	cc := captureBroadcasts(t)
	if err := (&WshServer{}).SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, Parallelism: intPtr(orchestrate.MaxParallelism + 4),
	}); err == nil {
		t.Fatal("expected the out-of-range width to be rejected")
	}
	if cc.sawScope("run:" + run.ID) {
		t.Fatal("failed write published a run: update")
	}
	if err := (&WshServer{}).SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: run.ID, Parallelism: intPtr(4),
	}); err != nil {
		t.Fatalf("SetRunSettingsCommand: %v", err)
	}
	if !cc.sawScope("run:" + run.ID) {
		t.Fatal("successful write published no run: update")
	}
}

// A missing run is a real error, not a silent no-op.
func TestSetRunSettingsRejectsUnknownRun(t *testing.T) {
	ctx := context.Background()
	ch, _ := newEngineRun(t, ctx, "rs-unknown", jarvis.Orchestration_Engine)
	if err := (&WshServer{}).SetRunSettingsCommand(ctx, wshrpc.CommandSetRunSettingsData{
		ChannelId: ch.OID, RunId: "nope", Parallelism: intPtr(2),
	}); err == nil {
		t.Fatal("expected an unknown run to be rejected")
	}
}

// Profile engine defaults are the launch-state hydration half: a channel that names a machine, a width
// and a worker route gets them without the composer repeating itself.
func TestCreateRunHydratesEngineDefaultsFromProfile(t *testing.T) {
	ctx := context.Background()
	stubRunServer(t, "pi", nil)
	ch, err := wstore.CreateChannel(ctx, "hydrate-chan", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	route := &waveobj.RoutePin{Runtime: "pi"}
	seedProfileMeta(t, ctx, ch.OID, &waveobj.ProfileOverride{
		Parallelism: intPtr(3),
		WorkerRoute: route,
	})
	rtn, err := (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws", Goal: "g", Runtime: "pi",
		Mode: jarvis.RunMode_Orchestrator, DeferStart: true,
	})
	if err != nil {
		t.Fatalf("CreateRunCommand: %v", err)
	}
	if rtn.Run.Orchestration != jarvis.Orchestration_Engine {
		t.Errorf("orchestration = %q, want engine from the profile", rtn.Run.Orchestration)
	}
	if rtn.Run.Parallelism != 3 {
		t.Errorf("parallelism = %d, want 3 from the profile", rtn.Run.Parallelism)
	}
	if rtn.Run.WorkerRoute == nil || *rtn.Run.WorkerRoute != *route {
		t.Errorf("worker route = %+v, want the profile's", rtn.Run.WorkerRoute)
	}
}

// An explicit launch argument always wins over the profile default.
func TestCreateRunExplicitValuesBeatProfileDefaults(t *testing.T) {
	ctx := context.Background()
	stubRunServer(t, "pi", nil)
	ch, err := wstore.CreateChannel(ctx, "hydrate-explicit", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	seedProfileMeta(t, ctx, ch.OID, &waveobj.ProfileOverride{
		Parallelism: intPtr(3),
	})
	rtn, err := (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws", Goal: "g", Runtime: "pi",
		Mode: jarvis.RunMode_Orchestrator, Parallelism: 7, DeferStart: true,
	})
	if err != nil {
		t.Fatalf("CreateRunCommand: %v", err)
	}
	if rtn.Run.Parallelism != 7 {
		t.Fatalf("explicit launch args overridden by the profile: %+v", rtn.Run)
	}
}

// The profile's engine sections validate before anything is written, like the route section already does.
func TestSetChannelProfileValidatesEngineDefaults(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "profile-engine", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	ws := &WshServer{}
	if err := ws.SetChannelProfileCommand(ctx, wshrpc.CommandSetChannelProfileData{
		ChannelId: ch.OID, Override: &waveobj.ProfileOverride{Parallelism: intPtr(orchestrate.MaxParallelism + 1)},
	}); err == nil {
		t.Fatal("expected out-of-range profile parallelism to be rejected")
	}
	if err := ws.SetChannelProfileCommand(ctx, wshrpc.CommandSetChannelProfileData{
		ChannelId: ch.OID, Override: &waveobj.ProfileOverride{
			WorkerRoute: &waveobj.RoutePin{Runtime: "openrouter"},
		},
	}); err == nil {
		t.Fatal("expected an invalid profile worker route to be rejected")
	}
	if channelHasProfileMeta(t, ctx, ch.OID) {
		t.Fatal("a rejected engine default must not write channel meta")
	}
}

// An override carrying only engine defaults stores rather than being read as cleared, and round-trips.
func TestSetChannelProfileStoresEngineDefaults(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "profile-engine-store", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	route := &waveobj.RoutePin{Runtime: "pi"}
	if err := (&WshServer{}).SetChannelProfileCommand(ctx, wshrpc.CommandSetChannelProfileData{
		ChannelId: ch.OID, Override: &waveobj.ProfileOverride{
			Parallelism: intPtr(4), WorkerRoute: route,
		},
	}); err != nil {
		t.Fatalf("SetChannelProfileCommand: %v", err)
	}
	got, err := (&WshServer{}).GetJarvisProfileCommand(ctx, wshrpc.CommandGetJarvisProfileData{ChannelId: ch.OID})
	if err != nil {
		t.Fatalf("GetJarvisProfileCommand: %v", err)
	}
	if got.Resolved.Parallelism != 4 {
		t.Fatalf("resolved engine defaults missing: %+v", got.Resolved)
	}
	if got.Resolved.WorkerRoute == nil || *got.Resolved.WorkerRoute != *route {
		t.Fatalf("resolved worker route missing: %+v", got.Resolved.WorkerRoute)
	}
}
