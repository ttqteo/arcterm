// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"reflect"
	"strconv"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func bptr(b bool) *bool { return &b }

// captureClient records every event the broker sends, for asserting waveobj broadcasts in tests.
type captureClient struct {
	mu     sync.Mutex
	events []wps.WaveEvent
}

func (c *captureClient) SendEvent(_ string, event wps.WaveEvent) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.events = append(c.events, event)
}

func (c *captureClient) sawScope(scope string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, e := range c.events {
		for _, s := range e.Scopes {
			if s == scope {
				return true
			}
		}
	}
	return false
}

// A completing run must broadcast a run: waveobj update, not just channel:. The focused-run view subscribes
// to the per-run run:<id> object (channel-scaling Phase 2); a channel-only bump left it frozen at its
// last-focused state ("executing") with no completion card. Regression guard for that publish.
func TestCompleteBroadcastsRunUpdate(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "bcast-run", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	run := jarvis.NewRun("finish it", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}

	cc := &captureClient{}
	prevClient := wps.Broker.GetClient()
	wps.Broker.SetClient(cc)
	defer wps.Broker.SetClient(prevClient)
	routeId := "test-capture-route"
	wps.Broker.Subscribe(routeId, wps.SubscriptionRequest{Event: wps.Event_WaveObjUpdate, AllScopes: true})
	defer wps.Broker.Unsubscribe(routeId, wps.Event_WaveObjUpdate)

	origAsync := sealAsync
	sealAsync = func(func()) {} // drop the deferred seal; we only assert the transition broadcast
	defer func() { sealAsync = origAsync }()

	if err := (&WshServer{}).AdvanceRunCommand(ctx, wshrpc.CommandAdvanceRunData{
		ChannelId: ch.OID, RunId: run.ID, PhaseIdx: 0, Action: jarvis.RunAction_Complete,
	}); err != nil {
		t.Fatalf("AdvanceRunCommand: %v", err)
	}

	runScope := waveobj.MakeORef(waveobj.OType_Run, run.ID).String()
	if !cc.sawScope(runScope) {
		t.Fatalf("completion did not broadcast %s; focused run would stay stale", runScope)
	}
}

