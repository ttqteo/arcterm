// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runregulator

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/runpause"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// fakes scripts every read the loop makes and records every call it makes.
type fakes struct {
	off      bool
	pressure jobqueue.Pressure
	free     uint64
	now      time.Time
	runs     []*waveobj.Run
	dags     map[string]*waveobj.TaskGroup
	dagErr   map[string]error
	held     map[string]uint64
	pauseErr error

	pressureReads int
	runLoads      int
	heldReads     []string
	pauses        []string
	resumes       []string
}

// install swaps the loop's seams for f's and puts them back when the test ends.
func install(t *testing.T) *fakes {
	t.Helper()
	f := &fakes{now: t0, dags: map[string]*waveobj.TaskGroup{}, dagErr: map[string]error{}, held: map[string]uint64{}}
	pOff, pPressure, pFree, pRuns, pDag := jobsOff, readPressure, readFreeBytes, loadRuns, loadDag
	pHeld, pPause, pResume, pClock, pOS, pEvery := heldBytes, pauseRun, resumeRun, clock, goos, tickEvery
	t.Cleanup(func() {
		jobsOff, readPressure, readFreeBytes, loadRuns, loadDag = pOff, pPressure, pFree, pRuns, pDag
		heldBytes, pauseRun, resumeRun, clock, goos, tickEvery = pHeld, pPause, pResume, pClock, pOS, pEvery
	})
	jobsOff = func() bool { return f.off }
	readPressure = func(context.Context) jobqueue.Pressure { f.pressureReads++; return f.pressure }
	readFreeBytes = func(context.Context) (uint64, error) { return f.free, nil }
	loadRuns = func(context.Context) ([]*waveobj.Run, error) { f.runLoads++; return f.runs, nil }
	loadDag = func(_ context.Context, id string) (*waveobj.TaskGroup, error) {
		if err := f.dagErr[id]; err != nil {
			return nil, err
		}
		g, ok := f.dags[id]
		if !ok {
			return nil, wstore.ErrNotFound
		}
		return g, nil
	}
	heldBytes = func(_ context.Context, _, runId string) (uint64, error) {
		f.heldReads = append(f.heldReads, runId)
		return f.held[runId], nil
	}
	pauseRun = func(_ context.Context, channelId, runId, by string) error {
		f.pauses = append(f.pauses, fmt.Sprintf("%s/%s/%s", channelId, runId, by))
		return f.pauseErr
	}
	resumeRun = func(_ context.Context, channelId, runId, by string) error {
		f.resumes = append(f.resumes, fmt.Sprintf("%s/%s/%s", channelId, runId, by))
		return nil
	}
	clock = func() time.Time { return f.now }
	return f
}

// tickAt runs one tick with the clock at d past t0.
func (f *fakes) tickAt(st *State, d time.Duration) {
	f.now = at(d)
	tick(context.Background(), st)
}

// liveRun is an executing top-level run, with a dag of the same id when dag is not nil.
func (f *fakes) liveRun(id string, createdTs int64, dag *waveobj.TaskGroup) *waveobj.Run {
	r := &waveobj.Run{OID: id, ID: id, ChannelOID: "ch-" + id, Status: jarvis.RunStatus_Executing, CreatedTs: createdTs}
	if dag != nil {
		r.DagORef = id
		f.dags[id] = dag
	}
	f.runs = append(f.runs, r)
	f.held[id] = 4 * gb
	return r
}

// pausedRun is a top-level run paused at pausedTs (Unix ms) that held held bytes.
func (f *fakes) pausedRun(id string, pausedTs int64, held uint64) *waveobj.Run {
	r := &waveobj.Run{OID: id, ID: id, ChannelOID: "ch-" + id, Status: jarvis.RunStatus_Paused,
		Pause: &waveobj.RunPause{PausedTs: pausedTs, By: runpause.By_Auto, HeldBytes: held}}
	f.runs = append(f.runs, r)
	return r
}

func dagWith(done, total int) *waveobj.TaskGroup {
	g := &waveobj.TaskGroup{Status: "running"}
	for i := range total {
		state := "pending"
		if i < done {
			state = "done"
		}
		g.Tasks = append(g.Tasks, waveobj.TaskNode{ID: fmt.Sprintf("t-%d", i), State: state, Merged: true})
	}
	return g
}

func TestTickDoesNothingWhileJobsAreOff(t *testing.T) {
	f := install(t)
	f.pressure = jobqueue.PressureCritical
	f.liveRun("a", 1, dagWith(0, 2))
	var st State

	f.tickAt(&st, 0) // tight clock starts
	f.off = true
	f.tickAt(&st, 70*time.Second)
	f.tickAt(&st, 200*time.Second)
	if f.pressureReads != 1 || f.runLoads != 1 || len(f.pauses) != 0 || len(f.resumes) != 0 {
		t.Fatalf("while off: pressure reads %d, run loads %d, pauses %v, resumes %v; want only the first tick's reads",
			f.pressureReads, f.runLoads, f.pauses, f.resumes)
	}

	// switched back on: the time spent off does not count as time tight
	f.off = false
	f.tickAt(&st, 210*time.Second)
	f.tickAt(&st, 260*time.Second)
	if len(f.pauses) != 0 {
		t.Fatalf("paused %v before 60 s of tight since it was switched back on", f.pauses)
	}
	f.tickAt(&st, 270*time.Second)
	if want := []string{"ch-a/a/auto"}; !reflect.DeepEqual(f.pauses, want) {
		t.Fatalf("pauses = %v, want %v", f.pauses, want)
	}
}

