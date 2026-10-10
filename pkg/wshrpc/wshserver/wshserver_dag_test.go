// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestDagSubmitAndAction(t *testing.T) {
	ctx := context.Background()
	oldSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(ctx context.Context, cap runroute.Capability, workspaceId, projectName, cwd, prompt string, _ jarvis.RunWorkerOptions) (string, error) {
		tabId := uuid.NewString()
		blockId := uuid.NewString()
		tab := &waveobj.Tab{OID: tabId, BlockIds: []string{blockId}}
		_ = wstore.DBInsert(ctx, tab)
		block := &waveobj.Block{OID: blockId, ParentORef: "tab:" + tabId}
		_ = wstore.DBInsert(ctx, block)
		return "tab:" + tabId, nil
	}
	defer func() { jarvis.SpawnRunWorker = oldSpawn }()
	ch, err := wstore.CreateChannel(ctx, "dag-test", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	run := jarvis.NewRun("do the thing", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	run.Status = jarvis.RunStatus_Planning
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	ws := &WshServer{}
	g, err := ws.DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{
		ChannelId: ch.OID, RunId: run.ID, Title: "t", Parallelism: 2,
		Tasks: []waveobj.TaskNode{
			{ID: "t-0", Label: "a"},
			{ID: "t-1", Label: "b", Deps: []string{"t-0"}, Gate: true},
			{ID: "t-2", Label: "c", Deps: []string{"t-1"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if g.Status != "running" {
		t.Fatalf("want running, got %s", g.Status)
	}
	// submitting is what dispatches: the first layer is live in the group submit returns
	if g.Tasks[0].State != orchestrate.TaskState_Running || g.Tasks[0].RunID == "" {
		t.Fatalf("submit must schedule the first step: t-0 running with child run, got %+v", g.Tasks[0])
	}
	// approve on a non-gate task errors (targeted actions must not silently no-op):
	if err := ws.DagActionCommand(ctx, wshrpc.CommandDagActionData{ChannelId: ch.OID, RunId: run.ID, TaskId: "t-0", Action: "approve"}); err == nil {
		t.Fatal("approve on non-gate task must error")
	}
	// gate flow: t-0 done -> running; gate (t-1) done -> awaiting-review; approve -> running
	if err := wstore.UpdateDag(ctx, g.ID, func(g *waveobj.TaskGroup) error {
		g.Tasks[0].State = orchestrate.TaskState_Done
		orchestrate.RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(ctx, g.ID, func(g *waveobj.TaskGroup) error {
		g.Tasks[1].State = orchestrate.TaskState_Done
		orchestrate.RecomputeDagStatus(g)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	g2, err := ws.DagStatusCommand(ctx, wshrpc.CommandDagStatusData{ChannelId: ch.OID, RunId: run.ID})
	if err != nil {
		t.Fatal(err)
	}
	if g2.Group.Status != "awaiting-review" {
		t.Fatalf("want awaiting-review, got %s", g2.Group.Status)
	}
	if g2.Digest.DagVersion != g2.Group.Version || g2.Digest.Counts.Total != len(g2.Group.Tasks) {
		t.Fatalf("status digest not tied to group: version %d/%d counts %+v", g2.Digest.DagVersion, g2.Group.Version, g2.Digest.Counts)
	}
	if g2.Digest.Next.Kind != "human-action" || len(g2.Digest.Next.Actions) != 2 {
		t.Fatalf("gate digest must expose approve/sendback, got %+v", g2.Digest.Next)
	}
	if err := ws.DagActionCommand(ctx, wshrpc.CommandDagActionData{ChannelId: ch.OID, RunId: run.ID, TaskId: "t-1", Action: "approve"}); err != nil {
		t.Fatal(err)
	}
	g3, _ := ws.DagStatusCommand(ctx, wshrpc.CommandDagStatusData{ChannelId: ch.OID, RunId: run.ID})
	if g3.Group.Status != "running" {
		t.Fatalf("want running after approve, got %s", g3.Group.Status)
	}
	// cancel is terminal
	if err := ws.DagActionCommand(ctx, wshrpc.CommandDagActionData{ChannelId: ch.OID, RunId: run.ID, TaskId: "", Action: "cancel"}); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	g4, _ := ws.DagStatusCommand(ctx, wshrpc.CommandDagStatusData{ChannelId: ch.OID, RunId: run.ID})
	if g4.Group.Status != "cancelled" {
		t.Fatalf("want cancelled, got %s", g4.Group.Status)
	}
	cancelledOwner, err := wstore.GetRun(ctx, ch.OID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cancelledOwner.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("owner status = %q, want cancelled", cancelledOwner.Status)
	}
	for _, task := range g4.Group.Tasks {
		if task.RunID == "" {
			continue
		}
		child, err := wstore.GetRun(ctx, ch.OID, task.RunID)
		if err != nil {
			t.Fatal(err)
		}
		if child.Status != jarvis.RunStatus_Cancelled {
			t.Fatalf("child %s status = %q, want cancelled", child.ID, child.Status)
		}
		for _, phase := range child.Phases {
			for _, workerORef := range phase.WorkerOrefs {
				tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, strings.TrimPrefix(workerORef, "tab:"))
				if err != nil {
					t.Fatal(err)
				}
				for _, blockID := range tab.BlockIds {
					block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockID)
					if err != nil {
						t.Fatal(err)
					}
					if block.Meta[waveobj.MetaKey_CmdRunOnStart] != false {
						t.Fatalf("worker block %s runonstart = %#v, want false", blockID, block.Meta[waveobj.MetaKey_CmdRunOnStart])
					}
				}
			}
		}
	}
}

func TestDagSubmitOnLiveLeadRun(t *testing.T) {
	// the adaptive orchestrator flow starts the orchestrate phase immediately (run is executing
	// with no dag); a mid-run dag publish must be accepted, not rejected with "want planning".
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "dag-live-lead", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	run := jarvis.NewRun("do the thing", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if run.Status != jarvis.RunStatus_Executing {
		t.Fatalf("new orchestrator run status = %q, want executing (adaptive lead started)", run.Status)
	}
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	stubRunServer(t, "pi", nil)
	ws := &WshServer{}
	g, err := ws.DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{
		ChannelId: ch.OID, RunId: run.ID, Title: "t", Parallelism: 1,
		Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "one"}},
	})
	if err != nil {
		t.Fatalf("submit on executing lead run must succeed: %v", err)
	}
	got, err := wstore.GetRun(ctx, ch.OID, run.ID)
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if got.DagORef != g.OID {
		t.Fatalf("dagoref not linked")
	}
	if got.Status != jarvis.RunStatus_Executing {
		t.Fatalf("run status = %q, want executing", got.Status)
	}
}

func TestDagSubmitDeferredRun(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "dag-deferred", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	stubRunServer(t, "pi", nil)
	ws := &WshServer{}
	rtn, err := ws.CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws", Goal: "test", Runtime: "pi",
		Mode: jarvis.RunMode_Orchestrator, DeferStart: true,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	g, err := ws.DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{
		ChannelId: ch.OID, RunId: rtn.Run.ID, Title: "g", Parallelism: 1,
		Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "one"}},
	})
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	got, err := wstore.GetRun(ctx, ch.OID, rtn.Run.ID)
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if got.Status != "executing" {
		t.Fatalf("want executing, got %s", got.Status)
	}
	if got.DagORef != g.OID {
		t.Fatalf("dagoref not linked")
	}
	// publishing the plan is what dispatches it, so the first task spawns on the submit itself
	wantEvents := []string{waveobj.RunEventKindCreated, waveobj.RunEventKindPhaseStarted + "@0", waveobj.RunEventKindTaskSpawned}
	if gotEvents := mustSeq(t, ch.OID, rtn.Run.ID); !reflect.DeepEqual(gotEvents, wantEvents) {
		t.Fatalf("deferred lifecycle events = %v, want %v", gotEvents, wantEvents)
	}
	retry, err := ws.DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{
		ChannelId: ch.OID, RunId: rtn.Run.ID, Title: "g", Parallelism: 1,
		Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "one"}},
	})
	if err != nil {
		t.Fatalf("identical retry: %v", err)
	}
	if retry.OID != g.OID {
		t.Fatalf("identical retry dag = %q, want %q", retry.OID, g.OID)
	}
	if gotEvents := mustSeq(t, ch.OID, rtn.Run.ID); !reflect.DeepEqual(gotEvents, wantEvents) {
		t.Fatalf("identical retry lifecycle events = %v, want unchanged %v", gotEvents, wantEvents)
	}
	if _, err := ws.DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{
		ChannelId: ch.OID, RunId: rtn.Run.ID, Title: "second", Parallelism: 1,
		Tasks: []waveobj.TaskNode{{ID: "t-2", Label: "two"}},
	}); err == nil {
		t.Fatalf("second different submit must be rejected")
	}
	if gotEvents := mustSeq(t, ch.OID, rtn.Run.ID); !reflect.DeepEqual(gotEvents, wantEvents) {
		t.Fatalf("repeated submit lifecycle events = %v, want unchanged %v", gotEvents, wantEvents)
	}
}