// A run reaching done must persist the phase transition synchronously (the ack `wsh jarvis complete`
// waits on) while the slow evidence seal (a git diff) is dispatched off the RPC budget. Sealing inline
// blocked the handler past the 5s client budget, surfacing as EC-TIME even though the completion had
// already registered. We prove the decoupling deterministically via the sealAsync seam: capture the seal
// instead of running it, then confirm the run is already done with evidence still unsealed.
func TestCompleteDefersEvidenceSeal(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "defer-seal", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	run := jarvis.NewRun("finish it", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}

	var captured func()
	origAsync := sealAsync
	sealAsync = func(fn func()) { captured = fn }
	defer func() { sealAsync = origAsync }()

	// a done quick run spawns no next worker; guard against a real subprocess if that assumption breaks
	origSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(_ context.Context, _ runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		return waveobj.MakeORef(waveobj.OType_Tab, "x").String(), nil
	}
	defer func() { jarvis.SpawnRunWorker = origSpawn }()

	ws := &WshServer{}
	if err := ws.AdvanceRunCommand(ctx, wshrpc.CommandAdvanceRunData{
		ChannelId: ch.OID, RunId: run.ID, PhaseIdx: 0, Action: jarvis.RunAction_Complete,
	}); err != nil {
		t.Fatalf("AdvanceRunCommand: %v", err)
	}

	done, err := wstore.GetRun(ctx, ch.OID, run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if done.Status != jarvis.RunStatus_Done {
		t.Fatalf("run status = %q, want done (the transition must persist synchronously)", done.Status)
	}
	if done.Evidence != nil {
		t.Fatal("evidence sealed inline; the slow seal must be deferred off the RPC budget")
	}
	if captured == nil {
		t.Fatal("seal was not dispatched to sealAsync")
	}

	captured() // running the deferred seal then persists the snapshot (idempotent; backfilled otherwise)
	sealed, err := wstore.GetRun(ctx, ch.OID, run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if sealed.Evidence == nil {
		t.Fatal("deferred seal did not persist evidence")
	}
}

// A run entering a rest state must dispatch the continuity boundary summary off the RPC budget (it is a
// model call). We prove the decoupling via the captureAsync seam: capture the dispatched func instead of
// running it, and confirm a ->done transition dispatched exactly one capture.
func TestAdvanceRunDispatchesContinuityCapture(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "continuity-dispatch", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	run := jarvis.NewRun("finish it", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}

	var capturedContinuity func()
	origCap := captureAsync
	captureAsync = func(fn func()) { capturedContinuity = fn }
	defer func() { captureAsync = origCap }()

	// keep the evidence seal off a real goroutine / git diff for this test
	origSeal := sealAsync
	sealAsync = func(fn func()) {}
	defer func() { sealAsync = origSeal }()

	origSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(_ context.Context, _ runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		return waveobj.MakeORef(waveobj.OType_Tab, "x").String(), nil
	}
	defer func() { jarvis.SpawnRunWorker = origSpawn }()

	ws := &WshServer{}
	if err := ws.AdvanceRunCommand(ctx, wshrpc.CommandAdvanceRunData{
		ChannelId: ch.OID, RunId: run.ID, PhaseIdx: 0, Action: jarvis.RunAction_Complete,
	}); err != nil {
		t.Fatalf("AdvanceRunCommand: %v", err)
	}

	if capturedContinuity == nil {
		t.Fatal("continuity capture was not dispatched on the ->done rest transition")
	}
}

func TestApplyRunActionCompleteStoresEndCommit(t *testing.T) {
	r := jarvis.NewRun("do X", "ws", "/p", nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	// complete with a reported commit -> stored on the run as EndCommit (scopes the sealed evidence diff)
	next, err := applyRunAction(r, wshrpc.CommandAdvanceRunData{Action: jarvis.RunAction_Complete, PhaseIdx: 0, Commit: "abc123"}, 2)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if next.EndCommit != "abc123" {
		t.Errorf("EndCommit = %q, want abc123", next.EndCommit)
	}
}

func TestApplyRunActionCompleteStoresReport(t *testing.T) {
	r := jarvis.NewRun("do X", "ws", "/p", nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	// complete with a report -> stored on the run so SealEvidence can use it as the summary
	next, err := applyRunAction(r, wshrpc.CommandAdvanceRunData{Action: jarvis.RunAction_Complete, PhaseIdx: 0, Report: "landed the fix"}, 2)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if next.Report != "landed the fix" {
		t.Errorf("Report = %q, want %q", next.Report, "landed the fix")
	}
}

func TestApplyRunActionUnknown(t *testing.T) {
	r := jarvis.NewRun("g", "ws", "/p", nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if _, err := applyRunAction(r, wshrpc.CommandAdvanceRunData{Action: "bogus"}, 0); err == nil {
		t.Error("expected error for unknown action")
	}
}

// A top-level launch with no stated shape is a quick run. No stored default can reach this: the launcher
// hydrates its shape control from the profile and sends the choice explicitly, so the only caller that
// consults a saved default is childRunPlan, which resolves it before calling in.
func TestResolveRunPlanDefaultsToQuick(t *testing.T) {
	mode, phases := resolveRunPlan("")
	if mode != jarvis.RunMode_Quick || len(phases) != 1 || phases[0].Kind != jarvis.PhaseKind_Execute || phases[0].Gate || phases[0].Skill != "" {
		t.Fatalf("default launch must be one ungated bare worker: mode=%q phases=%+v", mode, phases)
	}
}

// Two shapes survive: an explicit orchestrator, and a quick run for everything else — including
// the pipeline a saved profile may still name.
func TestResolveRunPlanHonorsExplicitMode(t *testing.T) {
	for requested, want := range map[string]string{
		jarvis.RunMode_Quick:        jarvis.RunMode_Quick,
		jarvis.RunMode_Pipeline:     jarvis.RunMode_Quick,
		jarvis.RunMode_Orchestrator: jarvis.RunMode_Orchestrator,
	} {
		t.Run(requested, func(t *testing.T) {
			mode, phases := resolveRunPlan(requested)
			if mode != want || len(phases) != 1 {
				t.Fatalf("requested %q: mode=%q phases=%+v, want %q", requested, mode, phases, want)
			}
		})
	}
}

func TestChildRunPlanPreservesInheritedStrategy(t *testing.T) {
	for _, tc := range []struct{ saved, requested, want string }{
		{"", "", jarvis.RunMode_Quick},
		{jarvis.RunMode_Pipeline, "", jarvis.RunMode_Quick},
		{jarvis.RunMode_Orchestrator, "", jarvis.RunMode_Orchestrator},
		{jarvis.RunMode_Orchestrator, jarvis.RunMode_Quick, jarvis.RunMode_Quick},
		{jarvis.RunMode_Quick, jarvis.RunMode_Orchestrator, jarvis.RunMode_Orchestrator},
	} {
		t.Run(tc.saved+"/"+tc.requested, func(t *testing.T) {
			mode, phases := childRunPlan(waveobj.JarvisProfile{DefaultMode: tc.saved}, tc.requested)
			if mode != tc.want || len(phases) == 0 {
				t.Fatalf("mode=%q phases=%+v, want %q", mode, phases, tc.want)
			}
			for _, phase := range phases {
				if phase.Gate {
					t.Fatalf("child phase must remain ungated: %+v", phase)
				}
			}
		})
	}
}

// stubRunServer replaces the process boundaries (harness validation + worker spawn) so run handlers
// are deterministic without launching CLIs or tabs. Restores prior values on cleanup.
func stubRunServer(t *testing.T, validRuntime string, spawnErr error, captured ...*runroute.Capability) {
	t.Helper()
	stubHarnessInstalled(t, validRuntime)

	oldSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(ctx context.Context, cap runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		if len(captured) > 0 && captured[0] != nil {
			*captured[0] = cap
		}
		if cap.Runtime != validRuntime {
			return "", context.Canceled
		}
		if spawnErr != nil {
			return "", spawnErr
		}
		// a real tab, as a spawned worker has: the engine reads a worker whose tab is missing as gone
		tab := &waveobj.Tab{OID: uuid.NewString()}
		if err := wstore.DBInsert(ctx, tab); err != nil {
			return "", err
		}
		return waveobj.MakeORef(waveobj.OType_Tab, tab.OID).String(), nil
	}
	t.Cleanup(func() { jarvis.SpawnRunWorker = oldSpawn })

	oldSeal := sealAsync
	sealAsync = func(func()) {}
	t.Cleanup(func() { sealAsync = oldSeal })
}

// stubHarnessInstalled makes validRuntime pass the handlers' lead and run-worker harness checks and the
// engine's, whether or not its CLI is on this machine's PATH; any other runtime is validated for real.
func stubHarnessInstalled(t *testing.T, validRuntime string) {
	t.Helper()
	oldValidate := validateHarness
	validateHarness = func(runtime string, op harness.Operation) (harness.Spec, error) {
		// the run's own runtime and its reviewer are leads; worker routes are run workers
		if op != harness.OperationRunWorker && op != harness.OperationLead {
			t.Fatalf("validated with operation %q, want run-worker or lead", op)
		}
		spec, ok := harness.Lookup(runtime)
		if !ok || runtime != validRuntime {
			return harness.ValidateInstalled(runtime, op)
		}
		return spec, nil
	}
	t.Cleanup(func() { validateHarness = oldValidate })
	t.Cleanup(orchestrate.SetValidateWorkerHarnessForTest(func(runtime string) error {
		if runtime == validRuntime {
			return nil
		}
		_, err := harness.ValidateInstalled(runtime, harness.OperationRunWorker)
		return err
	}))
}

// New Run creation requires an explicit, validated runtime: an empty runtime is rejected before the
// run is appended or a worker spawned.
func TestCreateRunCommand_EmptyRuntimeRejected(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "create-empty-rt", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	stubRunServer(t, "pi", nil)

	ws := &WshServer{}
	_, err = ws.CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws-1", Goal: "do it", Runtime: "",
	})
	if err == nil {
		t.Fatal("CreateRun must reject an empty runtime")
	}
	existing, _ := wstore.GetChannelRuns(ctx, ch.OID)
	if len(existing) != 0 {
		t.Fatalf("no run should be persisted on rejection, got %d", len(existing))
	}
}

func TestCreateRunCommand_RejectsInvalidOrUnavailableRouteBeforePersistence(t *testing.T) {
	cases := []struct {
		name, runtime string
		available     bool
		// leadRefused: runroute accepts the route, and the harness catalog refuses it for the lead operation
		leadRefused bool
	}{
		{name: "unsupported runtime", runtime: "opencode"},
		{name: "unavailable harness", runtime: "claude", available: false},
		// codex is a worker route, so runroute resolves it; only OperationLead keeps it from leading a run
		{name: "codex cannot lead", runtime: "codex", leadRefused: true},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			ctx := context.Background()
			ch, err := wstore.CreateChannel(ctx, "reject-route-"+tt.name, "/repo")
			if err != nil {
				t.Fatalf("CreateChannel: %v", err)
			}
			if _, err := runroute.Resolve(waveobj.RoutePin{Runtime: tt.runtime}); tt.leadRefused && err != nil {
				t.Fatalf("runroute refused %q (%v): the case is for a route the lead operation refuses", tt.runtime, err)
			}
			var leadOps []harness.Operation
			oldValidate := validateHarness
			validateHarness = func(runtime string, op harness.Operation) (harness.Spec, error) {
				if tt.leadRefused {
					leadOps = append(leadOps, op)
					return harness.ValidateCapable(runtime, op)
				}
				if !tt.available {
					return harness.Spec{}, context.Canceled
				}
				t.Fatal("validateHarness called for a route rejected by runroute")
				return harness.Spec{}, nil
			}
			t.Cleanup(func() { validateHarness = oldValidate })
			var spawnCalls int
			oldSpawn := jarvis.SpawnRunWorker
			jarvis.SpawnRunWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
				spawnCalls++
				return "tab:unexpected", nil
			}
			t.Cleanup(func() { jarvis.SpawnRunWorker = oldSpawn })

			_, err = (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
				ChannelId: ch.OID, WorkspaceId: "ws-1", Goal: "do it", Runtime: tt.runtime,
			})
			if err == nil {
				t.Fatal("CreateRun must reject the route")
			}
			if tt.leadRefused && (len(leadOps) != 1 || leadOps[0] != harness.OperationLead) {
				t.Fatalf("the route must be refused by the lead operation, got operations %v (error %v)", leadOps, err)
			}
			if runs, _ := wstore.GetChannelRuns(ctx, ch.OID); len(runs) != 0 {
				t.Fatalf("rejected route persisted %d runs", len(runs))
			}
			if spawnCalls != 0 {
				t.Fatalf("rejected route spawned %d workers", spawnCalls)
			}
		})
	}
}

