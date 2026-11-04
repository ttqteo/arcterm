// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestWorkerGrant(t *testing.T) {
	cases := []struct {
		name       string
		want, mine int
		load       workerLoad
		pressure   jobqueue.Pressure
		grant      int
	}{
		{"an idle machine grants all it asks", 3, 0, workerLoad{}, jobqueue.PressureNormal, 3},
		{"other runs' workers count against the cap", 4, 1, workerLoad{live: 6}, jobqueue.PressureNormal, 1},
		{"a full cap grants nothing", 2, 0, workerLoad{live: MaxLiveWorkers}, jobqueue.PressureNormal, 0},
		{"a waiting run holds this one to its share", 4, 3, workerLoad{live: 3, waiting: 1}, jobqueue.PressureNormal, 1},
		{"at its share a run leaves the free slots to the waiting one", 2, 4, workerLoad{live: 2, waiting: 1}, jobqueue.PressureNormal, 0},
		{"two waiting runs cut the share to a third", 8, 1, workerLoad{live: 3, waiting: 2}, jobqueue.PressureNormal, 1},
		{"a share is never under one worker", 2, 0, workerLoad{live: 1, waiting: 20}, jobqueue.PressureNormal, 1},
		{"no reading from the OS holds nothing", 3, 1, workerLoad{live: 1}, jobqueue.PressureUnknown, 3},
		{"a normal reading holds nothing", 3, 1, workerLoad{live: 1}, jobqueue.PressureNormal, 3},
		{"a warn reading holds new workers while the run's own are live", 3, 1, workerLoad{}, jobqueue.PressureWarn, 0},
		{"a critical reading holds new workers while the run's own are live", 3, 1, workerLoad{}, jobqueue.PressureCritical, 0},
		{"another run's live worker does not starve a run with none under warn", 3, 0, workerLoad{live: 1}, jobqueue.PressureWarn, 1},
		{"another run's live worker does not starve a run with none under critical", 3, 0, workerLoad{live: 2, waiting: 1}, jobqueue.PressureCritical, 1},
		{"a full cap still grants nothing under pressure", 3, 0, workerLoad{live: MaxLiveWorkers}, jobqueue.PressureWarn, 0},
		{"warn with nothing live anywhere still starts one worker", 3, 0, workerLoad{}, jobqueue.PressureWarn, 1},
		{"critical with nothing live anywhere still starts one worker", 3, 0, workerLoad{}, jobqueue.PressureCritical, 1},
		{"the one worker never exceeds what was asked", 1, 0, workerLoad{}, jobqueue.PressureWarn, 1},
		{"nothing asked grants nothing, whatever the pressure", 0, 0, workerLoad{}, jobqueue.PressureCritical, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := workerGrant(c.want, c.mine, c.load, c.pressure); got != c.grant {
				t.Fatalf("workerGrant(%d, %d, %+v, %v) = %d, want %d", c.want, c.mine, c.load, c.pressure, got, c.grant)
			}
		})
	}
}

