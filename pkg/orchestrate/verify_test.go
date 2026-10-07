// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const verifyCmd = "task test"

// stillOpen is a task a test leaves unfinished. The last merge of a dag leaves its Verify to the final stage, so
// a test of a merge's own Verify needs a task still to land.
var stillOpen = waveobj.TaskNode{ID: "t-9", Label: "still open"}

// awaitVerify returns a func that blocks until one more Verify run has recorded its result and ticked
// its dag.
func awaitVerify(t *testing.T) func() {
	t.Helper()
	done := make(chan struct{}, 16)
	orig := verifyFinished
	verifyFinished = func(string, string) { done <- struct{}{} }
	restoreAfterStages(t, func() { verifyFinished = orig })
	return func() {
		t.Helper()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Fatal("verify did not finish")
		}
	}
}

// blockingVerify is a Verify that reports each start and passes only once released, or fails when its
// context is cancelled. A test that fails before releasing leaves it blocked, holding only its own
// temporary project.
type blockingVerify struct {
	started chan struct{}
	release chan struct{}
}

func stubBlockingVerify(t *testing.T) (*blockingVerify, *planCalls) {
	t.Helper()
	b := &blockingVerify{started: make(chan struct{}, 16), release: make(chan struct{})}
	calls := stubPlanCommand(t, func(ctx context.Context, _, _ string) error {
		b.started <- struct{}{}
		select {
		case <-b.release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	})
	return b, calls
}

func (b *blockingVerify) open() { close(b.release) }

func (b *blockingVerify) waitStarted(t *testing.T) {
	t.Helper()
	select {
	case <-b.started:
	case <-time.After(10 * time.Second):
		t.Fatal("verify did not start")
	}
}

func (f *mergeFixture) projectPath(t *testing.T) string {
	t.Helper()
	owner, err := wstore.GetRun(f.ctx, f.channel, f.ownerID)
	if err != nil {
		t.Fatal(err)
	}
	return owner.ProjectPath
}

func landedSha(context.Context, string, string, string) (string, error) { return "sha-1", nil }

func TestADependentStartsAtItsDependencysMergeNotItsVerify(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "first"},
		{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
		// a second dependent makes t-0 a lane of its own, so it merges before either starts
		{ID: "t-2", Label: "third", Deps: []string{"t-0"}},
	})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	verify, calls := stubBlockingVerify(t)
	var spawned []string
	stubSpawn(t, &spawned)
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	verify.waitStarted(t)
	g := f.dag(t)
	if g.Tasks[0].State != TaskState_Verifying || !g.Tasks[0].Merged {
		t.Fatalf("a merged task waits on Verify, got %s merged=%v", g.Tasks[0].State, g.Tasks[0].Merged)
	}
	if g.Tasks[1].State != TaskState_Running || g.Tasks[2].State != TaskState_Running || len(spawned) != 2 {
		t.Fatalf("both dependents start at the merge, while Verify runs, got %s / %s with %d spawns", g.Tasks[1].State, g.Tasks[2].State, len(spawned))
	}
	verify.open()
	await()

	g = f.dag(t)
	if g.Tasks[0].State != TaskState_Done || g.Tasks[0].VerifyError != "" {
		t.Fatalf("a passing Verify leaves the task done, got %s %q", g.Tasks[0].State, g.Tasks[0].VerifyError)
	}
	if got := calls.list(); len(got) != 1 || got[0].dir != f.projectPath(t) || got[0].command != verifyCmd {
		t.Fatalf("want Verify once in the project checkout, got %+v", got)
	}
}

func TestVerifyFailureBlocksTheDagAndWakesTheLead(t *testing.T) {
	lead := newFakeLead(t)
	f := newMergeFixture(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "first"},
		{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
		// a second dependent makes t-0 a lane of its own, so it merges before either starts
		{ID: "t-2", Label: "third", Deps: []string{"t-0"}},
	})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	stubPlanCommand(t, func(context.Context, string, string) error {
		return &planCommandError{exitCode: 1, output: "FAIL pkg/orchestrate"}
	})
	var spawned []string
	stubSpawn(t, &spawned)
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()

	g := f.dag(t)
	if task := g.Tasks[0]; task.State != TaskState_VerifyFailed || task.VerifyError != "exit 1: FAIL pkg/orchestrate" {
		t.Fatalf("want verify-failed with the reason and output, got %s %q", task.State, task.VerifyError)
	}
	if g.Status != DagStatus_Blocked || g.Tasks[1].State != TaskState_Running || len(spawned) != 2 {
		t.Fatalf("a failed Verify blocks the dag; the dependents started at the merge, got %s / %s / %d spawns", g.Status, g.Tasks[1].State, len(spawned))
	}
	want := "wake: Verify failed after merging task t-0 (exit 1). wsh jarvis dag status"
	if len(lead.sends) != 1 || lead.sends[0] != want {
		t.Fatalf("want %q, got %q", want, lead.sends)
	}
}