// New Run creation persists the explicit runtime on the Run before the worker is spawned.
func TestCreateRunCommand_PersistsExplicitRuntime(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "create-open", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	var spawnedCap runroute.Capability
	stubRunServer(t, "pi", nil, &spawnedCap)

	ws := &WshServer{}
	rtn, err := ws.CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws-1", Goal: "do it", Runtime: "pi",
	})
	if err != nil {
		t.Fatalf("CreateRunCommand: %v", err)
	}
	if rtn.Run.Runtime != "pi" || rtn.Run.Model != "" {
		t.Fatalf("persisted route = %s/%q, want pi with its default model", rtn.Run.Runtime, rtn.Run.Model)
	}
	if spawnedCap.Runtime != "pi" || spawnedCap.Model != "" || spawnedCap.ResolvedModel != "operator default" || len(spawnedCap.ModelArgs) != 0 {
		t.Fatalf("spawned capability = %+v, want the pi operator default", spawnedCap)
	}
	if got := mustSeq(t, ch.OID, rtn.Run.ID); !reflect.DeepEqual(got, []string{
		waveobj.RunEventKindCreated, waveobj.RunEventKindPhaseStarted + "@0",
	}) {
		t.Fatalf("non-deferred lifecycle events = %v, want created then phase-started@0", got)
	}
}

