// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"log"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// MaxLiveWorkers caps live workers across every run. Parallelism bounds one run, and two wide runs at once
// otherwise put twice the processes and memory on one machine.
const MaxLiveWorkers = MaxParallelism

// workerPressure is the OS's memory pressure, read once per dispatch: the one reading the job queue gates each heavy
// command by, so there is no second measure of the machine here. A var so tests can stand in for it.
var workerPressure = machinePressure

// readPressure is the OS's reading behind machinePressure; a var so a test can stand in for it.
var readPressure = jobqueue.ReadPressure

// machinePressure is the OS's memory pressure, or no reading while the job queue is off (jobs:mode off, or paused):
// the person switched the wait for memory off, and the worker gate must not keep waiting on its own.
func machinePressure(ctx context.Context) jobqueue.Pressure {
	if jobqueue.Off() {
		return jobqueue.PressureUnknown
	}
	return readPressure(ctx)
}

// liveDags lists the dags whose workers count against the cap: every nonterminal one. A var so tests can
// leave out the dags other tests left in the shared store.
var liveDags = func(ctx context.Context) ([]*waveobj.TaskGroup, error) {
	var out []*waveobj.TaskGroup
	for _, status := range watchdogStatuses {
		dags, err := wstore.GetDagsByStatus(ctx, status)
		if err != nil {
			return nil, fmt.Errorf("listing %s dags: %w", status, err)
		}
		out = append(out, dags...)
	}
	return out, nil
}

// UncapWorkersForTest lifts the live-worker cap for another package's tests: their store is shared too, and the
// cap would count the dags earlier tests left live in it and the machine's memory pressure.
func UncapWorkersForTest() (restore func()) {
	oldLive, oldPressure := liveDags, workerPressure
	liveDags = func(context.Context) ([]*waveobj.TaskGroup, error) { return nil, nil }
	workerPressure = func(context.Context) jobqueue.Pressure { return jobqueue.PressureUnknown }
	return func() { liveDags, workerPressure = oldLive, oldPressure }
}

// workerClaims holds the workers each dag's dispatch has granted itself and not yet persisted: a tick spawns
// its batch under its own dag lock, so until it commits no other dag's read of the store can see them.
var workerClaims = struct {
	sync.Mutex
	byDag map[string]int
}{byDag: make(map[string]int)}

// workerLoad is what the other dags hold of the cap.
type workerLoad struct {
	live    int // workers in flight or claimed by a dispatch under way
	waiting int // dags with ready work and no dispatch under way
}

func workerLoadOf(dags []*waveobj.TaskGroup, selfID string, claims map[string]int) workerLoad {
	var l workerLoad
	for _, g := range dags {
		if g.OID == selfID {
			continue
		}
		l.live += len(busyTaskIDs(g))
		if claims[g.OID] == 0 && len(NextToSpawn(g)) > 0 {
			l.waiting++
		}
	}
	for id, n := range claims {
		if id != selfID {
			l.live += n
		}
	}
	return l
}

// memoryShort reports a pressure reading that holds new workers back. Unknown (no reading off macOS and Windows, or
// one that failed) holds nothing: the job queue still gates each heavy command a worker runs.
func memoryShort(p jobqueue.Pressure) bool {
	return p == jobqueue.PressureWarn || p == jobqueue.PressureCritical
}

// workerGrant is how many of want new workers a dag with mine in flight may start. While other dags wait, it
// refills only to its fair share: the dag whose worker just finished ticks first and would otherwise take every
// freed slot. While memory is short (memoryShort) a run starts no worker beside one of its own, so the machine
// drains before it takes on more; a run with none live still starts one, whatever other runs hold, so a machine
// short of memory for reasons outside Arc (on Windows, a commit charge past the RAM, where a dev box often sits)
// slows runs down instead of stalling them. Gating on other runs' workers starved a run for two hours on
// 2026-11-04: the run beside it always had one live, and its own dispatch, ticking first when its worker finished,
// took the freed slot each time.
func workerGrant(want, mine int, l workerLoad, pressure jobqueue.Pressure) int {
	room := MaxLiveWorkers - l.live - mine
	if l.waiting > 0 {
		room = min(room, max(1, MaxLiveWorkers/(l.waiting+1))-mine)
	}
	if memoryShort(pressure) {
		if mine > 0 {
			return 0
		}
		room = min(room, 1)
	}
	return max(0, min(want, room))
}

// claimWorkers reserves up to want new workers for g's dispatch and returns how many it got. The caller
// releases the claim with releaseWorkerClaim once the dispatch is persisted.
func claimWorkers(ctx context.Context, g *waveobj.TaskGroup, want int) int {
	if want == 0 {
		return 0
	}
	workerClaims.Lock()
	defer workerClaims.Unlock()
	dags, err := liveDags(ctx)
	if err != nil {
		// the cap is a guard for the machine, not a correctness rule: an unreadable store must not stop dispatch
		log.Printf("dag %s: worker cap skipped: %v", g.OID, err)
		dags = nil
	}
	pressure := workerPressure(ctx)
	n := workerGrant(want, len(busyTaskIDs(g)), workerLoadOf(dags, g.OID, workerClaims.byDag), pressure)
	if n < want && memoryShort(pressure) {
		log.Printf("dag %s: %d of %d ready tasks held back while the machine's memory is short", g.OID, want-n, want)
	}
	if n > 0 {
		workerClaims.byDag[g.OID] += n
	}
	return n
}

func releaseWorkerClaim(dagID string) {
	workerClaims.Lock()
	defer workerClaims.Unlock()
	delete(workerClaims.byDag, dagID)
}