func TestTickPausesTheRunWithFewestTasksDoneByAuto(t *testing.T) {
	f := install(t)
	f.pressure = jobqueue.PressureWarn
	f.liveRun("far", 1, dagWith(3, 4))
	f.liveRun("near", 2, dagWith(1, 4))
	var st State

	f.tickAt(&st, 0)
	f.tickAt(&st, 30*time.Second)
	if len(f.pauses) != 0 {
		t.Fatalf("paused %v before 60 s of tight", f.pauses)
	}
	f.tickAt(&st, 60*time.Second)
	if want := []string{"ch-near/near/auto"}; !reflect.DeepEqual(f.pauses, want) {
		t.Fatalf("pauses = %v, want %v", f.pauses, want)
	}
}

func TestTickRanksOnlyTopLevelRunsThatAreNotInTheirFinalStageMidMergeOrPaused(t *testing.T) {
	f := install(t)
	f.pressure = jobqueue.PressureCritical
	f.liveRun("child", 1, dagWith(0, 2)).ParentLeadORef = "tab:lead"
	f.liveRun("worker", 1, nil).TaskId = "t-1"
	final := dagWith(2, 2)
	final.Status = "finalizing"
	f.liveRun("final", 1, final)
	merging := dagWith(0, 2)
	merging.Tasks[0].State = "verifying"
	f.liveRun("merging", 1, merging)
	f.pausedRun("already", 1, 8*gb)
	f.liveRun("plain", 1, dagWith(1, 2))
	var st State

	f.tickAt(&st, 0)
	if want := []string{"plain"}; !reflect.DeepEqual(f.heldReads, want) {
		t.Fatalf("held RAM read for %v, want only the run being ranked %v", f.heldReads, want)
	}
	f.tickAt(&st, 60*time.Second)
	if want := []string{"ch-plain/plain/auto"}; !reflect.DeepEqual(f.pauses, want) {
		t.Fatalf("pauses = %v, want %v", f.pauses, want)
	}
}

func TestTickReadsNoHeldRAMWhileTheMachineIsNotTight(t *testing.T) {
	f := install(t)
	f.pressure = jobqueue.PressureNormal
	f.liveRun("a", 1, dagWith(0, 2))
	f.pausedRun("p", 1, 2*gb)
	var st State

	f.tickAt(&st, 0)
	f.tickAt(&st, 10*time.Minute)
	if len(f.heldReads) != 0 {
		t.Fatalf("held RAM read for %v while not tight", f.heldReads)
	}
}

func TestTickSkipsARunThatHoldsUnderOneGB(t *testing.T) {
	f := install(t)
	f.pressure = jobqueue.PressureWarn
	f.liveRun("small", 1, dagWith(0, 2))
	f.held["small"] = gb - 1
	var st State

	f.tickAt(&st, 0)
	f.tickAt(&st, 60*time.Second)
	if len(f.pauses) != 0 {
		t.Fatalf("paused %v, a run holding under 1 GB", f.pauses)
	}
}

func TestTickResumesTheRunPausedLongestByAutoOnceFreeRAMFits(t *testing.T) {
	f := install(t)
	f.pressure = jobqueue.PressureNormal
	f.pausedRun("newer", 3000, 2*gb)
	f.pausedRun("older", 1000, 10*gb)
	f.free = 10*gb + ResumeMargin
	var st State

	f.tickAt(&st, 0)
	f.tickAt(&st, 5*time.Minute)
	if len(f.resumes) != 0 {
		t.Fatalf("resumed %v with only the held RAM plus the margin free", f.resumes)
	}
	f.free++
	f.tickAt(&st, 5*time.Minute+5*time.Second)
	if want := []string{"ch-older/older/auto"}; !reflect.DeepEqual(f.resumes, want) {
		t.Fatalf("resumes = %v, want %v", f.resumes, want)
	}
	if len(f.heldReads) != 0 {
		t.Fatalf("a paused run's held RAM is what its record kept, not a new reading; read %v", f.heldReads)
	}
}

func TestTickHonoursTheNoFlapHoldOnAPausedRun(t *testing.T) {
	f := install(t)
	f.pressure = jobqueue.PressureNormal
	r := f.pausedRun("a", 1000, gb)
	r.Pause.NoAutoResumeUntil = at(20 * time.Minute).UnixMilli()
	f.free = 64 * gb
	var st State

	f.tickAt(&st, 0)
	f.tickAt(&st, 19*time.Minute)
	if len(f.resumes) != 0 {
		t.Fatalf("resumed %v inside the no-flap hold", f.resumes)
	}
	f.tickAt(&st, 21*time.Minute)
	if want := []string{"ch-a/a/auto"}; !reflect.DeepEqual(f.resumes, want) {
		t.Fatalf("resumes = %v, want %v after the hold", f.resumes, want)
	}
}