// An unknown runtime is rejected before any run is persisted.
func TestCreateRunCommand_UnknownRuntimeRejected(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "create-unknown-rt", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	oldValidate := validateHarness
	validateHarness = func(runtime string, op harness.Operation) (harness.Spec, error) {
		return harness.ValidateInstalled(runtime, op)
	}
	t.Cleanup(func() { validateHarness = oldValidate })

	_, err = (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws-1", Goal: "do it", Runtime: "mystery",
	})
	if err == nil {
		t.Fatal("CreateRun must reject an unknown runtime")
	}
	existing, _ := wstore.GetChannelRuns(ctx, ch.OID)
	if len(existing) != 0 {
		t.Fatalf("no run should be persisted on rejection, got %d", len(existing))
	}
}

// storedPipelinePhases is the shape a pipeline run was created with before 5c deleted the mode. The
// store still holds them, and advancing one is still what spawns the next phase's worker.
func storedPipelinePhases() []waveobj.RunPhase {
	return []waveobj.RunPhase{
		{Kind: jarvis.PhaseKind_Brainstorm, Skill: "superpowers:brainstorming", State: jarvis.PhaseState_Pending},
		{Kind: jarvis.PhaseKind_Execute, Skill: "superpowers:executing-plans", State: jarvis.PhaseState_Pending, FreshCtx: true},
	}
}

