// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const suspectWakePrefix = "wake: task t-0 may be stuck"

// seedSuspectChild is a running pi child that wrote a minute ago, whose tree has been at fp since unchangedFor ago.
// The stored ProgressHash equals the stub's answer, so the first check sees an unchanged tree, not a fresh one.
func seedSuspectChild(t *testing.T, name string, unchangedFor time.Duration) (context.Context, *waveobj.TaskGroup, *fakeLead, *string) {
	t.Helper()
	ctx, g, f := seedChildWrittenAt(t, name, time.Now().Add(-time.Minute))
	fp := stubProgress(t, "fp-1")
	stubChildCPU(t, func(call int) (int64, bool) { return int64(call) * 5000, true }) // busy
	seedProgress(t, ctx, g, "fp-1", time.Now().Add(-unchangedFor).UnixMilli())
	return ctx, g, f, fp
}

// stubProgress scripts the fingerprint probe to answer *fp and lifts both throttles.
func stubProgress(t *testing.T, initial string) *string {
	t.Helper()
	fp := initial
	prevFP, prevEvery, prevCPU := progressFingerprint, progressCheckEvery, cpuSampleEvery
	progressFingerprint = func(context.Context, string) (string, error) { return fp, nil }
	progressCheckEvery, cpuSampleEvery = 0, 0
	t.Cleanup(func() { progressFingerprint, progressCheckEvery, cpuSampleEvery = prevFP, prevEvery, prevCPU })
	return &fp
}

func seedProgress(t *testing.T, ctx context.Context, g *waveobj.TaskGroup, hash string, ts int64) {
	t.Helper()
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].ProgressHash, cur.Tasks[0].ProgressTs = hash, ts
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	fresh, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatal(err)
	}
	*g = *fresh
}

func stubLatestTool(t *testing.T, tool string) {
	t.Helper()
	prev := workerLatestTool
	workerLatestTool = func(context.Context, *waveobj.Run) string { return tool }
	t.Cleanup(func() { workerLatestTool = prev })
}

// suspectWakes counts the stuck wakes the lead was typed, and lets it take them, so a later wake is typed instead of held.
func suspectWakes(ctx context.Context, f *fakeLead) int {
	n := 0
	for _, s := range f.sends {
		if strings.HasPrefix(s, suspectWakePrefix) {
			n++
		}
	}
	f.settle(ctx)
	return n
}