func TestDagSubmitRejectsEngineStateBeforePersistence(t *testing.T) {
	cases := []struct {
		name        string
		title       string
		parallelism int
		tasks       []waveobj.TaskNode
	}{
		{name: "state", title: "g", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "t", Label: "a", State: "running"}}},
		{name: "runid", title: "g", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "t", Label: "a", RunID: "child"}}},
		{name: "released", title: "g", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "t", Label: "a", Released: true}}},
		{name: "lastactivity", title: "g", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "t", Label: "a", LastActivity: 1}}},
		{name: "attempts", title: "g", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "t", Label: "a", Attempts: 1}}},
		{name: "lastfailurekind", title: "g", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "t", Label: "a", LastFailureKind: "timeout"}}},
		{name: "escalations", title: "g", parallelism: 1, tasks: []waveobj.TaskNode{{ID: "t", Label: "a", Escalations: 1}}},
		{name: "zero-parallelism", title: "g", parallelism: 0, tasks: []waveobj.TaskNode{{ID: "t", Label: "a"}}},
		{name: "excess-parallelism", title: "g", parallelism: 9, tasks: []waveobj.TaskNode{{ID: "t", Label: "a"}}},
	}
	oldValidate := validateHarness
	validateHarness = func(runtime string, _ harness.Operation) (harness.Spec, error) {
		spec, ok := harness.Lookup(runtime)
		if !ok {
			return harness.Spec{}, fmt.Errorf("unknown harness %q", runtime)
		}
		return spec, nil
	}
	t.Cleanup(func() { validateHarness = oldValidate })
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			ch, err := wstore.CreateChannel(ctx, "dag-invalid-"+tc.name, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			owner := jarvis.NewRun("owner", "ws", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
			owner.Status = jarvis.RunStatus_Planning
			owner.Runtime = "claude"
			if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
				t.Fatal(err)
			}
			if _, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{
				ChannelId: ch.OID, RunId: owner.ID, Title: tc.title, Parallelism: tc.parallelism, Tasks: tc.tasks,
			}); err == nil {
				t.Fatal("want submit validation error")
			}
			got, err := wstore.GetRun(ctx, ch.OID, owner.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got.DagORef != "" || got.Status != jarvis.RunStatus_Planning {
				t.Fatalf("invalid submit mutated owner: %+v", got)
			}
		})
	}
}