func TestTickCountsAnUnknownReadingAsNormal(t *testing.T) {
	f := install(t)
	f.pressure = jobqueue.PressureUnknown
	f.pausedRun("a", 1000, gb)
	f.free = 64 * gb
	var st State

	f.tickAt(&st, 0)
	f.tickAt(&st, 5*time.Minute)
	if want := []string{"ch-a/a/auto"}; !reflect.DeepEqual(f.resumes, want) {
		t.Fatalf("resumes = %v, want %v", f.resumes, want)
	}
}

func TestTickRetriesAFailedPauseAtTheUsualPaceAndNeverStandsDownOnIt(t *testing.T) {
	f := install(t)
	f.pressure = jobqueue.PressureWarn
	f.pauseErr = errors.New("the dag is locked")
	f.liveRun("a", 1, dagWith(0, 2))
	var st State

	f.tickAt(&st, 0)
	f.tickAt(&st, 60*time.Second)
	f.tickAt(&st, 65*time.Second) // inside the window: no new attempt
	f.tickAt(&st, 120*time.Second)
	f.tickAt(&st, 180*time.Second)
	if len(f.pauses) != 3 {
		t.Fatalf("pause attempts = %v, want one per window: 3", f.pauses)
	}
}

func TestTickSkipsARunWhoseDagCannotBeReadButNotOneWithNoDag(t *testing.T) {
	f := install(t)
	f.pressure = jobqueue.PressureWarn
	broken := f.liveRun("broken", 9, dagWith(0, 2))
	f.dagErr[broken.DagORef] = errors.New("db is busy")
	gone := f.liveRun("gone", 1, nil)
	gone.DagORef = "dag-that-is-gone" // names no stored dag: it counts as having none
	var st State

	f.tickAt(&st, 0)
	f.tickAt(&st, 60*time.Second)
	if want := []string{"ch-gone/gone/auto"}; !reflect.DeepEqual(f.pauses, want) {
		t.Fatalf("pauses = %v, want %v: an unreadable dag leaves the run out, a missing one does not", f.pauses, want)
	}
}

func TestTickRecoversFromAPanicAndCarriesOn(t *testing.T) {
	f := install(t)
	f.pressure = jobqueue.PressureWarn
	f.liveRun("a", 1, dagWith(0, 2))
	var st State

	readPressure = func(context.Context) jobqueue.Pressure { panic("boom") }
	f.tickAt(&st, 0) // must not panic out of the tick
	readPressure = func(context.Context) jobqueue.Pressure { return f.pressure }
	f.tickAt(&st, 10*time.Second)
	f.tickAt(&st, 70*time.Second)
	if want := []string{"ch-a/a/auto"}; !reflect.DeepEqual(f.pauses, want) {
		t.Fatalf("pauses = %v, want %v after the recovered tick", f.pauses, want)
	}
}

func TestTickCarriesOnWhenTheRunsCannotBeLoaded(t *testing.T) {
	f := install(t)
	f.pressure = jobqueue.PressureWarn
	loadRuns = func(context.Context) ([]*waveobj.Run, error) { return nil, errors.New("db is down") }
	var st State

	f.tickAt(&st, 0)
	f.tickAt(&st, 60*time.Second)
	if len(f.pauses) != 0 || len(f.resumes) != 0 {
		t.Fatalf("acted with no runs: pauses %v, resumes %v", f.pauses, f.resumes)
	}
}

func TestTheLoopRunsOnlyWhereMemoryPressureCanBeRead(t *testing.T) {
	f := install(t)
	for goosName, want := range map[string]bool{"darwin": true, "windows": true, "linux": false, "freebsd": false} {
		goos = goosName
		if got := pressureReadable(); got != want {
			t.Errorf("pressureReadable on %s = %v, want %v", goosName, got, want)
		}
	}

	// Start on linux launches nothing: no tick ever reads the pressure
	var reads atomic.Int32
	readPressure = func(context.Context) jobqueue.Pressure { reads.Add(1); return f.pressure }
	goos, tickEvery = "linux", time.Millisecond
	Start(t.Context())
	time.Sleep(50 * time.Millisecond)
	if n := reads.Load(); n != 0 {
		t.Fatalf("read the pressure %d times on linux", n)
	}
}

func TestTheLoopTicksUntilItsContextEnds(t *testing.T) {
	f := install(t)
	read := make(chan struct{}, 1024)
	readPressure = func(context.Context) jobqueue.Pressure {
		select {
		case read <- struct{}{}:
		default:
		}
		return f.pressure
	}
	tickEvery = time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		loop(ctx)
		close(done)
	}()
	select {
	case <-read:
	case <-time.After(5 * time.Second):
		t.Fatal("the loop never ticked")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the loop did not stop when its context ended")
	}
}
