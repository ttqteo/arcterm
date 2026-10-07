// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const timingLaunchTs = 1000

func timingOwner(status string, completedTs int64) *waveobj.Run {
	return &waveobj.Run{
		OID: "run-1", ID: "run-1", ChannelOID: "ch-1", Status: status,
		CreatedTs: timingLaunchTs, CompletedTs: completedTs, Meta: waveobj.MetaMapType{},
	}
}

// timingEvent builds a lifecycle row with an explicit detail (batch, ms) the task-scoped helper cannot carry.
func timingEvent(kind string, ts int64, detail map[string]any) waveobj.RunEvent {
	detailJSON, _ := json.Marshal(detail)
	return waveobj.RunEvent{ID: uuid.NewString(), RunID: "run-1", ChannelID: "ch-1", Ts: ts, Kind: kind, Detail: detailJSON}
}

func twoTasks() []waveobj.TaskNode {
	return []waveobj.TaskNode{{ID: "t-0", Label: "a"}, {ID: "t-1", Label: "b"}}
}

func timingOf(t *testing.T, g *waveobj.TaskGroup, owner *waveobj.Run, retained []waveobj.RunEvent) *wshrpc.DagTimingDigest {
	t.Helper()
	sn := digestSnapshot(g, nil, nil, retained, digestNow)
	sn.Owner = owner
	d := BuildDigest(sn)
	if d.Timing == nil {
		t.Fatal("a digest with its owner run must carry timing")
	}
	return d.Timing
}

func wantActivities(t *testing.T, got *wshrpc.DagTimingDigest, want []wshrpc.DagTimingActivity) {
	t.Helper()
	if !reflect.DeepEqual(got.Activities, want) {
		t.Fatalf("activities:\n got %+v\nwant %+v", got.Activities, want)
	}
}

func TestDigestTimingCompletedRun(t *testing.T) {
	g := digestGroup(t, true, twoTasks())
	g.Verify = "go test ./..."
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Done})
	retained := []waveobj.RunEvent{
		retainedEvent(waveobj.RunEventKindTaskSpawned, "t-0", 2000),
		retainedEvent(waveobj.RunEventKindTaskSpawned, "t-1", 2100),
		retainedEvent(waveobj.RunEventKindTaskDone, "t-0", 3000),
		retainedEvent(waveobj.RunEventKindTaskDone, "t-1", 3500),
		retainedEvent(waveobj.RunEventKindTaskReviewStarted, "t-0", 3000),
		retainedEvent(waveobj.RunEventKindTaskReviewPassed, "t-0", 3200),
		retainedEvent(waveobj.RunEventKindTaskReviewStarted, "t-1", 3500),
		retainedEvent(waveobj.RunEventKindTaskReviewPassed, "t-1", 3800),
		retainedEvent(waveobj.RunEventKindTaskMergeStarted, "t-0", 3300),
		retainedEvent(waveobj.RunEventKindTaskMerged, "t-0", 3400),
		retainedEvent(waveobj.RunEventKindTaskVerifyPassed, "t-0", 3600),
		retainedEvent(waveobj.RunEventKindTaskMergeStarted, "t-1", 3900),
		retainedEvent(waveobj.RunEventKindTaskMerged, "t-1", 4000),
		retainedEvent(waveobj.RunEventKindTaskVerifyPassed, "t-1", 4500),
		timingEvent(waveobj.RunEventKindFinalStep, 5000, map[string]any{"round": 1, "step": FinalStep_Tree, "ms": 300, "ok": true}),
		timingEvent(waveobj.RunEventKindFinalStep, 6000, map[string]any{"round": 1, "step": FinalStep_Check, "ms": 1000, "ok": true}),
		retainedDagEvent(waveobj.RunEventKindDagDone, 7000),
	}
	tm := timingOf(t, g, timingOwner(jarvis.RunStatus_Done, 9000), retained)
	wantActivities(t, tm, []wshrpc.DagTimingActivity{
		{Key: TimingPlanning, StartTs: 1000, EndTs: 2000},
		{Key: TimingExecution, StartTs: 2000, EndTs: 3500},
		{Key: TimingReview, StartTs: 3000, EndTs: 3800},
		{Key: TimingMerge, StartTs: 3300, EndTs: 4500},
		{Key: TimingFinal, StartTs: 4700, EndTs: 7000},
		{Key: TimingLanding, StartTs: 7000, EndTs: 9000},
	})
	if tm.StartTs != timingLaunchTs || tm.EndTs != 9000 || tm.Partial {
		t.Fatalf("got start %d end %d partial %v, want 1000, 9000, false", tm.StartTs, tm.EndTs, tm.Partial)
	}
}