// a dependent that started at its dependency's merge lands only once that dependency's Verify passed
func TestAFailedVerifyHoldsTheDependentsMergeNotItsStart(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "first"},
		{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "third", Deps: []string{"t-0"}},
	})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	merges := stubMerge(t, landedSha)
	stubPlanCommand(t, func(context.Context, string, string) error {
		return &planCommandError{exitCode: 1, output: "FAIL pkg/orchestrate"}
	})
	var spawned []string
	stubSpawn(t, &spawned)
	await := awaitVerify(t)
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()

	f.finish(t, "t-1")
	AutoMergeReady(f.ctx, f.dagID)
	if g := f.dag(t); *merges != 1 || g.Tasks[1].Merged {
		t.Fatalf("t-1 must not merge while t-0's Verify is failed, got %d merges, merged=%v", *merges, g.Tasks[1].Merged)
	}
}

// the lead's `dag merge` holds a dependent too, but still lands a lane that depends on nothing failing
func TestAManualMergeWaitsOnItsDependencysFailedVerify(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "first"},
		{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "third", Deps: []string{"t-0"}},
		{ID: "t-3", Label: "fourth"},
	})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	merges := stubMerge(t, landedSha)
	calls := 0
	stubPlanCommand(t, func(context.Context, string, string) error {
		calls++
		if calls == 1 {
			return &planCommandError{exitCode: 1, output: "FAIL pkg/orchestrate"}
		}
		return nil
	})
	var spawned []string
	stubSpawn(t, &spawned)
	await := awaitVerify(t)
	if err := MergeTask(f.ctx, f.channel, f.ownerID, "t-0"); err != nil {
		t.Fatal(err)
	}
	await()

	f.finish(t, "t-1")
	if err := MergeTask(f.ctx, f.channel, f.ownerID, "t-1"); err == nil || !strings.Contains(err.Error(), "t-0") {
		t.Fatalf("a dependent's merge names its failed dependency, got %v", err)
	}
	if *merges != 1 {
		t.Fatalf("t-1 must not merge, got %d merges", *merges)
	}
	f.finish(t, "t-3")
	if err := MergeTask(f.ctx, f.channel, f.ownerID, "t-3"); err != nil {
		t.Fatalf("an independent lane still merges by hand, got %v", err)
	}
	await()
	if *merges != 2 {
		t.Fatalf("want t-3 merged, got %d merges", *merges)
	}
}

func TestRecordVerifyKeepsTheOutputOnPass(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "first"},
		{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "third", Deps: []string{"t-0"}},
	})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	stubPlanCommandOutput(t, func(context.Context, string, string) (string, error) { return "ok pkg/orchestrate", nil })
	var spawned []string
	stubSpawn(t, &spawned)
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()

	if task := f.dag(t).Tasks[0]; task.State != TaskState_Done || task.VerifyOutput != "ok pkg/orchestrate" {
		t.Fatalf("a passing Verify keeps its output, got %s %q", task.State, task.VerifyOutput)
	}
}

func TestRecordVerifyKeepsTheOutputOnFailure(t *testing.T) {
	newFakeLead(t)
	f := newMergeFixture(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "first"},
		{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "third", Deps: []string{"t-0"}},
	})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	stubPlanCommandOutput(t, func(context.Context, string, string) (string, error) {
		return "FAIL pkg/orchestrate", &planCommandError{exitCode: 1, output: "FAIL pkg/orchestrate"}
	})
	var spawned []string
	stubSpawn(t, &spawned)
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()

	if task := f.dag(t).Tasks[0]; task.State != TaskState_VerifyFailed || task.VerifyOutput != "FAIL pkg/orchestrate" {
		t.Fatalf("a failed Verify keeps its output, got %s %q", task.State, task.VerifyOutput)
	}
}