// slotDag is a dag of n independent tasks, the first running of them live.
func slotDag(t *testing.T, id string, n, running int) *waveobj.TaskGroup {
	t.Helper()
	var tasks []waveobj.TaskNode
	for i := range n {
		tasks = append(tasks, waveobj.TaskNode{ID: fmt.Sprintf("t-%d", i), Label: "task"})
	}
	g, err := NewTaskGroup("run-"+id, "ch-"+id, id, MaxParallelism, false, tasks, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	g.OID = id
	for i := range running {
		g.Tasks[i].State = TaskState_Running
	}
	return &g
}

func TestWorkerLoadOf(t *testing.T) {
	dags := []*waveobj.TaskGroup{
		slotDag(t, "self", 3, 1),
		slotDag(t, "waiting", 3, 2),     // one ready task left
		slotDag(t, "full", 2, 2),        // nothing ready
		slotDag(t, "dispatching", 3, 0), // ready, but its claim is already spawning it
	}
	got := workerLoadOf(dags, "self", map[string]int{"self": 2, "dispatching": 2})
	want := workerLoad{live: 6, waiting: 1}
	if got != want {
		t.Fatalf("got %+v, want %+v: self is left out, a dispatching dag counts its claim and does not wait", got, want)
	}
}

// a reviewing task is a process of its own, so the cap still counts it though its run's slot is free
func TestWorkerLoadOfCountsAReviewingTask(t *testing.T) {
	reviewing := slotDag(t, "reviewing", 2, 0)
	reviewing.Tasks[0].State = TaskState_Reviewing
	got := workerLoadOf([]*waveobj.TaskGroup{reviewing}, "self", nil)
	if got.live != 1 {
		t.Fatalf("a task under review is one live process, got %+v", got)
	}
}

// workerSlotsFixture is a dag of n independent ready tasks of width parallelism, with every spawn counted. It
// returns the dag and the number of workers started so far.
func workerSlotsFixture(t *testing.T, name string, n, parallelism int) (context.Context, *waveobj.TaskGroup, *int) {
	t.Helper()
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, name, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	var tasks []waveobj.TaskNode
	for i := range n {
		tasks = append(tasks, waveobj.TaskNode{ID: fmt.Sprintf("t-%d", i), Label: "task"})
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", parallelism, false, tasks, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	spawns := 0
	old := spawnWorker
	spawnWorker = func(context.Context, runroute.Capability, string, string, string, string, jarvis.RunWorkerOptions) (string, error) {
		spawns++
		return fmt.Sprintf("tab:worker-%d", spawns), nil
	}
	restoreAfterStages(t, func() { spawnWorker = old })
	return ctx, &g, &spawns
}

// standInMachine replaces what the cap reads of the machine: the dags other runs hold, and the OS's memory pressure.
func standInMachine(t *testing.T, others *[]*waveobj.TaskGroup, pressure *jobqueue.Pressure) {
	t.Helper()
	oldLive, oldPressure := liveDags, workerPressure
	liveDags = func(context.Context) ([]*waveobj.TaskGroup, error) { return *others, nil }
	workerPressure = func(context.Context) jobqueue.Pressure { return *pressure }
	restoreAfterStages(t, func() { liveDags, workerPressure = oldLive, oldPressure })
}

func requireClaimReleased(t *testing.T, g *waveobj.TaskGroup) {
	t.Helper()
	workerClaims.Lock()
	defer workerClaims.Unlock()
	if n := workerClaims.byDag[g.OID]; n != 0 {
		t.Fatalf("the tick's claim must be released once it persisted, still holds %d", n)
	}
}

// A dag ready to dispatch while other runs fill the cap starts nothing, its task stays pending, and the next
// tick after a slot frees dispatches it. The claim is gone once the tick ends.
func TestScheduleWaitsForAWorkerSlotHeldByAnotherRun(t *testing.T) {
	ctx, g, spawns := workerSlotsFixture(t, "worker-slots", 1, 2)
	others := []*waveobj.TaskGroup{slotDag(t, "other-run", MaxLiveWorkers, MaxLiveWorkers)}
	pressure := jobqueue.PressureNormal
	standInMachine(t, &others, &pressure)

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	if *spawns != 0 || g.Tasks[0].State != TaskState_Pending {
		t.Fatalf("a full cap must hold the task pending: %d spawns, state %s", *spawns, g.Tasks[0].State)
	}

	others[0].Tasks[0].State = TaskState_Done
	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	if *spawns != 1 || g.Tasks[0].State != TaskState_Running {
		t.Fatalf("a freed slot must dispatch the task: %d spawns, state %s", *spawns, g.Tasks[0].State)
	}
	requireClaimReleased(t, g)
}

// the cap is across dags: two dags that would each fit are held to MaxLiveWorkers between them
func TestScheduleCapsLiveWorkersAcrossTwoDags(t *testing.T) {
	ctx, g, spawns := workerSlotsFixture(t, "worker-cap-two", 6, MaxParallelism)
	// another dag holds all but two of the slots with live workers, and nothing of its own to start
	others := []*waveobj.TaskGroup{slotDag(t, "other-run", MaxLiveWorkers-2, MaxLiveWorkers-2)}
	pressure := jobqueue.PressureNormal
	standInMachine(t, &others, &pressure)

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	if *spawns != 2 {
		t.Fatalf("with %d of %d slots held elsewhere the dag starts 2 of its 6 ready tasks, started %d", MaxLiveWorkers-2, MaxLiveWorkers, *spawns)
	}
	if got := len(busyTaskIDs(g)); got != 2 {
		t.Fatalf("two tasks run and four stay pending, %d are in flight", got)
	}
	requireClaimReleased(t, g)
}

// while another run waits for a worker a run refills only to its share of the cap: the dag whose worker just
// finished ticks first and would otherwise take every freed slot
func TestScheduleRefillsOnlyToItsShareWhileAnotherRunWaits(t *testing.T) {
	ctx, g, spawns := workerSlotsFixture(t, "worker-share", 6, MaxParallelism)
	// another run with ready work and no dispatch under way: it waits
	others := []*waveobj.TaskGroup{slotDag(t, "waiting-run", 3, 0)}
	pressure := jobqueue.PressureNormal
	standInMachine(t, &others, &pressure)

	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	if want := MaxLiveWorkers / 2; *spawns != want {
		t.Fatalf("beside one waiting run this dag takes half the cap, %d workers: started %d", want, *spawns)
	}

	// the other run has started its work and nothing waits any more: this dag refills to the cap
	others[0] = slotDag(t, "waiting-run", 3, 3)
	if err := ScheduleOnce(ctx, g); err != nil {
		t.Fatal(err)
	}
	if want := MaxLiveWorkers - 3; *spawns != want {
		t.Fatalf("with the other run live and not waiting this dag fills the rest of the cap (%d in all): started %d", want, *spawns)
	}
	requireClaimReleased(t, g)
}

// Warn and critical hold a run to one worker; unknown (no reading: the job queue still gates each heavy command) and
// normal hold nothing.
func TestScheduleHoldsDispatchUnderMemoryPressure(t *testing.T) {
	cases := []struct {
		name     string
		pressure jobqueue.Pressure
		held     bool
	}{
		{"unknown", jobqueue.PressureUnknown, false},
		{"normal", jobqueue.PressureNormal, false},
		{"warn", jobqueue.PressureWarn, true},
		{"critical", jobqueue.PressureCritical, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, g, spawns := workerSlotsFixture(t, "worker-pressure-"+c.name, 2, 2)
			// one worker is live in another run
			others := []*waveobj.TaskGroup{slotDag(t, "other-run", 1, 1)}
			pressure := c.pressure
			standInMachine(t, &others, &pressure)

			if err := ScheduleOnce(ctx, g); err != nil {
				t.Fatal(err)
			}
			if c.held && (*spawns != 1 || g.Tasks[1].State != TaskState_Pending) {
				t.Fatalf("pressure %s must hold the run to one worker: %d spawns, second task %s", c.name, *spawns, g.Tasks[1].State)
			}
			if !c.held && *spawns != 2 {
				t.Fatalf("pressure %s must hold nothing, started %d of 2", c.name, *spawns)
			}

			// the pressure clears: what was held starts on the next tick
			pressure = jobqueue.PressureNormal
			if err := ScheduleOnce(ctx, g); err != nil {
				t.Fatal(err)
			}
			if *spawns != 2 {
				t.Fatalf("once the pressure clears both tasks start, started %d", *spawns)
			}
			requireClaimReleased(t, g)
		})
	}
}

// With no worker live anywhere one starts whatever the pressure reads: on Windows warn is the commit charge past the
// RAM, which a dev box often sits at, and a run with nothing live must not stall on it.
func TestScheduleStartsOneWorkerUnderPressureWhenNothingIsLive(t *testing.T) {
	for _, c := range []struct {
		name     string
		pressure jobqueue.Pressure
	}{{"warn", jobqueue.PressureWarn}, {"critical", jobqueue.PressureCritical}} {
		t.Run(c.name, func(t *testing.T) {
			ctx, g, spawns := workerSlotsFixture(t, "worker-floor-"+c.name, 3, 3)
			var others []*waveobj.TaskGroup
			pressure := c.pressure
			standInMachine(t, &others, &pressure)

			if err := ScheduleOnce(ctx, g); err != nil {
				t.Fatal(err)
			}
			if *spawns != 1 {
				t.Fatalf("pressure %s with nothing live starts exactly one worker, started %d", c.name, *spawns)
			}
			// that worker is live now, so the next tick holds the other two
			if err := ScheduleOnce(ctx, g); err != nil {
				t.Fatal(err)
			}
			if *spawns != 1 {
				t.Fatalf("pressure %s with a worker live holds the rest, started %d", c.name, *spawns)
			}
			requireClaimReleased(t, g)
		})
	}
}

// jobs:mode off (or a pause) is the person's "don't wait for memory": the worker gate reads no pressure then, as the
// job queue starts every job at once.
func TestWorkerPressureObeysJobsModeOff(t *testing.T) {
	oldDefault, oldRead := jobqueue.Default, readPressure
	defer func() { jobqueue.Default, readPressure = oldDefault, oldRead }()
	readPressure = func(context.Context) jobqueue.Pressure { return jobqueue.PressureCritical }
	mode := jobqueue.ModeAuto
	jobqueue.Default = jobqueue.New(jobqueue.Config{Mode: func() string { return mode }})
	if got := machinePressure(context.Background()); got != jobqueue.PressureCritical {
		t.Fatalf("jobs:mode auto reads the machine, got %v", got)
	}
	mode = jobqueue.ModeOff
	if got := machinePressure(context.Background()); got != jobqueue.PressureUnknown {
		t.Fatalf("jobs:mode off holds nothing, got %v", got)
	}
}