func TestDigestTimingLiveRun(t *testing.T) {
	g := digestGroup(t, true, twoTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Reviewing, "t-1": TaskState_Running})
	retained := []waveobj.RunEvent{
		retainedEvent(waveobj.RunEventKindTaskSpawned, "t-0", 2000),
		retainedEvent(waveobj.RunEventKindTaskSpawned, "t-1", 2100),
		retainedEvent(waveobj.RunEventKindTaskDone, "t-0", 3000),
		retainedEvent(waveobj.RunEventKindTaskReviewStarted, "t-0", 3000),
	}
	tm := timingOf(t, g, timingOwner(jarvis.RunStatus_Executing, 0), retained)
	wantActivities(t, tm, []wshrpc.DagTimingActivity{
		{Key: TimingPlanning, StartTs: 1000, EndTs: 2000},
		{Key: TimingExecution, StartTs: 2000},
		{Key: TimingReview, StartTs: 3000},
	})
	if tm.EndTs != 0 {
		t.Fatalf("a live run has no end, got %d", tm.EndTs)
	}
}

func TestDigestTimingPlanningOnly(t *testing.T) {
	g := digestGroup(t, true, twoTasks())
	tm := timingOf(t, g, timingOwner(jarvis.RunStatus_Executing, 0), nil)
	wantActivities(t, tm, []wshrpc.DagTimingActivity{{Key: TimingPlanning, StartTs: 1000}})
}

func TestDigestTimingNoOwner(t *testing.T) {
	g := digestGroup(t, true, twoTasks())
	if d := BuildDigest(digestSnapshot(g, nil, nil, nil, digestNow)); d.Timing != nil {
		t.Fatalf("no owner run must leave timing nil, got %+v", d.Timing)
	}
}

func TestDigestTimingRetriedTask(t *testing.T) {
	g := digestGroup(t, true, twoTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Running})
	retained := []waveobj.RunEvent{
		retainedEvent(waveobj.RunEventKindTaskSpawned, "t-0", 2000),
		retainedEvent(waveobj.RunEventKindTaskFailed, "t-0", 2500),
		retainedEvent(waveobj.RunEventKindTaskSpawned, "t-0", 2600),
	}
	tm := timingOf(t, g, timingOwner(jarvis.RunStatus_Executing, 0), retained)
	wantActivities(t, tm, []wshrpc.DagTimingActivity{
		{Key: TimingPlanning, StartTs: 1000, EndTs: 2000},
		{Key: TimingExecution, StartTs: 2000},
	})
}

// mergedTwoTips is two finished tasks whose lanes were squash-merged, t-0 first.
func mergedTwoTips() []waveobj.RunEvent {
	return []waveobj.RunEvent{
		retainedEvent(waveobj.RunEventKindTaskSpawned, "t-0", 2000),
		retainedEvent(waveobj.RunEventKindTaskSpawned, "t-1", 2000),
		retainedEvent(waveobj.RunEventKindTaskDone, "t-0", 3000),
		retainedEvent(waveobj.RunEventKindTaskDone, "t-1", 3100),
		retainedEvent(waveobj.RunEventKindTaskMergeStarted, "t-0", 4000),
		retainedEvent(waveobj.RunEventKindTaskMerged, "t-0", 4100),
		retainedEvent(waveobj.RunEventKindTaskMergeStarted, "t-1", 4200),
		retainedEvent(waveobj.RunEventKindTaskMerged, "t-1", 4300),
	}
}

func timingActivity(tm *wshrpc.DagTimingDigest, key string) *wshrpc.DagTimingActivity {
	for i := range tm.Activities {
		if tm.Activities[i].Key == key {
			return &tm.Activities[i]
		}
	}
	return nil
}

func TestDigestTimingBatchVerify(t *testing.T) {
	g := digestGroup(t, true, twoTasks())
	g.Verify = "go test ./..."
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Done})
	retained := append(mergedTwoTips(),
		timingEvent(waveobj.RunEventKindTaskVerifyPassed, 5000, map[string]any{"taskid": "t-0", "ms": 700, "batch": []string{"t-0", "t-1"}}))
	tm := timingOf(t, g, timingOwner(jarvis.RunStatus_Executing, 0), retained)
	if m := timingActivity(tm, TimingMerge); m == nil || *m != (wshrpc.DagTimingActivity{Key: TimingMerge, StartTs: 4000, EndTs: 5000}) {
		t.Fatalf("one Verify over the batch must close the merge at its ts, got %+v", m)
	}
}

func TestDigestTimingVerifyPending(t *testing.T) {
	g := digestGroup(t, true, twoTasks())
	g.Verify = "go test ./..."
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Verifying})
	retained := append(mergedTwoTips(), retainedEvent(waveobj.RunEventKindTaskVerifyPassed, "t-0", 4150))
	tm := timingOf(t, g, timingOwner(jarvis.RunStatus_Executing, 0), retained)
	if m := timingActivity(tm, TimingMerge); m == nil || *m != (wshrpc.DagTimingActivity{Key: TimingMerge, StartTs: 4000}) {
		t.Fatalf("a merged tip whose Verify has not reported keeps the merge open, got %+v", m)
	}
}