func TestVerifyStartedTsIsStamped(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "first"},
		{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "third", Deps: []string{"t-0"}},
	})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	verify, _ := stubBlockingVerify(t)
	var spawned []string
	stubSpawn(t, &spawned)
	await := awaitVerify(t)

	before := time.Now().UnixMilli()
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	verify.waitStarted(t)
	if ts := f.dag(t).Tasks[0].VerifyStartedTs; ts < before || ts > time.Now().UnixMilli() {
		t.Fatalf("a verifying task carries when its Verify started, got %d (before %d)", ts, before)
	}
	verify.open()
	await()
}

func TestVerifyTimeoutIsAFailure(t *testing.T) {
	lead := newFakeLead(t)
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, stillOpen})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	stubPlanCommand(t, func(context.Context, string, string) error {
		return &planCommandError{exitCode: -1, timeout: VerifyTimeout}
	})
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()

	if got := f.dag(t).Tasks[0].State; got != TaskState_VerifyFailed {
		t.Fatalf("a Verify past its timeout fails the task, got %s", got)
	}
	want := "wake: Verify failed after merging task t-0 (timed out after 20m). wsh jarvis dag status"
	if len(lead.sends) != 1 || lead.sends[0] != want {
		t.Fatalf("want %q, got %q", want, lead.sends)
	}
}

// failingOutput is a failing command's kept output as acceptance 2 saw it: tool noise first, the cause last.
func failingOutput() string {
	return strings.Repeat("task: [generate] no changes to frontend/types/gotypes.d.ts\n", 16) +
		"'CGO_CFLAGS' is not recognized as an internal or external command"
}

// assertDetailKeepsCause checks a failure event raised by failingOutput. The timeline row is what a human
// reads, so it must carry the reason and the end of the output, where the cause is.
func assertDetailKeepsCause(t *testing.T, lead *fakeLead, kind string) {
	t.Helper()
	for _, row := range lead.rows {
		if row["eventkind"] != kind {
			continue
		}
		msg, _ := row["detail"].(string)
		if !strings.HasPrefix(msg, "exit 1: ") || !strings.HasSuffix(msg, "is not recognized as an internal or external command") ||
			len(msg) > MaxFailureDetailLen {
			t.Fatalf("want the reason and the output's end within %d bytes, got %q", MaxFailureDetailLen, msg)
		}
		return
	}
	t.Fatalf("no %s event", kind)
}

func TestVerifyFailedEventKeepsTheCause(t *testing.T) {
	lead := newFakeLead(t)
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, stillOpen})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	stubPlanCommand(t, func(context.Context, string, string) error {
		return &planCommandError{exitCode: 1, output: failingOutput()}
	})
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()

	assertDetailKeepsCause(t, lead, waveobj.RunEventKindTaskVerifyFailed)
}

func TestNextMergeWaitsForRunningVerify(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, {ID: "t-1", Label: "second"}, stillOpen})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	merges := stubMerge(t, landedSha)
	verify, _ := stubBlockingVerify(t)
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	verify.waitStarted(t)
	// t-1 finishes while t-0's Verify runs, so it is not in t-0's batch
	f.finish(t, "t-1")
	// a watchdog tick while t-0's Verify runs
	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if *merges != 1 {
		t.Fatalf("a merge must wait for the running Verify, got %d merges", *merges)
	}
	verify.open()
	await() // t-0's Verify; its tick lands t-1
	await() // t-1's Verify

	g := f.dag(t)
	if *merges != 2 || g.Tasks[0].State != TaskState_Done || g.Tasks[1].State != TaskState_Done {
		t.Fatalf("both tasks land and verify in turn, got %d merges, %s, %s", *merges, g.Tasks[0].State, g.Tasks[1].State)
	}
}

func TestVerifyDoesNotHoldTheDagLock(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, stillOpen})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	verify, _ := stubBlockingVerify(t)
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	verify.waitStarted(t)
	locked := make(chan struct{})
	go func() {
		_ = WithDagMutation(f.dagID, func() error { return nil })
		close(locked)
	}()
	select {
	case <-locked:
	case <-time.After(5 * time.Second):
		t.Fatal("a tick must get the dag lock while Verify runs")
	}
	verify.open()
	await()
}

func TestTickRestartsAVerifyTheServerLost(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	// what a restart leaves: merged and persisted verifying, with no Verify running
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].State, cur.Tasks[0].Merged = TaskState_Verifying, true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	calls := stubPlanCommand(t, func(context.Context, string, string) error { return nil })
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()

	if n := len(calls.list()); n != 1 {
		t.Fatalf("the tick restarts the lost Verify once, got %d runs", n)
	}
	if got := f.dag(t).Tasks[0].State; got != TaskState_Done {
		t.Fatalf("the restarted Verify records its pass, got %s", got)
	}
}

