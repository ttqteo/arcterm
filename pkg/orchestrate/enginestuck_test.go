// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// setWatchdogBounds shortens the watchdog's waits for one test.
func setWatchdogBounds(t *testing.T, wait, tick, verify time.Duration) {
	t.Helper()
	oldWait, oldTick, oldVerify := tickWait, tickOverdue, verifyOverdue
	tickWait, tickOverdue, verifyOverdue = wait, tick, verify
	restoreAfterStages(t, func() { tickWait, tickOverdue, verifyOverdue = oldWait, oldTick, oldVerify })
}

// engineStuckWakes are the stuck wakes among what the lead was sent: the watchdog also ticks dags other tests
// left in the store, and those wake the same scripted lead.
func engineStuckWakes(lead *fakeLead) []string {
	var wakes []string
	for _, text := range lead.sends {
		if strings.HasPrefix(text, "wake: the engine is stuck") {
			wakes = append(wakes, text)
		}
	}
	return wakes
}

func engineStuckRows(lead *fakeLead) []map[string]any {
	var rows []map[string]any
	for _, row := range lead.rows {
		if row["eventkind"] == waveobj.RunEventKindEngineStuck {
			rows = append(rows, row)
		}
	}
	return rows
}

// waitOnlyStage waits until name is the only background stage left: the watchdog also ticks dags other
// tests left in the store, and one of those still running would read as stuck too.
func waitOnlyStage(t *testing.T, name string) {
	t.Helper()
	deadline := time.Now().Add(stageLeakTimeout)
	for !slices.Equal(runningStages(), []string{name}) {
		if time.Now().After(deadline) {
			t.Fatalf("want only %q still running, got %v", name, runningStages())
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// Run c3d06b56: one dag's tick never finished, and the watchdog loop waited on it, so no other dag was
// ticked and no lead was woken for the 27 minutes until the app was restarted.
func TestWatchdogMovesOnFromATickThatNeverFinishes(t *testing.T) {
	lead := newFakeLead(t)
	stuck := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "stuck"}})
	other := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "other"}})
	var spawned []string
	stubSpawn(t, &spawned)
	setWatchdogBounds(t, 200*time.Millisecond, time.Hour, time.Hour)

	// a holder of the dag's lock that no context ends
	held, release := make(chan struct{}), make(chan struct{})
	go func() {
		_ = WithDagMutation(stuck.dagID, func() error {
			close(held)
			<-release
			return nil
		})
	}()
	<-held
	defer close(release)

	tick := func() {
		t.Helper()
		returned := make(chan struct{})
		go func() {
			watchdogTick(stuck.ctx)
			close(returned)
		}()
		select {
		case <-returned:
		case <-time.After(10 * time.Second):
			t.Fatal("the watchdog must not wait on a dag whose tick never finishes")
		}
	}
	tick()
	// the other dag's tick makes a worktree, which can outlast the shortened wait
	waitOnlyStage(t, "tick "+stuck.dagID)
	if state := other.dag(t).Tasks[0].State; state != TaskState_Running {
		t.Fatalf("the other dag must still be ticked, got %s", state)
	}
	if rows := engineStuckRows(lead); len(rows) != 0 {
		t.Fatalf("a tick inside its bound is not reported, got %v", rows)
	}

	tickOverdue = 0
	tick()
	// with no bound, a tick the shortened wait moved on from would read as stuck on the next pass
	waitOnlyStage(t, "tick "+stuck.dagID)
	tick()
	rows := engineStuckRows(lead)
	if len(rows) != 1 {
		t.Fatalf("a tick past its bound is recorded once, got %v", rows)
	}
	if wakes := engineStuckWakes(lead); len(wakes) != 1 {
		t.Fatalf("the lead is woken once, got %q", lead.sends)
	}
}

// A Verify whose goroutine never records a result holds its project claim, so every later merge waits on it.
func TestAVerifyPastItsBoundIsReportedOnce(t *testing.T) {
	lead := newFakeLead(t)
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}, stillOpen})
	f.setPlanCommands(t, verifyCmd, "")
	f.finish(t, "t-0")
	stubMerge(t, landedSha)
	verify, _ := stubBlockingVerify(t)
	await := awaitVerify(t)
	setWatchdogBounds(t, 5*time.Second, time.Hour, time.Hour)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	verify.waitStarted(t)
	watchdogTick(f.ctx)
	if rows := engineStuckRows(lead); len(rows) != 0 {
		t.Fatalf("a Verify inside its bound is not reported, got %v", rows)
	}

	verifyOverdue = 0
	watchdogTick(f.ctx)
	watchdogTick(f.ctx)
	rows := engineStuckRows(lead)
	if len(rows) != 1 || rows[0]["taskid"] != "t-0" {
		t.Fatalf("a Verify past its bound is recorded once, on its task, got %v", rows)
	}
	if wakes := engineStuckWakes(lead); len(wakes) != 1 || !strings.Contains(wakes[0], "task t-0") {
		t.Fatalf("the lead is woken once, got %q", lead.sends)
	}
	if state := f.dag(t).Tasks[0].State; state != TaskState_Verifying {
		t.Fatalf("the report changes no state: the Verify still owns the checkout, got %s", state)
	}
	verify.open()
	await()
}

// A git child that leaves a descendant holding its output pipe never closes it, and without a wait delay
// neither the command's exit nor its context returns the call.
func TestGitReturnsWhenADescendantKeepsItsOutputOpen(t *testing.T) {
	old := gitWaitDelay
	gitWaitDelay = 200 * time.Millisecond
	defer func() { gitWaitDelay = old }()
	dir := newGitRepo(t)

	done := make(chan error, 1)
	go func() {
		// out of the repo first, so the sleeper does not hold the test's temp dir open
		_, err := git(context.Background(), dir, "-c", "alias.linger=!cd / && sleep 15 &", "linger")
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("the command exited 0, got %v", err)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("git must return once its own process has exited")
	}
}
