// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type planCall struct {
	dir, command string
	env          []string
}

// envValue is the value env gives key, or "".
func envValue(env []string, key string) string {
	for _, kv := range env {
		if k, v, ok := strings.Cut(kv, "="); ok && k == key {
			return v
		}
	}
	return ""
}

// planCalls records the Setup and Verify commands the engine ran. Verify runs on its own goroutine, so
// reads go through list.
type planCalls struct {
	mu    sync.Mutex
	calls []planCall
}

func (p *planCalls) list() []planCall {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]planCall(nil), p.calls...)
}

// in lists the calls run in dir. Once every task lands the final stage runs the plan's Verify again in its own
// tree, and a test that waited on the merge's removal can see it.
func (p *planCalls) in(dir string) []planCall {
	var out []planCall
	for _, c := range p.list() {
		if filepath.Clean(c.dir) == filepath.Clean(dir) {
			out = append(out, c)
		}
	}
	return out
}

func stubPlanCommand(t *testing.T, fn func(ctx context.Context, dir, command string) error) *planCalls {
	t.Helper()
	return stubPlanCommandOutput(t, func(ctx context.Context, dir, command string) (string, error) {
		return "", fn(ctx, dir, command)
	})
}

// stubPlanCommandOutput is stubPlanCommand for a test that also scripts the output tail.
func stubPlanCommandOutput(t *testing.T, fn func(ctx context.Context, dir, command string) (string, error)) *planCalls {
	t.Helper()
	return stubPlanCommandProgress(t, func(ctx context.Context, dir, command string, _ planProgress) (string, error) {
		return fn(ctx, dir, command)
	})
}

// stubPlanCommandProgress is stubPlanCommandOutput for a test that scripts what the command publishes
// WHILE it runs, which is how a live Verify's output reaches the cockpit before it exits.
func stubPlanCommandProgress(t *testing.T, fn func(ctx context.Context, dir, command string, progress planProgress) (string, error)) *planCalls {
	t.Helper()
	p := &planCalls{}
	orig := runPlanCommand
	runPlanCommand = func(ctx context.Context, dir, command string, env []string, _ time.Duration, progress planProgress) (string, error) {
		p.mu.Lock()
		p.calls = append(p.calls, planCall{dir, command, env})
		p.mu.Unlock()
		return fn(ctx, dir, command, progress)
	}
	restoreAfterStages(t, func() { runPlanCommand = orig })
	return p
}

// setPlanCommands gives the fixture's dag the plan-level commands a plan file would.
func (f *mergeFixture) setPlanCommands(t *testing.T, verify, setup string) {
	t.Helper()
	if err := wstore.UpdateDag(f.ctx, f.dagID, func(cur *waveobj.TaskGroup) error {
		cur.Verify, cur.Setup = verify, setup
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

const setupCmd = "task worktree:prepare"

func TestDispatchRunsSetupInTheNewWorktreeBeforeTheWorker(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	var spawned []string
	spawnedAtSetup := -1
	calls := stubPlanCommand(t, func(context.Context, string, string) error {
		spawnedAtSetup = len(spawned)
		return nil
	})
	stubSpawn(t, &spawned)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	wt := worktreeDir(f.project, TaskWorktreeKey(f.ownerID, "t-0"))
	if got := calls.list(); len(got) != 1 || got[0].dir != wt || got[0].command != setupCmd {
		t.Fatalf("want Setup once in %s, got %+v", wt, got)
	}
	if spawnedAtSetup != 0 || len(spawned) != 1 {
		t.Fatalf("Setup runs before the worker spawns: spawns at setup %d, after %d", spawnedAtSetup, len(spawned))
	}
}

func TestSetupFailureFailsTheTaskDropsItsWorktreeAndWakesTheLead(t *testing.T) {
	lead := newFakeLead(t)
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	stubPlanCommand(t, func(context.Context, string, string) error {
		return &planCommandError{exitCode: 1, output: "task: not found"}
	})
	var spawned []string
	stubSpawn(t, &spawned)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	task := f.dag(t).Tasks[0]
	if task.State != TaskState_Failed || task.LastFailureKind != FailureKindSetup {
		t.Fatalf("want failed (setup), got %s (%s)", task.State, task.LastFailureKind)
	}
	if len(spawned) != 0 {
		t.Fatalf("no worker spawns into an unprepared tree, got %d", len(spawned))
	}
	if _, err := os.Stat(worktreeDir(f.project, TaskWorktreeKey(f.ownerID, "t-0"))); !os.IsNotExist(err) {
		t.Fatalf("a half-prepared tree must go, so a retry sets up a new one; stat err = %v", err)
	}
	want := "wake: task t-0 failed (setup), retry spent. wsh jarvis dag status"
	if len(lead.sends) != 1 || lead.sends[0] != want {
		t.Fatalf("want %q, got %q", want, lead.sends)
	}
}

func TestSetupFailedEventKeepsTheCause(t *testing.T) {
	lead := newFakeLead(t)
	timedEventsReachTheFakeLead(t)
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	f.setPlanCommands(t, "", setupCmd)
	stubPlanCommand(t, func(context.Context, string, string) error {
		return &planCommandError{exitCode: 1, output: failingOutput()}
	})
	stubSpawn(t, new([]string))

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}

	assertDetailKeepsCause(t, lead, waveobj.RunEventKindTaskFailed)
}

func TestNoSetupLineRunsNothing(t *testing.T) {
	f := newMergeFixture(t, []waveobj.TaskNode{{ID: "t-0", Label: "first"}})
	calls := stubPlanCommand(t, func(context.Context, string, string) error { return nil })
	var spawned []string
	stubSpawn(t, &spawned)

	if err := Schedule(f.ctx, f.dagID); err != nil {
		t.Fatal(err)
	}
	if got := calls.list(); len(got) != 0 {
		t.Fatalf("a plan without Setup runs no command, got %+v", got)
	}
}
