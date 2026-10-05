// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// Two concurrent spawnRunWorkers calls for one run must spawn its running phase exactly once.
// Before the per-run lock both callers read empty WorkerOrefs and both spawn (this fails);
// with the lock the second caller sees the attached oref and skips.
func TestSpawnRunWorkers_ConcurrentSpawnsOnce(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "spawn-race", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	run := jarvis.NewRun("do X", "ws-id", "/repo", nil, jarvis.RunMode_Pipeline, storedPipelinePhases(), 1)
	run.Runtime = "pi"
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	stubHarnessInstalled(t, "pi")

	var calls int32
	var spawnedWith runroute.Capability
	origSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(_ context.Context, cap runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		spawnedWith = cap
		atomic.AddInt32(&calls, 1)
		time.Sleep(30 * time.Millisecond) // widen the read->spawn->attach window so a truly-concurrent second caller overlaps
		return waveobj.MakeORef(waveobj.OType_Tab, "faketab").String(), nil
	}
	defer func() { jarvis.SpawnRunWorker = origSpawn }()

	var wg sync.WaitGroup
	wg.Add(2)
	for i := 0; i < 2; i++ {
		go func() {
			defer wg.Done()
			if err := spawnRunWorkers(ctx, ch.OID, run.ID, ch.Name); err != nil {
				t.Errorf("spawnRunWorkers: %v", err)
			}
		}()
	}
	wg.Wait()

	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("SpawnRunWorker calls = %d, want exactly 1", got)
	}
	if spawnedWith.Runtime != "pi" {
		t.Fatalf("worker spawned with capability %+v, want pi", spawnedWith)
	}
	out, err := wstore.GetRun(ctx, ch.OID, run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if n := len(out.Phases[0].WorkerOrefs); n != 1 {
		t.Fatalf("phase 0 WorkerOrefs = %d, want 1", n)
	}
}

// A run's worker is launched under a session id the run records, so the sealed evidence reads that worker's
// own transcript. Without one the seal took the newest Claude transcript in the project directory, and
// acceptance 2's pi lead was summarised from another run's session.
func TestSpawnRunWorkers_RecordsTheWorkersSessionId(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "spawn-session", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	run := jarvis.NewRun("ship it", "ws-id", "/repo", nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	run.Runtime = "pi"
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	stubHarnessInstalled(t, "pi")
	var launchedWith string
	origSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(_ context.Context, _ runroute.Capability, _, _, _, _ string, opts jarvis.RunWorkerOptions) (string, error) {
		launchedWith = opts.SessionId
		return waveobj.MakeORef(waveobj.OType_Tab, "leadtab").String(), nil
	}
	defer func() { jarvis.SpawnRunWorker = origSpawn }()

	if err := spawnRunWorkers(ctx, ch.OID, run.ID, ch.Name); err != nil {
		t.Fatalf("spawnRunWorkers: %v", err)
	}

	out, err := wstore.GetRun(ctx, ch.OID, run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if launchedWith == "" || out.SessionId != launchedWith {
		t.Fatalf("launched with session %q, run records %q; want one id in both", launchedWith, out.SessionId)
	}
}

// A relaunched lead replaces the run's session id, but the dead lead's session spent tokens on the run too, so
// every session the run's lead was launched under stays recorded.
func TestSpawnRunWorkers_RecordsEveryLeadSession(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "spawn-relaunch", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	run := jarvis.NewRun("ship it", "ws-id", "/repo", nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	run.Runtime = "pi"
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("AppendRun: %v", err)
	}
	stubHarnessInstalled(t, "pi")
	var launched []string
	origSpawn := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(_ context.Context, _ runroute.Capability, _, _, _, _ string, opts jarvis.RunWorkerOptions) (string, error) {
		launched = append(launched, opts.SessionId)
		return waveobj.MakeORef(waveobj.OType_Tab, "leadtab").String(), nil
	}
	defer func() { jarvis.SpawnRunWorker = origSpawn }()

	for i := 0; i < 2; i++ {
		if err := spawnRunWorkers(ctx, ch.OID, run.ID, ch.Name); err != nil {
			t.Fatalf("spawnRunWorkers: %v", err)
		}
		// what a relaunch does first: drop the dead lead's tab so the phase spawns again
		if err := wstore.UpdateRun(ctx, ch.OID, run.ID, func(r *waveobj.Run) error {
			for j := range r.Phases {
				r.Phases[j].WorkerOrefs = nil
			}
			return nil
		}); err != nil {
			t.Fatalf("UpdateRun: %v", err)
		}
	}

	out, err := wstore.GetRun(ctx, ch.OID, run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if len(launched) != 2 || !slices.Equal(out.LeadSessionIds, launched) || out.SessionId != launched[1] {
		t.Fatalf("launched %q; run records sessions %q and last %q", launched, out.LeadSessionIds, out.SessionId)
	}
}