// AdvanceRun must spawn the next phase with the run's persisted runtime, never a request-side value.
func TestAdvanceRun_SpawnsPersistedRuntime(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "advance-rt", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	run := jarvis.NewRun("do it", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Pipeline, storedPipelinePhases(), 1)
	run.Runtime = "claude"
	run.Model = consult.CheapModel
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}

	var spawnedWith runroute.Capability
	oldValidate := validateHarness
	validateHarness = func(runtime string, op harness.Operation) (harness.Spec, error) {
		spec, ok := harness.Lookup(runtime)
		if !ok {
			return harness.ValidateInstalled(runtime, op)
		}
		return spec, nil
	}
	t.Cleanup(func() { validateHarness = oldValidate })
	oldSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(_ context.Context, cap runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		spawnedWith = cap
		return waveobj.MakeORef(waveobj.OType_Tab, "w").String(), nil
	}
	t.Cleanup(func() { jarvis.SpawnRunWorker = oldSpawn })
	oldSeal := sealAsync
	sealAsync = func(func()) {}
	t.Cleanup(func() { sealAsync = oldSeal })

	if err := (&WshServer{}).AdvanceRunCommand(ctx, wshrpc.CommandAdvanceRunData{
		ChannelId: ch.OID, RunId: run.ID, PhaseIdx: 0, Action: jarvis.RunAction_Complete,
	}); err != nil {
		t.Fatalf("AdvanceRunCommand: %v", err)
	}
	if spawnedWith.Runtime != "claude" || spawnedWith.Model != consult.CheapModel || !reflect.DeepEqual(spawnedWith.ModelArgs, []string{"--model", consult.CheapModel}) {
		t.Fatalf("next worker spawned with capability %+v, want claude with haiku model args", spawnedWith)
	}
}