// appendPiFailures appends n identical failures of command to the child's own transcript.
func appendPiFailures(t *testing.T, ctx context.Context, g *waveobj.TaskGroup, command, idPrefix string, n int) {
	t.Helper()
	run, err := wstore.GetRun(ctx, g.ChannelId, g.Tasks[0].RunID)
	if err != nil {
		t.Fatal(err)
	}
	path, _, _ := transcriptForRun(run)
	if path == "" {
		t.Fatal("the child has no transcript")
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	for i := 0; i < n; i++ {
		id := fmt.Sprint(idPrefix, i)
		fmt.Fprintln(file, piCall(id, command))
		fmt.Fprintln(file, piResult(id, command+": 1 failed", true))
	}
}

// A 20+ min suite with no edits crosses the threshold while busy: it wakes the lead once, and the reason says what
// the worker is running, so the lead can tell a slow test from a loop.
func TestSuspectStagnantActiveWorkerWakesOnce(t *testing.T) {
	ctx, g, f, _ := seedSuspectChild(t, "suspect-stagnant", 21*time.Minute)
	stubLatestTool(t, "running go test ./...")

	task := tick(t, ctx, g)
	if task.SuspectTs == 0 || !strings.Contains(task.SuspectReason, "worktree unchanged 21m") ||
		!strings.Contains(task.SuspectReason, "now: running go test ./...") {
		t.Fatalf("a stagnant active worker is flagged with what it runs, got ts %d reason %q", task.SuspectTs, task.SuspectReason)
	}
	if n := f.countKind(waveobj.RunEventKindTaskSuspect); n != 1 {
		t.Fatalf("want one task-suspect row, got %d", n)
	}
	if n := suspectWakes(ctx, f); n != 1 {
		t.Fatalf("want one stuck wake, got %d in %q", n, f.sends)
	}
	f.sends = nil
	tick(t, ctx, g)
	if n := f.countKind(waveobj.RunEventKindTaskSuspect); n != 1 {
		t.Fatalf("one stuck stretch is one row, got %d", n)
	}
	if n := suspectWakes(ctx, f); n != 0 {
		t.Fatalf("one stuck stretch is one wake, got %q", f.sends)
	}
}

func TestSuspectRearmsOnATreeChange(t *testing.T) {
	ctx, g, f, fp := seedSuspectChild(t, "suspect-rearm", 21*time.Minute)
	if task := tick(t, ctx, g); task.SuspectTs == 0 {
		t.Fatal("setup: the task should be flagged")
	}
	suspectWakes(ctx, f)
	f.sends = nil
	*fp = "fp-2"
	before := time.Now().UnixMilli()
	task := tick(t, ctx, g)
	if task.SuspectTs != 0 || task.SuspectReason != "" {
		t.Fatalf("a tree change re-arms the flag, got ts %d reason %q", task.SuspectTs, task.SuspectReason)
	}
	if task.ProgressHash != "fp-2" || task.ProgressTs < before {
		t.Fatalf("a tree change is progress now, got hash %q ts %d", task.ProgressHash, task.ProgressTs)
	}
	if n := suspectWakes(ctx, f); n != 0 {
		t.Fatalf("a re-arm wakes nobody, got %q", f.sends)
	}
}

func TestSuspectCheckIsThrottled(t *testing.T) {
	ctx, g, _, fp := seedSuspectChild(t, "suspect-throttle", 21*time.Minute)
	checked := tick(t, ctx, g).ProgressCheckTs
	if checked == 0 {
		t.Fatal("setup: the first tick should check")
	}
	progressCheckEvery = time.Hour
	*fp = "fp-2"
	task := tick(t, ctx, g)
	if task.ProgressHash != "fp-1" || task.ProgressCheckTs != checked {
		t.Fatalf("inside progressCheckEvery the probe does not run, got hash %q check %d (was %d)", task.ProgressHash, task.ProgressCheckTs, checked)
	}
}

func TestSuspectQuietWorkerIsNotFlagged(t *testing.T) {
	ctx, g, f := seedChildWrittenAt(t, "suspect-quiet", time.Now().Add(-10*time.Minute))
	stubProgress(t, "fp-1")
	stubChildCPU(t, func(int) (int64, bool) { return 1000, true }) // flat
	seedProgress(t, ctx, g, "fp-1", time.Now().Add(-21*time.Minute).UnixMilli())
	tick(t, ctx, g)
	if task := tick(t, ctx, g); task.SuspectTs != 0 {
		t.Fatalf("a quiet worker is the stall path's, got reason %q", task.SuspectReason)
	}
	if n := f.countKind(waveobj.RunEventKindTaskSuspect); n != 0 {
		t.Fatalf("want no task-suspect row, got %d", n)
	}
}

func TestSuspectWorkerOnAnAskIsNotFlagged(t *testing.T) {
	ctx, g, f, _ := seedSuspectChild(t, "suspect-ask", 21*time.Minute)
	agentask.GlobalRegistry.Set("block:worker-block", agentask.PendingAsk{AskId: "a", BlockId: "worker-block"})
	if task := tick(t, ctx, g); task.SuspectTs != 0 {
		t.Fatalf("a worker waiting on an ask is the question queue's, got reason %q", task.SuspectReason)
	}
	if n := f.countKind(waveobj.RunEventKindTaskSuspect); n != 0 {
		t.Fatalf("want no task-suspect row, got %d", n)
	}
}

// The wait on an ask is not stagnation: a worker answered after a long wait gets a whole threshold from then on.
func TestSuspectWorkerResumingFromAnAskIsNotFlagged(t *testing.T) {
	ctx, g, f, _ := seedSuspectChild(t, "suspect-ask-resume", 21*time.Minute)
	oref := "block:worker-block"
	agentask.GlobalRegistry.Set(oref, agentask.PendingAsk{AskId: "a", BlockId: "worker-block"})
	t.Cleanup(func() { agentask.GlobalRegistry.Drop(oref) })
	before := time.Now().UnixMilli()
	if task := tick(t, ctx, g); task.ProgressTs < before {
		t.Fatalf("a check that finds a pending ask re-arms the clock, got ts %d (before %d)", task.ProgressTs, before)
	}
	agentask.GlobalRegistry.Drop(oref)
	if task := tick(t, ctx, g); task.SuspectTs != 0 {
		t.Fatalf("a worker just answered is not stagnant, got reason %q", task.SuspectReason)
	}
	if n := f.countKind(waveobj.RunEventKindTaskSuspect); n != 0 {
		t.Fatalf("want no task-suspect row, got %d", n)
	}
}

// A tree git cannot read (deleted, mid-rebase, locked index) neither flags nor re-arms, and does not fail the tick.
func TestSuspectProbeErrorSkipsTheCheck(t *testing.T) {
	ctx, g, _, _ := seedSuspectChild(t, "suspect-probe-error", 21*time.Minute)
	progressFingerprint = func(context.Context, string) (string, error) { return "", errors.New("not a git repository") }
	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatalf("a probe error must not fail the tick: %v", err)
	}
	if task := g.Tasks[0]; task.SuspectTs != 0 || task.ProgressHash != "fp-1" {
		t.Fatalf("a probe error leaves the progress alone, got ts %d hash %q", task.SuspectTs, task.ProgressHash)
	}
}

