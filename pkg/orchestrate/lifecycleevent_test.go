package orchestrate

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// eventDetail decodes a run event's detail as a generic map, for the lifecycle-writer assertions.
func eventDetail(t *testing.T, events []waveobj.RunEvent, kind string) map[string]any {
	t.Helper()
	for _, ev := range events {
		if ev.Kind != kind {
			continue
		}
		var detail map[string]any
		if err := json.Unmarshal(ev.Detail, &detail); err != nil {
			t.Fatal(err)
		}
		return detail
	}
	return nil
}

func lifecycleEvents(t *testing.T, ch, runID string) []waveobj.RunEvent {
	t.Helper()
	events, err := wstore.QueryRunEvents(context.Background(), ch, runID, 50)
	if err != nil {
		t.Fatal(err)
	}
	return events
}

func TestScheduleEmitsTaskDone(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "ev-task-done", t.TempDir())
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
	old := spawnWorker
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		return waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String(), nil
	}
	defer func() { spawnWorker = old }()
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	childRunID := g.Tasks[0].RunID
	if childRunID == "" {
		t.Fatal("task must be running with a child run")
	}
	if err := wstore.UpdateRun(ctx, ch.OID, childRunID, func(r *waveobj.Run) error {
		r.Status = jarvis.RunStatus_Done
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	events := lifecycleEvents(t, ch.OID, owner.ID)
	detail := eventDetail(t, events, waveobj.RunEventKindTaskDone)
	if detail == nil {
		t.Fatalf("missing task-done event, events=%+v", events)
	}
	if detail["taskid"] != "t-0" || detail["runid"] != childRunID {
		t.Fatalf("task-done detail = %+v", detail)
	}
}

func TestTaskDoneRecordsXmasLedger(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "ev-task-done-xmas", t.TempDir())
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
	old := spawnWorker
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		return waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String(), nil
	}
	defer func() { spawnWorker = old }()
	type ledgerCall struct {
		runID, taskID string
		ts            int64
	}
	var calls []ledgerCall
	oldRecord := recordXmasTaskDone
	recordXmasTaskDone = func(_ context.Context, runID, taskID string, ts int64) error {
		calls = append(calls, ledgerCall{runID, taskID, ts})
		return nil
	}
	defer func() { recordXmasTaskDone = oldRecord }()
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if len(calls) != 0 {
		t.Fatalf("ledger written before the task finished: %+v", calls)
	}
	if err := wstore.UpdateRun(ctx, ch.OID, g.Tasks[0].RunID, func(r *waveobj.Run) error {
		r.Status = jarvis.RunStatus_Done
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	// a later tick with the task still done records nothing more
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	var doneTs int64
	for _, ev := range lifecycleEvents(t, ch.OID, owner.ID) {
		if ev.Kind == waveobj.RunEventKindTaskDone {
			doneTs = ev.Ts
		}
	}
	if doneTs == 0 {
		t.Fatal("missing task-done event")
	}
	want := []ledgerCall{{owner.ID, "t-0", doneTs}}
	if len(calls) != 1 || calls[0] != want[0] {
		t.Fatalf("ledger calls = %+v, want %+v", calls, want)
	}
}

func TestScheduleEmitsTaskFailed(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "ev-task-failed", t.TempDir())
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
	old := spawnWorker
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		return waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String(), nil
	}
	defer func() { spawnWorker = old }()
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	childRunID := g.Tasks[0].RunID
	// a blocked child run derives the task failed (DeriveTaskStates)
	if err := wstore.UpdateRun(ctx, ch.OID, childRunID, func(r *waveobj.Run) error {
		r.Status = jarvis.RunStatus_Blocked
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	events := lifecycleEvents(t, ch.OID, owner.ID)
	detail := eventDetail(t, events, waveobj.RunEventKindTaskFailed)
	if detail == nil {
		t.Fatalf("missing task-failed event, events=%+v", events)
	}
	if detail["taskid"] != "t-0" || detail["runid"] != childRunID {
		t.Fatalf("task-failed detail = %+v", detail)
	}
	if _, ok := detail["lastfailurekind"]; !ok {
		t.Fatalf("task-failed must carry lastfailurekind, detail=%+v", detail)
	}
}

func TestScheduleEmitsDagGateOpen(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "ev-gate-open", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{
		{ID: "t-0", Label: "a", Gate: true},
	}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	old := spawnWorker
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		return waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String(), nil
	}
	defer func() { spawnWorker = old }()
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	childRunID := g.Tasks[0].RunID
	if err := wstore.UpdateRun(ctx, ch.OID, childRunID, func(r *waveobj.Run) error {
		r.Status = jarvis.RunStatus_Done
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if g.Status != DagStatus_AwaitingReview {
		t.Fatalf("gate task must halt in awaiting-review, got %s", g.Status)
	}
	events := lifecycleEvents(t, ch.OID, owner.ID)
	detail := eventDetail(t, events, waveobj.RunEventKindDagGateOpen)
	if detail == nil {
		t.Fatalf("missing dag-gate-open event, events=%+v", events)
	}
	if detail["taskid"] != "t-0" {
		t.Fatalf("dag-gate-open detail = %+v", detail)
	}
}

func TestCancelEmitsDagCancelled(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "ev-dag-cancel", t.TempDir())
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
	old := spawnWorker
	spawnWorker = func(ctx context.Context, cap runroute.Capability, workspaceId, projectName, cwd, prompt string, _ jarvis.RunWorkerOptions) (string, error) {
		tabID := uuid.NewString()
		blockID := uuid.NewString()
		worker := waveobj.MakeORef(waveobj.OType_Tab, tabID).String()
		if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabID, BlockIds: []string{blockID}, Meta: waveobj.MetaMapType{}}); err != nil {
			return "", err
		}
		if err := wstore.DBInsert(ctx, &waveobj.Block{OID: blockID, ParentORef: worker, Meta: waveobj.MetaMapType{}}); err != nil {
			return "", err
		}
		return worker, nil
	}
	defer func() { spawnWorker = old }()
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if err := Cancel(ctx, g.OID); err != nil {
		t.Fatal(err)
	}
	events := lifecycleEvents(t, ch.OID, owner.ID)
	detail := eventDetail(t, events, waveobj.RunEventKindDagCancelled)
	if detail == nil {
		t.Fatalf("missing dag-cancelled event, events=%+v", events)
	}
	if _, ok := detail["source"]; !ok {
		t.Fatalf("dag-cancelled must carry the cancellation source, detail=%+v", detail)
	}
}

func TestLifecycleAppendFailureNeverFailsEngine(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "ev-append-fail", t.TempDir())
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
	oldSpawn := spawnWorker
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		return waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String(), nil
	}
	oldAppend := appendRunEvent
	appendRunEvent = func(context.Context, string, string, string, *int, any) {
		// a failing append must not fail the engine action: the seam swallows and logs upstream
	}
	defer func() {
		spawnWorker = oldSpawn
		appendRunEvent = oldAppend
	}()
	// the engine action completes with the writer failing silently (the stubbed seam never returns an
	// error, mirroring appendRunEvent's log-not-fail contract)
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
}