func TestAdvanceRun_LegacyRouteNormalizesOnlyForSpawn(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "advance-legacy-route", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	run := jarvis.NewRun("do it", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Pipeline, storedPipelinePhases(), 1)
	run.Runtime = "claude"
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	var spawnedWith runroute.Capability
	oldValidate := validateHarness
	validateHarness = func(runtime string, op harness.Operation) (harness.Spec, error) {
		if runtime != "claude" || op != harness.OperationLead {
			t.Fatalf("validateHarness(%q, %q)", runtime, op)
		}
		return harness.Spec{}, nil
	}
	t.Cleanup(func() { validateHarness = oldValidate })
	oldSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(_ context.Context, cap runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		spawnedWith = cap
		return waveobj.MakeORef(waveobj.OType_Tab, "legacy-worker").String(), nil
	}
	t.Cleanup(func() { jarvis.SpawnRunWorker = oldSpawn })
	oldSeal := sealAsync
	sealAsync = func(func()) {}
	t.Cleanup(func() { sealAsync = oldSeal })

	if err := (&WshServer{}).AdvanceRunCommand(ctx, wshrpc.CommandAdvanceRunData{
		ChannelId: ch.OID, RunId: run.ID, PhaseIdx: 0, Action: jarvis.RunAction_Complete,
	}); err != nil {
		t.Fatalf("AdvanceRunCommand: %v", err)
	}
	if spawnedWith.Runtime != "claude" || spawnedWith.Model != "" || len(spawnedWith.ModelArgs) != 0 {
		t.Fatalf("legacy worker capability = %+v, want the claude operator default", spawnedWith)
	}
	persisted, err := wstore.GetRun(ctx, ch.OID, run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if persisted.Runtime != "claude" || persisted.Model != "" {
		t.Fatalf("legacy run was rewritten while spawning: %s/%q", persisted.Runtime, persisted.Model)
	}
}

// mustKinds collects a run's event kinds newest-first for a presence assertion.
func mustKinds(t *testing.T, channelId, runID string) []string {
	t.Helper()
	events, err := wstore.QueryRunEvents(context.Background(), channelId, runID, 50)
	if err != nil {
		t.Fatalf("QueryRunEvents: %v", err)
	}
	kinds := make([]string, 0, len(events))
	for _, e := range events {
		kinds = append(kinds, e.Kind)
	}
	return kinds
}

func containsKind(kinds []string, kind string) bool {
	for _, k := range kinds {
		if k == kind {
			return true
		}
	}
	return false
}

func mustSeq(t *testing.T, channelId, runID string) []string {
	t.Helper()
	events, err := wstore.QueryRunEvents(context.Background(), channelId, runID, 50)
	if err != nil {
		t.Fatalf("QueryRunEvents: %v", err)
	}
	// QueryRunEvents returns newest-first; the log is append-ordered, so reverse to read it forward.
	out := make([]string, 0, len(events))
	for i := len(events) - 1; i >= 0; i-- {
		e := events[i]
		idx := ""
		if e.PhaseIdx != nil {
			idx = "@" + strconv.Itoa(*e.PhaseIdx)
		}
		out = append(out, e.Kind+idx)
	}
	return out
}

// A pipeline run driven end-to-end through the real AdvanceRunCommand must leave a lifecycle log whose
// ORDER narrates the run the way the focused card renders it: every phase started, completing the gate
// Cancelling a run must record the terminal event on its log (written after the cancelled state is
// persisted, so the row is durable).
func TestRunCancelWritesRunCancelledEvent(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "cancel-events", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	run := jarvis.NewRun("cancel me", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	if err := (&WshServer{}).CancelRunCommand(ctx, wshrpc.CommandCancelRunData{ChannelId: ch.OID, RunId: run.ID}); err != nil {
		t.Fatalf("CancelRunCommand: %v", err)
	}
	if !containsKind(mustKinds(t, ch.OID, run.ID), waveobj.RunEventKindRunCancelled) {
		t.Fatalf("expected run-cancelled event")
	}
}

// A done run is terminal: cancelling it would rewrite a finished run's status to cancelled, which no
// later action can undo, so the RPC refuses and leaves the run as it was.
func TestCancelRunRefusesDoneRun(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "cancel-done", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	run := jarvis.NewRun("finished", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	run.Status = jarvis.RunStatus_Done
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	if err := (&WshServer{}).CancelRunCommand(ctx, wshrpc.CommandCancelRunData{ChannelId: ch.OID, RunId: run.ID}); err == nil {
		t.Fatal("CancelRunCommand must refuse a done run")
	}
	got, err := wstore.GetRun(ctx, ch.OID, run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if got.Status != jarvis.RunStatus_Done {
		t.Fatalf("status = %s, want done left untouched", got.Status)
	}
	if containsKind(mustKinds(t, ch.OID, run.ID), waveobj.RunEventKindRunCancelled) {
		t.Fatal("a refused cancel must not log run-cancelled")
	}
}

func TestCreateRunDeferStart(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "create-deferred", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	stubRunServer(t, "pi", nil)

	rtn, err := (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws", Goal: "test", Runtime: "pi",
		Mode: jarvis.RunMode_Orchestrator, DeferStart: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if rtn.Run.Status != "planning" {
		t.Fatalf("want planning, got %s", rtn.Run.Status)
	}
	if len(rtn.Run.Phases[0].WorkerOrefs) != 0 {
		t.Fatalf("deferred run must not spawn workers")
	}
	if got := mustSeq(t, ch.OID, rtn.Run.ID); !reflect.DeepEqual(got, []string{
		waveobj.RunEventKindCreated,
	}) {
		t.Fatalf("deferred lifecycle events = %v, want only run-created", got)
	}
}

func TestCancelOwningRunCascadesThroughDag(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "cancel-owner-dag", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	child := jarvis.NewRun("child", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	dag, err := orchestrate.NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t", Label: "task"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	owner.DagORef = dag.OID
	child.DagORef = dag.OID
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
		t.Fatal(err)
	}
	dag.Tasks[0].State = orchestrate.TaskState_Running
	dag.Tasks[0].RunID = child.ID
	if err := wstore.AppendDag(ctx, &dag); err != nil {
		t.Fatal(err)
	}

	if err := (&WshServer{}).CancelRunCommand(ctx, wshrpc.CommandCancelRunData{ChannelId: ch.OID, RunId: owner.ID}); err != nil {
		t.Fatal(err)
	}
	gotOwner, _ := wstore.GetRun(ctx, ch.OID, owner.ID)
	gotChild, _ := wstore.GetRun(ctx, ch.OID, child.ID)
	gotDag, _ := wstore.GetDag(ctx, dag.OID)
	if gotOwner.Status != jarvis.RunStatus_Cancelled || gotChild.Status != jarvis.RunStatus_Cancelled || gotDag.Status != orchestrate.DagStatus_Cancelled {
		t.Fatalf("owner cancellation did not cascade: owner=%q child=%q dag=%q", gotOwner.Status, gotChild.Status, gotDag.Status)
	}
}

func TestCancelRunDoesNotBypassMissingLinkedDag(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "cancel-missing-dag", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	run := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	run.DagORef = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatal(err)
	}

	if err := (&WshServer{}).CancelRunCommand(ctx, wshrpc.CommandCancelRunData{ChannelId: ch.OID, RunId: run.ID}); err == nil {
		t.Fatal("want linked DAG load failure")
	}
	got, err := wstore.GetRun(ctx, ch.OID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status == jarvis.RunStatus_Cancelled {
		t.Fatal("owner was partially cancelled despite unresolved DAG")
	}
}

func TestCreateRunCommand_PersistsModelRoute(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "create-model", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	var spawnedCap runroute.Capability
	stubRunServer(t, "claude", nil, &spawnedCap)

	ws := &WshServer{}
	rtn, err := ws.CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws-1", Goal: "do it", Runtime: "claude", Model: "sonnet",
	})
	if err != nil {
		t.Fatalf("CreateRunCommand: %v", err)
	}
	if rtn.Run.Model != "sonnet" || rtn.Run.Runtime != "claude" {
		t.Fatalf("persisted route = %s model=%q, want claude/sonnet", rtn.Run.Runtime, rtn.Run.Model)
	}
	if spawnedCap.Model != "sonnet" || !reflect.DeepEqual(spawnedCap.ModelArgs, []string{"--model", "sonnet"}) {
		t.Fatalf("spawned capability = %+v, want claude sonnet --model args", spawnedCap)
	}
}

func TestCreateRunCommand_RejectsCrossNamespaceModelBeforePersistence(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "create-badmodel", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	oldValidate := validateHarness
	validateHarness = func(string, harness.Operation) (harness.Spec, error) {
		t.Fatal("validateHarness called for a route rejected by runroute")
		return harness.Spec{}, nil
	}
	t.Cleanup(func() { validateHarness = oldValidate })
	var spawnCalls int
	oldSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		spawnCalls++
		return "tab:unexpected", nil
	}
	t.Cleanup(func() { jarvis.SpawnRunWorker = oldSpawn })

	_, err = (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws-1", Goal: "do it", Runtime: "claude", Model: "gpt-5.4",
	})
	if err == nil {
		t.Fatal("cross-namespace model must be rejected")
	}
	if runs, _ := wstore.GetChannelRuns(ctx, ch.OID); len(runs) != 0 {
		t.Fatalf("rejected route persisted %d runs", len(runs))
	}
	if spawnCalls != 0 {
		t.Fatalf("rejected route spawned %d workers", spawnCalls)
	}
}

func TestCreateRunCommand_PersistsOrchestration(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "create-orch", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	var spawnedCap runroute.Capability
	stubRunServer(t, "claude", nil, &spawnedCap)

	ws := &WshServer{}
	rtn, err := ws.CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws-1", Goal: "do it", Runtime: "claude",
		Mode: jarvis.RunMode_Orchestrator, Orchestration: jarvis.Orchestration_Engine,
	})
	if err != nil {
		t.Fatalf("CreateRunCommand: %v", err)
	}
	if rtn.Run.Orchestration != jarvis.Orchestration_Engine {
		t.Fatalf("persisted orchestration = %q, want engine", rtn.Run.Orchestration)
	}
}