func TestSuspectRepeatedFailureWakesOncePerKey(t *testing.T) {
	ctx, g, f, fp := seedSuspectChild(t, "suspect-repeat", 0)
	appendPiFailures(t, ctx, g, "go test ./pkg/x", "a", 3)
	task := tick(t, ctx, g)
	if !strings.Contains(task.SuspectReason, "`go test ./pkg/x` failed the same way 3x") || len(task.FlaggedFailures) != 1 {
		t.Fatalf("a repeated failure flags, got reason %q keys %d", task.SuspectReason, len(task.FlaggedFailures))
	}
	if n := suspectWakes(ctx, f); n != 1 {
		t.Fatalf("want one stuck wake, got %q", f.sends)
	}
	f.sends = nil
	*fp = "fp-2"
	tick(t, ctx, g)
	if n := suspectWakes(ctx, f); n != 0 {
		t.Fatalf("failures that already woke the lead, still in the tail, wake nothing, got %q", f.sends)
	}
	appendPiFailures(t, ctx, g, "go vet ./pkg/x", "b", 3)
	task = tick(t, ctx, g)
	if n := suspectWakes(ctx, f); n != 1 || !strings.Contains(f.sends[0], "go vet ./pkg/x") {
		t.Fatalf("a new failure key wakes again, naming it, got %q", f.sends)
	}
	if len(task.FlaggedFailures) != 2 {
		t.Fatalf("both keys are recorded, got %d", len(task.FlaggedFailures))
	}
}

// A worker that edits and then fails the same way each time is caught: the scan runs whether or not the tree changed.
func TestSuspectEditsBetweenIdenticalFailures(t *testing.T) {
	ctx, g, f, fp := seedSuspectChild(t, "suspect-edits", 0)
	for i := 1; i <= 3; i++ {
		*fp = fmt.Sprint("fp-edit-", i)
		appendPiFailures(t, ctx, g, "go test ./pkg/x", fmt.Sprint("e", i, "-"), 1)
		task := tick(t, ctx, g)
		if flagged := task.SuspectTs != 0; flagged != (i == 3) {
			t.Fatalf("tick %d: flagged %v, reason %q", i, flagged, task.SuspectReason)
		}
	}
	if n := suspectWakes(ctx, f); n != 1 {
		t.Fatalf("want one stuck wake, got %q", f.sends)
	}
}

// A runtime liveness cannot read still gets the stagnation check; its activity is the busy CPU sample alone.
func TestSuspectUntrackedRuntimeIsCheckedForStagnation(t *testing.T) {
	ctx, g, f, _ := seedSuspectChild(t, "suspect-untracked", 21*time.Minute)
	if err := wstore.UpdateRun(ctx, g.ChannelId, g.Tasks[0].RunID, func(run *waveobj.Run) error {
		run.Runtime = "opencode"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].LastActivity = 0
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if task := tick(t, ctx, g); task.SuspectTs != 0 {
		t.Fatalf("a first CPU reading is only a baseline, not activity, got reason %q", task.SuspectReason)
	}
	task := tick(t, ctx, g)
	if task.SuspectTs == 0 || !strings.Contains(task.SuspectReason, "worktree unchanged 21m") {
		t.Fatalf("a busy untracked worker with a still tree is flagged, got reason %q", task.SuspectReason)
	}
	if n := suspectWakes(ctx, f); n != 1 {
		t.Fatalf("want one stuck wake, got %q", f.sends)
	}
}

func TestSuspectRetryStartsClean(t *testing.T) {
	g := &waveobj.TaskGroup{Tasks: []waveobj.TaskNode{{
		ID: "t-0", ProgressHash: "fp", ProgressTs: 1, ProgressCheckTs: 9, SuspectTs: 9, SuspectReason: "x", FlaggedFailures: []string{"k"},
	}}}
	before := time.Now().UnixMilli()
	if err := MarkRunning(g, "t-0", "run-2"); err != nil {
		t.Fatal(err)
	}
	n := g.Tasks[0]
	if n.ProgressHash != "" || n.ProgressCheckTs != 0 || n.SuspectTs != 0 || n.SuspectReason != "" || n.FlaggedFailures != nil {
		t.Fatalf("a new attempt carries nothing from the last, got %+v", n)
	}
	if n.ProgressTs < before {
		t.Fatalf("ProgressTs is seeded at spawn, got %d", n.ProgressTs)
	}
}