func TestDigestTimingLastMergeLeavesVerifyToTheFinalStage(t *testing.T) {
	g := digestGroup(t, true, twoTasks())
	g.Verify = "go test ./..."
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Done})
	retained := append(mergedTwoTips()[:7],
		retainedEvent(waveobj.RunEventKindTaskVerifyPassed, "t-0", 4150),
		timingEvent(waveobj.RunEventKindTaskMerged, 4300, map[string]any{"taskid": "t-1", "verify": mergeVerifyFinal}))
	tm := timingOf(t, g, timingOwner(jarvis.RunStatus_Executing, 0), retained)
	if m := timingActivity(tm, TimingMerge); m == nil || *m != (wshrpc.DagTimingActivity{Key: TimingMerge, StartTs: 4000, EndTs: 4300}) {
		t.Fatalf("a merge that left its Verify to the final stage closes at task-merged, got %+v", m)
	}
}

func TestDigestTimingNoVerifyLine(t *testing.T) {
	g := digestGroup(t, true, twoTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Done})
	tm := timingOf(t, g, timingOwner(jarvis.RunStatus_Executing, 0), mergedTwoTips())
	if m := timingActivity(tm, TimingMerge); m == nil || *m != (wshrpc.DagTimingActivity{Key: TimingMerge, StartTs: 4000, EndTs: 4300}) {
		t.Fatalf("with no Verify line the merge must close at the last task-merged, got %+v", m)
	}
}

func TestDigestTimingFinalLiveStep(t *testing.T) {
	g := digestGroup(t, true, twoTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done, "t-1": TaskState_Done})
	g.Final = &waveobj.FinalStage{State: FinalState_Checking, Round: 1, Step: FinalStep_Tree, StepTs: 6000}
	tm := timingOf(t, g, timingOwner(jarvis.RunStatus_Executing, 0), mergedTwoTips())
	if f := timingActivity(tm, TimingFinal); f == nil || *f != (wshrpc.DagTimingActivity{Key: TimingFinal, StartTs: 6000}) {
		t.Fatalf("a running first step opens the final stage at its start, got %+v", f)
	}
	if timingActivity(tm, TimingLanding) != nil {
		t.Fatal("landing must not start before dag-done")
	}
}

func TestDigestTimingCancelledRun(t *testing.T) {
	g := digestGroup(t, true, twoTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Cancelled})
	retained := []waveobj.RunEvent{
		retainedEvent(waveobj.RunEventKindTaskSpawned, "t-0", 2000),
		retainedDagEvent(waveobj.RunEventKindDagCancelled, 4000),
	}
	tm := timingOf(t, g, timingOwner(jarvis.RunStatus_Cancelled, 0), retained)
	wantActivities(t, tm, []wshrpc.DagTimingActivity{
		{Key: TimingPlanning, StartTs: 1000, EndTs: 2000},
		{Key: TimingExecution, StartTs: 2000, EndTs: 4000},
	})
	if tm.EndTs != 4000 {
		t.Fatalf("a cancelled run ends at dag-cancelled, got %d", tm.EndTs)
	}
}

func TestDigestTimingFailedNoEnd(t *testing.T) {
	g := digestGroup(t, true, twoTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Reviewing})
	retained := []waveobj.RunEvent{
		retainedEvent(waveobj.RunEventKindTaskSpawned, "t-0", 2000),
		retainedEvent(waveobj.RunEventKindTaskDone, "t-0", 2400),
		retainedEvent(waveobj.RunEventKindTaskReviewStarted, "t-0", 2500),
	}
	tm := timingOf(t, g, timingOwner(runStatusFailed, 0), retained)
	if tm.EndTs != 2500 {
		t.Fatalf("a failed run with no end row ends at its latest retained row, got %d", tm.EndTs)
	}
	wantActivities(t, tm, []wshrpc.DagTimingActivity{
		{Key: TimingPlanning, StartTs: 1000, EndTs: 2000},
		{Key: TimingExecution, StartTs: 2000, EndTs: 2400},
		{Key: TimingReview, StartTs: 2500, EndTs: 2500},
	})
}

func TestDigestTimingPruned(t *testing.T) {
	g := digestGroup(t, true, twoTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Done})
	retained := []waveobj.RunEvent{retainedEvent(waveobj.RunEventKindTaskDone, "t-0", 3000)}
	tm := timingOf(t, g, timingOwner(jarvis.RunStatus_Executing, 0), retained)
	if !tm.Partial {
		t.Fatal("a task-done with no retained spawn must mark the timing partial")
	}
	for _, a := range tm.Activities {
		if a.EndTs != 0 && a.EndTs < a.StartTs {
			t.Fatalf("negative interval %+v", a)
		}
	}
}

func TestDigestTimingDispatchFailureNotPruned(t *testing.T) {
	g := digestGroup(t, true, twoTasks())
	setTaskStates(g, map[string]string{"t-0": TaskState_Failed})
	retained := []waveobj.RunEvent{retainedEvent(waveobj.RunEventKindTaskFailed, "t-0", 1500)}
	tm := timingOf(t, g, timingOwner(jarvis.RunStatus_Executing, 0), retained)
	if tm.Partial {
		t.Fatal("a task that failed to dispatch never spawned; nothing was pruned")
	}
	wantActivities(t, tm, []wshrpc.DagTimingActivity{{Key: TimingPlanning, StartTs: 1000}})
}