func TestDagSubmitRejectsInvalidTaskRoutesBeforePersistence(t *testing.T) {
	cases := []struct {
		name        string
		task        waveobj.TaskNode
		unavailable bool
	}{
		{name: "unknown-runtime", task: waveobj.TaskNode{ID: "t", Label: "a", RunSpec: waveobj.RunSpec{Runtime: "missing"}}},
		{name: "cross-namespace-model", task: waveobj.TaskNode{ID: "t", Label: "a", RunSpec: waveobj.RunSpec{Runtime: "pi", Model: "sonnet"}}},
		{name: "model-foreign-to-inherited-runtime", task: waveobj.TaskNode{ID: "t", Label: "a", RunSpec: waveobj.RunSpec{Model: "opencode/deepseek-v4-pro"}}},
		{name: "non-worker-runtime", task: waveobj.TaskNode{ID: "t", Label: "a", RunSpec: waveobj.RunSpec{Runtime: "opencode"}}},
		{name: "unavailable", task: waveobj.TaskNode{ID: "t", Label: "a", RunSpec: waveobj.RunSpec{Runtime: "pi", Model: "opencode/deepseek-v4-pro"}}, unavailable: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			ch, err := wstore.CreateChannel(ctx, "dag-route-"+tc.name, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
			owner.Runtime = "claude"
			if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
				t.Fatal(err)
			}
			oldValidate := validateHarness
			validateHarness = func(runtime string, op harness.Operation) (harness.Spec, error) {
				if tc.unavailable && runtime == "pi" {
					return harness.Spec{}, fmt.Errorf("harness %q unavailable", runtime)
				}
				spec, ok := harness.Lookup(runtime)
				if !ok {
					return harness.Spec{}, fmt.Errorf("unknown harness %q", runtime)
				}
				return spec, nil
			}
			t.Cleanup(func() { validateHarness = oldValidate })
			runningBefore, err := wstore.GetDagsByStatus(ctx, orchestrate.DagStatus_Running)
			if err != nil {
				t.Fatal(err)
			}
			spawned := 0
			oldSpawn := jarvis.SpawnRunWorker
			jarvis.SpawnRunWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
				spawned++
				return "tab:worker", nil
			}
			t.Cleanup(func() { jarvis.SpawnRunWorker = oldSpawn })

			ws := &WshServer{}
			if _, err := ws.DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{
				ChannelId: ch.OID, RunId: owner.ID, Title: "g", Parallelism: 1, Tasks: []waveobj.TaskNode{tc.task},
			}); err == nil {
				t.Fatal("invalid route must be rejected")
			}
			got, err := wstore.GetRun(ctx, ch.OID, owner.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got.DagORef != "" {
				t.Fatalf("owner dagoref changed after rejected submit: %q", got.DagORef)
			}
			if spawned != 0 {
				t.Fatalf("rejected submit spawned %d workers", spawned)
			}
			runningAfter, err := wstore.GetDagsByStatus(ctx, orchestrate.DagStatus_Running)
			if err != nil {
				t.Fatal(err)
			}
			if len(runningAfter) != len(runningBefore) {
				t.Fatalf("running dag count changed from %d to %d", len(runningBefore), len(runningAfter))
			}
		})
	}
}