func TestMergeWithoutVerifyLineIsDone(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	calls := stubPlanCommand(t, func(context.Context, string, string) error { return nil })

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	task := f.dag(t).Tasks[0]
	if !task.Merged || task.State != TaskState_Done || len(calls.list()) != 0 {
		t.Fatalf("no Verify line: the merge is the end, got merged=%v %s with %d runs", task.Merged, task.State, len(calls.list()))
	}
}

func TestCancelStopsARunningVerify(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, stillOpen})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	verify, _ := stubBlockingVerify(t)
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	verify.waitStarted(t)
	if err := Cancel(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await() // returns only if cancel stopped the blocked Verify

	g := f.dag(t)
	if g.Status != DagStatus_Cancelled || g.Tasks[0].State != TaskState_Verifying {
		t.Fatalf("a cancelled dag records no Verify result, got %s / %s", g.Status, g.Tasks[0].State)
	}
}

func TestManualMergeRefusesWhileVerifyRuns(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, {ID: "t-1", Label: "second"}, stillOpen})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	verify, _ := stubBlockingVerify(t)
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	verify.waitStarted(t)
	f.finish(t, "t-1")
	err := MergeTask(f.ctx, f.channel, f.ownerID, "t-1")
	if !errors.Is(err, errProjectBusy) || !strings.Contains(err.Error(), "task t-0") {
		t.Fatalf("a merge while t-0's Verify runs must say who holds the checkout, got %v", err)
	}
	verify.open()
	await() // t-0's Verify; its tick lands t-1
	await() // t-1's Verify
}

// effortFor stores an effort holding one pending chunk per label and points the fixture's dag at it.
func (f *mergeFixture) effortFor(t *testing.T, labels ...string) string {
	t.Helper()
	e := &waveobj.Effort{Title: "tracker"}
	for _, label := range labels {
		e.Chunks = append(e.Chunks, waveobj.EffortChunk{Label: label, Status: "pending"})
	}
	if err := effortstore.Create(f.ctx, e); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.EffortOID = e.OID
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return e.OID
}

func chunkOf(t *testing.T, ctx context.Context, effortOID, label string) waveobj.EffortChunk {
	t.Helper()
	e, err := effortstore.Get(ctx, effortOID)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range e.Chunks {
		if c.Label == label {
			return c
		}
	}
	t.Fatalf("effort has no chunk %q", label)
	return waveobj.EffortChunk{}
}

func (f *mergeFixture) taskChunks(t *testing.T, taskID string, chunks ...string) {
	t.Helper()
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		taskByID(cur, taskID).Chunks = chunks
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyPassClosesTheTasksChunks(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "first"},
		{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "third", Deps: []string{"t-0"}},
	})
	f.setPlanCommands(t, verifyCmd, "")
	effort := f.effortFor(t, "#8 mine", "#6 also mine", "#12 someone else's")
	f.taskChunks(t, "t-0", "#8 mine", "#6 also mine")
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	stubPlanCommand(t, func(context.Context, string, string) error { return nil })
	var spawned []string
	stubSpawn(t, &spawned)
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()

	g := f.dag(t)
	for _, label := range []string{"#8 mine", "#6 also mine"} {
		c := chunkOf(t, f.ctx, effort, label)
		if c.Status != "done" {
			t.Fatalf("chunk %q must be done once its task's merge passed Verify, got %q", label, c.Status)
		}
		want := "landed sha-1 (run " + g.RunID + ", task t-0)"
		if len(c.Notes) == 0 || !strings.Contains(c.Notes[len(c.Notes)-1].Text, want) {
			t.Fatalf("chunk %q wants a note with %q, got %+v", label, want, c.Notes)
		}
	}
	if c := chunkOf(t, f.ctx, effort, "#12 someone else's"); c.Status != "pending" {
		t.Fatalf("a chunk no landed task names stays pending, got %q", c.Status)
	}
}