// A multi-phase run driven end-to-end through the real AdvanceRunCommand must leave a lifecycle log whose
// ORDER narrates the run the way the focused card renders it: every phase started, each completion released
// its successor, and the cancel lands last. Slice 5c deleted the review gate that used to interrupt this
// sequence, so nothing between the phases pauses any more — which is exactly what the exact-order assert
// has to keep true, because a phase that silently failed to start reads as a run that is still working.
func TestRunLifecycleEventsAppended(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "events-run", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	run := jarvis.NewRun("finish it", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Pipeline, storedPipelinePhases(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	// the RPC create path writes phase-started(0); the direct handler test seeds it the same way
	phase0 := 0
	if _, err := wstore.AppendRunEvent(ctx, ch.OID, run.ID, waveobj.RunEventKindPhaseStarted, &phase0, map[string]any{}); err != nil {
		t.Fatalf("append phase-started: %v", err)
	}
	// AdvanceRunCommand spawns workers for newly-running phases at its tail; stub the spawn seam so the
	// test never touches real tabs/PTYs
	origSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(_ context.Context, _ runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		return waveobj.MakeORef(waveobj.OType_Tab, "x").String(), nil
	}
	defer func() { jarvis.SpawnRunWorker = origSpawn }()

	ws := &WshServer{}
	if err := ws.AdvanceRunCommand(ctx, wshrpc.CommandAdvanceRunData{
		ChannelId: ch.OID, RunId: run.ID, PhaseIdx: 0, Action: jarvis.RunAction_Complete,
	}); err != nil {
		t.Fatalf("AdvanceRunCommand(complete): %v", err)
	}
	// cancel the running execute phase so the terminal row lands without the done-transition seal
	if err := ws.CancelRunCommand(ctx, wshrpc.CommandCancelRunData{ChannelId: ch.OID, RunId: run.ID}); err != nil {
		t.Fatalf("CancelRunCommand: %v", err)
	}

	want := []string{"phase-started@0", "phase-complete@0", "phase-started@1", "run-cancelled"}
	got := mustSeq(t, ch.OID, run.ID)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("events %v:\n want %v", got, want)
	}
}