func TestDagSubmitAcceptsPinnedAndInheritedRoutes(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "dag-route-valid", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	owner.Runtime = "claude"
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	oldValidate := validateHarness
	validateHarness = func(runtime string, op harness.Operation) (harness.Spec, error) {
		spec, ok := harness.Lookup(runtime)
		if !ok {
			return harness.Spec{}, fmt.Errorf("unknown harness %q", runtime)
		}
		return spec, nil
	}
	t.Cleanup(func() { validateHarness = oldValidate })
	oldSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(ctx context.Context, cap runroute.Capability, workspaceId, projectName, cwd, prompt string, _ jarvis.RunWorkerOptions) (string, error) {
		tabId := uuid.NewString()
		blockId := uuid.NewString()
		tab := &waveobj.Tab{OID: tabId, BlockIds: []string{blockId}}
		_ = wstore.DBInsert(ctx, tab)
		block := &waveobj.Block{OID: blockId, ParentORef: "tab:" + tabId}
		_ = wstore.DBInsert(ctx, block)
		return "tab:" + tabId, nil
	}
	t.Cleanup(func() { jarvis.SpawnRunWorker = oldSpawn })

	owner.Status = jarvis.RunStatus_Planning
	if err := wstore.UpdateRun(ctx, ch.OID, owner.ID, func(r *waveobj.Run) error { r.Status = jarvis.RunStatus_Planning; return nil }); err != nil {
		t.Fatal(err)
	}
	g, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{
		ChannelId: ch.OID, RunId: owner.ID, Title: "g", Parallelism: 1,
		Tasks: []waveobj.TaskNode{
			{ID: "pinned", Label: "pinned", RunSpec: waveobj.RunSpec{Runtime: "pi", Model: "opencode/deepseek-v4-pro"}},
			{ID: "runtime-only", Label: "runtime-only", RunSpec: waveobj.RunSpec{Runtime: "pi"}},
			{ID: "model-only", Label: "model-only", RunSpec: waveobj.RunSpec{Model: "sonnet"}},
			{ID: "inherited", Label: "inherited"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if g.OID == "" {
		t.Fatal("valid submit must persist a dag")
	}
}

func seedDagActionEscalation(t *testing.T) (context.Context, *waveobj.Channel, waveobj.Run, waveobj.TaskGroup, waveobj.Run) {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "dag-escalation", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	owner.Status = jarvis.RunStatus_Executing
	owner.Runtime = "pi"
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := orchestrate.NewTaskGroup(owner.ID, ch.OID, "escalate", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "task"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateRun(ctx, ch.OID, owner.ID, func(run *waveobj.Run) error {
		run.DagORef = g.OID
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	child := jarvis.NewRun("child", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	child.Status = jarvis.RunStatus_Blocked
	if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].State = orchestrate.TaskState_Failed
		cur.Tasks[0].RunID = child.ID
		orchestrate.RecomputeDagStatus(cur)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	restoreHarness := orchestrate.SetValidateWorkerHarnessForTest(func(string) error { return nil })
	t.Cleanup(restoreHarness)
	oldSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(ctx context.Context, _ runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		tabID := uuid.NewString()
		if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabID, Meta: waveobj.MetaMapType{}}); err != nil {
			return "", err
		}
		return waveobj.MakeORef(waveobj.OType_Tab, tabID).String(), nil
	}
	t.Cleanup(func() { jarvis.SpawnRunWorker = oldSpawn })
	return ctx, ch, owner, g, child
}

func TestDagActionRejectsEmptyEscalateTarget(t *testing.T) {
	ctx, ch, owner, g, child := seedDagActionEscalation(t)
	// the human names the model
	err := (&WshServer{}).DagActionCommand(ctx, wshrpc.CommandDagActionData{
		ChannelId: ch.OID, RunId: owner.ID, TaskId: "t-0", Action: "escalate",
	})
	if err == nil {
		t.Fatal("empty escalate target was accepted")
	}
	got, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Tasks[0].RunSpec.Runtime != "" || got.Tasks[0].RunSpec.Model != "" || got.Tasks[0].Escalations != 0 {
		t.Fatalf("rejected escalation mutated task: %+v", got.Tasks[0])
	}
	oldChild, err := wstore.GetRun(ctx, ch.OID, child.ID)
	if err != nil {
		t.Fatal(err)
	}
	if oldChild.Status != jarvis.RunStatus_Blocked {
		t.Fatalf("rejected escalation cancelled child: %q", oldChild.Status)
	}
}

func TestDagActionEscalatesToModel(t *testing.T) {
	ctx, ch, owner, g, child := seedDagActionEscalation(t)
	if err := (&WshServer{}).DagActionCommand(ctx, wshrpc.CommandDagActionData{
		ChannelId: ch.OID, RunId: owner.ID, TaskId: "t-0", Action: "escalate",
		Runtime: "claude", Model: "sonnet",
	}); err != nil {
		t.Fatal(err)
	}
	got, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Tasks[0].RunSpec.Runtime != "claude" || got.Tasks[0].RunSpec.Model != "sonnet" || got.Tasks[0].Escalations != 1 {
		t.Fatalf("rpc model escalation = %+v", got.Tasks[0])
	}
	oldChild, err := wstore.GetRun(ctx, ch.OID, child.ID)
	if err != nil {
		t.Fatal(err)
	}
	if oldChild.Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("old child status = %q, want cancelled", oldChild.Status)
	}
}

// TestDagMergeTargetsChildWorktree: merge must resolve the composite worktree key the engine
// spawned (<owner run>-<task>), not any run id — regression for O1 where wave/<leadRunId> could
// never exist and finished child work was unlandable.
func TestDagMergeTargetsChildWorktree(t *testing.T) {
	ctx := context.Background()
	projectDir := t.TempDir()
	execGit := func(args ...string) string {
		out, err := exec.Command("git", append([]string{"-C", projectDir}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	execGit("init", "-b", "main")
	execGit("config", "user.email", "t@test")
	execGit("config", "user.name", "t")
	if err := os.WriteFile(filepath.Join(projectDir, "base.txt"), []byte("base\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	execGit("add", ".")
	execGit("commit", "-m", "base")
	baseSha := execGit("rev-parse", "HEAD")

	ch, err := wstore.CreateChannel(ctx, "dag-merge", projectDir)
	if err != nil {
		t.Fatal(err)
	}
	run := jarvis.NewRun("do the thing", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	run.Status = jarvis.RunStatus_Planning
	run.BaseCommit = baseSha
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	oldSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		tabId := uuid.NewString()
		blockId := uuid.NewString()
		tab := &waveobj.Tab{OID: tabId, BlockIds: []string{blockId}}
		_ = wstore.DBInsert(ctx, tab)
		block := &waveobj.Block{OID: blockId, ParentORef: "tab:" + tabId}
		_ = wstore.DBInsert(ctx, block)
		return "tab:" + tabId, nil
	}
	t.Cleanup(func() { jarvis.SpawnRunWorker = oldSpawn })
	ws := &WshServer{}
	g, err := ws.DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{
		ChannelId: ch.OID, RunId: run.ID, Title: "t", Parallelism: 1,
		Tasks: []waveobj.TaskNode{{ID: "t-0", Label: "feature work"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	// child commits feature work in its own worktree
	key := orchestrate.TaskWorktreeKey(run.ID, "t-0")
	wtPath := filepath.Join(projectDir, ".waveterm", "worktrees", key)
	if _, err := os.Stat(wtPath); err != nil {
		t.Fatalf("expected task worktree at %s: %v", wtPath, err)
	}
	if err := os.WriteFile(filepath.Join(wtPath, "feature.txt"), []byte("feat\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	execGit2 := func(dir string, args ...string) {
		out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	execGit2(wtPath, "add", ".")
	execGit2(wtPath, "commit", "-m", "feature")

	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].State = orchestrate.TaskState_Done
		orchestrate.RecomputeDagStatus(cur)
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if err := ws.DagMergeCommand(ctx, wshrpc.CommandDagMergeData{ChannelId: ch.OID, RunId: run.ID, TaskId: "t-0"}); err != nil {
		t.Fatalf("merge: %v", err)
	}
	if _, err := os.Stat(filepath.Join(projectDir, "feature.txt")); err != nil {
		t.Fatalf("child work must land in the project tree: %v", err)
	}
	if _, err := os.Stat(wtPath); !os.IsNotExist(err) {
		t.Fatal("merged task's worktree must be removed")
	}
	child, err := wstore.GetRun(ctx, ch.OID, g.Tasks[0].RunID)
	if err != nil {
		t.Fatal(err)
	}
	if len(child.EndCommit) != 40 {
		t.Fatalf("child EndCommit must record the merge sha, got %q", child.EndCommit)
	}
	mergedDag, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatal(err)
	}
	if !mergedDag.Tasks[0].Merged {
		t.Fatal("merged task must be stamped merged so the FE stops offering merge")
	}
	// merging a task with no child run is rejected
	if err := ws.DagMergeCommand(ctx, wshrpc.CommandDagMergeData{ChannelId: ch.OID, RunId: run.ID, TaskId: "nope"}); err == nil {
		t.Fatal("unknown task must error")
	}
}

// TestDagMergeContinueFinishesBlockedMerge: after a squash conflict leaves the task blocked-merge
// (MarkBlockedMerge), the project tree carries the mid-merge state; continue must reject while
// UU/AA/DD markers remain, then commit the resolved tree, stamp the task merged, and remove the
// child worktree — regression for G4 where blocked-merge had no wired exit in the UI.
func TestDagMergeContinueFinishesBlockedMerge(t *testing.T) {
	ctx := context.Background()
	projectDir := t.TempDir()
	execGit := func(args ...string) string {
		out, err := exec.Command("git", append([]string{"-C", projectDir}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	execGit("init", "-b", "main")
	execGit("config", "user.email", "t@test")
	execGit("config", "user.name", "t")
	if err := os.WriteFile(filepath.Join(projectDir, "base.txt"), []byte("base\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	execGit("add", ".")
	execGit("commit", "-m", "base")
	baseSha := execGit("rev-parse", "HEAD")

	ch, err := wstore.CreateChannel(ctx, "dag-merge-continue", projectDir)
	if err != nil {
		t.Fatal(err)
	}
	run := jarvis.NewRun("do the thing", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	run.Status = jarvis.RunStatus_Planning
	run.BaseCommit = baseSha
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	oldSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		tabId := uuid.NewString()
		blockId := uuid.NewString()
		tab := &waveobj.Tab{OID: tabId, BlockIds: []string{blockId}}
		_ = wstore.DBInsert(ctx, tab)
		block := &waveobj.Block{OID: blockId, ParentORef: "tab:" + tabId}
		_ = wstore.DBInsert(ctx, block)
		return "tab:" + tabId, nil
	}
	t.Cleanup(func() { jarvis.SpawnRunWorker = oldSpawn })
	ws := &WshServer{}
	g, err := ws.DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{
		ChannelId: ch.OID, RunId: run.ID, Title: "t", Parallelism: 1,
		Tasks: []waveobj.TaskNode{{ID: "t-0", Label: "feature work"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	// child edits base.txt in its worktree; the project main diverges on the same file so the
	// eventual squash merge conflicts
	key := orchestrate.TaskWorktreeKey(run.ID, "t-0")
	wtPath := filepath.Join(projectDir, ".waveterm", "worktrees", key)
	if _, err := os.Stat(wtPath); err != nil {
		t.Fatalf("expected task worktree at %s: %v", wtPath, err)
	}
	execGit2 := func(dir string, args ...string) {
		out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	if err := os.WriteFile(filepath.Join(wtPath, "base.txt"), []byte("child\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	execGit2(wtPath, "add", ".")
	execGit2(wtPath, "commit", "-m", "child edit")
	if err := os.WriteFile(filepath.Join(projectDir, "base.txt"), []byte("project\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	execGit2(projectDir, "add", ".")
	execGit2(projectDir, "commit", "-m", "project edit")

	// simulate the DagMergeCommand conflict path: squash merge conflicts, task goes blocked-merge
	if _, err := exec.Command("git", "-C", projectDir, "merge", "--squash", "wave/"+key).CombinedOutput(); err == nil {
		t.Fatal("squash merge of divergent base.txt must conflict")
	}
	if err := orchestrate.MarkBlockedMerge(ctx, g.OID, g.Tasks[0].RunID); err != nil {
		t.Fatal(err)
	}

	// unresolved markers must be rejected with context
	if err := ws.DagMergeContinueCommand(ctx, wshrpc.CommandDagMergeData{ChannelId: ch.OID, RunId: run.ID, TaskId: "t-0"}); err == nil || !strings.Contains(err.Error(), "unresolved conflict") {
		t.Fatalf("continue with UU markers must error with context, got %v", err)
	}

	// resolve in the project tree, then continue completes the merge
	if err := os.WriteFile(filepath.Join(projectDir, "base.txt"), []byte("resolved\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	execGit2(projectDir, "add", "base.txt")
	if err := ws.DagMergeContinueCommand(ctx, wshrpc.CommandDagMergeData{ChannelId: ch.OID, RunId: run.ID, TaskId: "t-0"}); err != nil {
		t.Fatalf("continue after resolution: %v", err)
	}
	b, err := os.ReadFile(filepath.Join(projectDir, "base.txt"))
	if err != nil || string(b) != "resolved\n" {
		t.Fatalf("resolved state must land in the project tree, got %q err %v", b, err)
	}
	if _, err := os.Stat(wtPath); !os.IsNotExist(err) {
		t.Fatal("continued task's worktree must be removed")
	}
	mergedDag, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatal(err)
	}
	if !mergedDag.Tasks[0].Merged {
		t.Fatal("continued task must be stamped merged")
	}
	child, err := wstore.GetRun(ctx, ch.OID, mergedDag.Tasks[0].RunID)
	if err != nil {
		t.Fatal(err)
	}
	if len(child.EndCommit) != 40 {
		t.Fatalf("child EndCommit must record the merge sha, got %q", child.EndCommit)
	}

	// continue is gated on blocked-merge: an unknown task errors, a done task errors
	if err := ws.DagMergeContinueCommand(ctx, wshrpc.CommandDagMergeData{ChannelId: ch.OID, RunId: run.ID, TaskId: "nope"}); err == nil {
		t.Fatal("unknown task must error")
	}
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].Merged = false
		cur.Tasks[0].State = orchestrate.TaskState_Done
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := ws.DagMergeContinueCommand(ctx, wshrpc.CommandDagMergeData{ChannelId: ch.OID, RunId: run.ID, TaskId: "t-0"}); err == nil || !strings.Contains(err.Error(), "want blocked-merge") {
		t.Fatalf("continue on a done task must error, got %v", err)
	}
}

// TestDagMergeCleanupFailurePersistsDebt: when content integration lands but worktree removal
// fails (locked worktree), the merge handler must persist identity + debt before reporting, never
// re-integrate on a retry, and leave removal to the retry/startup sweep.
func TestDagMergeCleanupFailurePersistsDebt(t *testing.T) {
	ctx := context.Background()
	projectDir := t.TempDir()
	execGit := func(args ...string) string {
		out, err := exec.Command("git", append([]string{"-C", projectDir}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	execGit("init", "-b", "main")
	execGit("config", "user.email", "t@test")
	execGit("config", "user.name", "t")
	if err := os.WriteFile(filepath.Join(projectDir, "base.txt"), []byte("base\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	execGit("add", ".")
	execGit("commit", "-m", "base")
	baseSha := execGit("rev-parse", "HEAD")

	ch, err := wstore.CreateChannel(ctx, "dag-merge-cleanup", projectDir)
	if err != nil {
		t.Fatal(err)
	}
	run := jarvis.NewRun("do the thing", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	run.Status = jarvis.RunStatus_Planning
	run.BaseCommit = baseSha
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	oldSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		tabId := uuid.NewString()
		blockId := uuid.NewString()
		tab := &waveobj.Tab{OID: tabId, BlockIds: []string{blockId}}
		_ = wstore.DBInsert(ctx, tab)
		block := &waveobj.Block{OID: blockId, ParentORef: "tab:" + tabId}
		_ = wstore.DBInsert(ctx, block)
		return "tab:" + tabId, nil
	}
	t.Cleanup(func() { jarvis.SpawnRunWorker = oldSpawn })
	ws := &WshServer{}
	g, err := ws.DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{
		ChannelId: ch.OID, RunId: run.ID, Title: "t", Parallelism: 1,
		Tasks: []waveobj.TaskNode{{ID: "t-0", Label: "feature work"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	key := orchestrate.TaskWorktreeKey(run.ID, "t-0")
	wtPath := filepath.Join(projectDir, ".waveterm", "worktrees", key)
	if _, err := os.Stat(wtPath); err != nil {
		t.Fatalf("expected task worktree at %s: %v", wtPath, err)
	}
	if err := os.WriteFile(filepath.Join(wtPath, "feature.txt"), []byte("feat\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	execGit2 := func(dir string, args ...string) {
		out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	execGit2(wtPath, "add", ".")
	execGit2(wtPath, "commit", "-m", "feature")
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].State = orchestrate.TaskState_Done
		orchestrate.RecomputeDagStatus(cur)
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	// first attempt: content integrates, cleanup is stubbed to fail. The remover observes the
	// authoritative database boundary, not the handler's in-memory objects.
	oldRemover := orchestrate.RemoveTaskWorktree
	cleanupCalls := 0
	failCleanup := true
	persistedBeforeCleanup := true
	orchestrate.RemoveTaskWorktree = func(cleanupCtx context.Context, projectPath, worktreeKey string) error {
		cleanupCalls++
		persistedDag, dagErr := wstore.GetDag(cleanupCtx, g.OID)
		persistedChild, childErr := wstore.GetRun(cleanupCtx, ch.OID, g.Tasks[0].RunID)
		persistedBeforeCleanup = persistedBeforeCleanup && dagErr == nil && childErr == nil &&
			persistedDag.Tasks[0].Merged && persistedDag.Tasks[0].CleanupPending && len(persistedChild.EndCommit) == 40
		if failCleanup {
			return fmt.Errorf("windows dir lock: %s", strings.Repeat("x", 300))
		}
		return oldRemover(cleanupCtx, projectPath, worktreeKey)
	}
	t.Cleanup(func() { orchestrate.RemoveTaskWorktree = oldRemover })
	if err := ws.DagMergeCommand(ctx, wshrpc.CommandDagMergeData{ChannelId: ch.OID, RunId: run.ID, TaskId: "t-0"}); err == nil {
		t.Fatal("cleanup failure must surface from the merge RPC")
	}
	if _, err := os.Stat(filepath.Join(projectDir, "feature.txt")); err != nil {
		t.Fatalf("child work must land in the project tree: %v", err)
	}
	mergedDag, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatal(err)
	}
	task := mergedDag.Tasks[0]
	if !task.Merged {
		t.Fatal("merged marker must be persisted despite cleanup failure")
	}
	if task.CleanupPending {
		t.Fatal("cleanup pending must clear after the attempt")
	}
	if task.CleanupError == "" || len(task.CleanupError) > orchestrate.MaxCleanupErrorLen {
		t.Fatalf("cleanup error must be persisted and bounded, got %q", task.CleanupError)
	}
	if !persistedBeforeCleanup {
		t.Fatal("merge identity and cleanup pending must be committed before cleanup starts")
	}

	// retry: cleanup runs again, while the merged marker prevents content integration from running.
	failCleanup = false
	if err := ws.DagMergeCommand(ctx, wshrpc.CommandDagMergeData{ChannelId: ch.OID, RunId: run.ID, TaskId: "t-0"}); err != nil {
		t.Fatalf("retry merge: %v", err)
	}
	if cleanupCalls != 2 {
		t.Fatalf("cleanup calls = %d, want one initial attempt and one retry", cleanupCalls)
	}
	if regs := execGit("worktree", "list"); strings.Contains(regs, key) {
		t.Fatalf("retry must clear the worktree without re-integration: %s", regs)
	}
	if got := execGit("rev-list", "--count", "HEAD"); got != "2" {
		t.Fatalf("merge must not re-integrate on retry, want 2 commits, got %s", got)
	}
	child, err := wstore.GetRun(ctx, ch.OID, task.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if len(child.EndCommit) != 40 {
		t.Fatalf("child EndCommit must record the merge sha, got %q", child.EndCommit)
	}
	finalDag, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatal(err)
	}
	if finalDag.Tasks[0].CleanupPending || finalDag.Tasks[0].CleanupError != "" || finalDag.Status != orchestrate.DagStatus_Finalizing {
		t.Fatalf("retry must clear debt and hand the dag to the final stage: %s %+v", finalDag.Status, finalDag.Tasks[0])
	}
	// the next tick runs the final stage, which has no commands here and goes straight to its verifier
	if err := orchestrate.Schedule(ctx, g.OID); err != nil {
		t.Fatal(err)
	}
	if finalDag, err = wstore.GetDag(ctx, g.OID); err != nil || finalDag.Final == nil || finalDag.Final.VerifierRunID == "" {
		t.Fatalf("the final stage must start its verifier, got %+v (%v)", finalDag, err)
	}
	if err := orchestrate.RecordFinalVerdict(ctx, g.OID, finalDag.Final.VerifierRunID, orchestrate.ReviewVerdict_Pass, "the change does what the spec asks", ""); err != nil {
		t.Fatal(err)
	}
	if err := orchestrate.Schedule(ctx, g.OID); err != nil {
		t.Fatal(err)
	}
	if finalDag, err = wstore.GetDag(ctx, g.OID); err != nil || finalDag.Status != orchestrate.DagStatus_Done {
		t.Fatalf("the tick after the retry finishes the dag, got %+v (%v)", finalDag, err)
	}
}

func TestDagSubmitHandsOffOnlyToALead(t *testing.T) {
	ctx := context.Background()
	var handed []string
	old := postHandoff
	postHandoff = func(_ context.Context, channelId, runId string) { handed = append(handed, channelId+"/"+runId) }
	t.Cleanup(func() { postHandoff = old })
	stubRunServer(t, "pi", nil)
	ws := &WshServer{}

	ch, err := wstore.CreateChannel(ctx, "dag-handoff", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	lead := jarvis.NewRun("do the thing", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	lead.Phases[0].WorkerOrefs = []string{"tab:lead-tab"}
	if err := wstore.AppendRun(ctx, ch.OID, lead); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	submit := wshrpc.CommandDagSubmitData{
		ChannelId: ch.OID, RunId: lead.ID, Title: "t", Parallelism: 1,
		Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "one"}},
	}
	if _, err := ws.DagSubmitCommand(ctx, submit); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if _, err := ws.DagSubmitCommand(ctx, submit); err != nil {
		t.Fatalf("identical retry: %v", err)
	}
	if want := []string{ch.OID + "/" + lead.ID}; !reflect.DeepEqual(handed, want) {
		t.Fatalf("handoffs = %v, want exactly one for the lead's first submit %v", handed, want)
	}

	deferred, err := ws.CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws", Goal: "human planned", Runtime: "pi",
		Mode: jarvis.RunMode_Orchestrator, DeferStart: true,
	})
	if err != nil {
		t.Fatalf("create deferred: %v", err)
	}
	if _, err := ws.DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{
		ChannelId: ch.OID, RunId: deferred.Run.ID, Title: "g", Parallelism: 1,
		Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "one"}},
	}); err != nil {
		t.Fatalf("submit deferred: %v", err)
	}
	if len(handed) != 1 {
		t.Fatalf("a run with no lead worker gets no handoff, got %v", handed)
	}
}