func TestVerifyPassClosesEveryTaskInALane(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "first"},
		{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
		stillOpen,
	})
	f.setPlanCommands(t, verifyCmd, "")
	effort := f.effortFor(t, "head chunk", "tip chunk")
	f.taskChunks(t, "t-0", "head chunk")
	f.taskChunks(t, "t-1", "tip chunk")
	f.finish(t, "t-0")
	f.finish(t, "t-1")
	stubMerge(t, landedSha)
	stubPlanCommand(t, func(context.Context, string, string) error { return nil })
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()

	for label, task := range map[string]string{"head chunk": "t-0", "tip chunk": "t-1"} {
		c := chunkOf(t, f.ctx, effort, label)
		if c.Status != "done" || !strings.Contains(c.Notes[len(c.Notes)-1].Text, "task "+task+")") {
			t.Fatalf("a lane lands as one merge and closes each task's chunks, chunk %q = %q %+v", label, c.Status, c.Notes)
		}
	}
}

func TestVerifyFailLeavesChunksOpen(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "first"},
		{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "third", Deps: []string{"t-0"}},
	})
	f.setPlanCommands(t, verifyCmd, "")
	effort := f.effortFor(t, "#8 mine")
	f.taskChunks(t, "t-0", "#8 mine")
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	stubPlanCommand(t, func(context.Context, string, string) error {
		return &planCommandError{exitCode: 1, output: "FAIL"}
	})
	newFakeLead(t)
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()

	if c := chunkOf(t, f.ctx, effort, "#8 mine"); c.Status != "pending" || len(c.Notes) != 0 {
		t.Fatalf("a failed Verify closes nothing, got %q %+v", c.Status, c.Notes)
	}
}

func TestChunkCloseFailureDoesNotFailTheVerify(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "first"},
		{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "third", Deps: []string{"t-0"}},
	})
	f.setPlanCommands(t, verifyCmd, "")
	effort := f.effortFor(t, "#8 exists")
	// the first label went missing from the effort after submit; the second still closes
	f.taskChunks(t, "t-0", "#0 renamed away", "#8 exists")
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	stubPlanCommand(t, func(context.Context, string, string) error { return nil })
	var spawned []string
	stubSpawn(t, &spawned)
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	await()

	if g := f.dag(t); g.Tasks[0].State != TaskState_Done || g.Tasks[0].VerifyError != "" {
		t.Fatalf("an effort that cannot close a chunk must not fail the Verify, got %s %q", g.Tasks[0].State, g.Tasks[0].VerifyError)
	}
	if c := chunkOf(t, f.ctx, effort, "#8 exists"); c.Status != "done" {
		t.Fatalf("one unresolvable chunk must not stop the others, got %q", c.Status)
	}
}

func TestVerifyOutputIsReadableWhileItRuns(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{
		{ID: "t-0", Label: "first"},
		{ID: "t-1", Label: "second", Deps: []string{"t-0"}},
		{ID: "t-2", Label: "third", Deps: []string{"t-0"}},
	})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	published, release := make(chan struct{}), make(chan struct{})
	stubPlanCommandProgress(t, func(_ context.Context, _, _ string, progress planProgress) (string, error) {
		// the sink declines while the dag is busy elsewhere, exactly as it does in the engine
		for !progress("running pkg/one\nrunning pkg/two") {
			time.Sleep(5 * time.Millisecond)
		}
		close(published)
		<-release
		return "ok pkg/two", nil
	})
	var spawned []string
	stubSpawn(t, &spawned)
	await := awaitVerify(t)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	<-published

	if task := f.dag(t).Tasks[0]; task.State != TaskState_Verifying || task.VerifyOutput != "running pkg/one\nrunning pkg/two" {
		t.Fatalf("a running Verify's output must be readable before it exits, got %s %q", task.State, task.VerifyOutput)
	}
	close(release)
	await()

	if task := f.dag(t).Tasks[0]; task.State != TaskState_Done || task.VerifyOutput != "ok pkg/two" {
		t.Fatalf("the recorded result replaces the progress tail, got %s %q", task.State, task.VerifyOutput)
	}
}

func TestVerifyProgressNeverOverwritesARecordedResult(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].State, cur.Tasks[0].VerifyOutput = TaskState_Done, "ok pkg/two"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// a publish still in flight when the result was recorded: it must take nothing
	if err := WithDagMutation(f.dagID, func() error {
		return recordVerifyProgressLocked(f.ctx, f.dagID, []string{"t-0"}, "running pkg/one")
	}); err != nil {
		t.Fatal(err)
	}
	if task := f.dag(t).Tasks[0]; task.State != TaskState_Done || task.VerifyOutput != "ok pkg/two" {
		t.Fatalf("a late publish must not overwrite the final output, got %s %q", task.State, task.VerifyOutput)
	}
}
