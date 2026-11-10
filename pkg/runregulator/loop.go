// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runregulator

import (
	"context"
	"errors"
	"log"
	"runtime"
	"time"

	"github.com/shirou/gopsutil/v4/mem"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/runpause"
	"github.com/wavetermdev/waveterm/pkg/runqueue"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// Tick is how often the loop reads the pressure and decides.
const Tick = 5 * time.Second

// What the loop reads and calls outside this package's own rules: vars, so tests script them.
var (
	goos          = runtime.GOOS
	tickEvery     = Tick
	clock         = time.Now
	jobsOff       = jobqueue.Off
	readPressure  = jobqueue.ReadPressure
	readFreeBytes = freeBytes
	loadRuns      = loadLiveRuns
	loadDag       = wstore.GetDagShared
	heldBytes     = runpause.HeldBytes
	pauseRun      = runpause.Pause
	resumeRun     = runpause.Resume
)

// pressureReadable is whether jobqueue.ReadPressure gives a reading here: on macOS and Windows only. Elsewhere Arc
// does not regulate, and the manual Pause and Resume still work.
func pressureReadable() bool { return goos == "darwin" || goos == "windows" }

// Start runs the regulator until ctx ends, where the pressure can be read.
func Start(ctx context.Context) {
	if !pressureReadable() {
		return
	}
	go loop(ctx)
}

func loop(ctx context.Context) {
	var st State
	t := time.NewTicker(tickEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			tick(ctx, &st)
		}
	}
}

// tick reads the machine, asks Decide, and applies what it says. Nothing here is fatal: an error is logged, and a
// panic ends only this tick.
func tick(ctx context.Context, st *State) {
	defer func() {
		panichandler.PanicHandler("runregulator", recover())
	}()
	if jobsOff() {
		// The person switched Arc's memory waiting off (jobs:mode off or jobs:pauseuntil): it neither pauses nor
		// resumes, and the time spent off does not count as time tight or normal once it is back on.
		*st = State{}
		return
	}
	pressure := readPressure(ctx)
	runs, err := loadRuns(ctx)
	if err != nil {
		log.Printf("runregulator: loading runs: %v", err)
		return
	}
	free, err := readFreeBytes(ctx)
	if err != nil {
		log.Printf("runregulator: reading free RAM: %v", err)
		free = 0 // no resume without a reading; a pause does not need it
	}
	act := Decide(st, Input{Pressure: pressure, FreeBytes: free, Now: clock(), Candidates: candidates(ctx, runs, tight(pressure))})
	var verb string
	switch act.Kind {
	case ActionPause:
		verb, err = "pausing", pauseRun(ctx, act.ChannelID, act.RunID, runpause.By_Auto)
	case ActionResume:
		verb, err = "resuming", resumeRun(ctx, act.ChannelID, act.RunID, runpause.By_Auto)
	default:
		return
	}
	if err != nil {
		log.Printf("runregulator: %s run %s: %v", verb, act.RunID, err)
		st.Failed(act)
		return
	}
	log.Printf("runregulator: %s run %s", verb, act.RunID)
}

// candidates builds Decide's input from the top-level runs that have not ended. Decide only looks at the runs it could
// pause while the machine is tight, so the others cost nothing: with tight false only paused runs are listed, and
// only the runs the regulator may still pick (not finalizing, not mid-merge) have their RAM measured.
func candidates(ctx context.Context, runs []*waveobj.Run, tight bool) []Candidate {
	var out []Candidate
	for _, r := range runs {
		if r == nil || !runqueue.TopLevel(r) {
			continue
		}
		c := Candidate{RunID: r.ID, ChannelID: r.ChannelOID, CreatedTs: r.CreatedTs}
		if r.Status == jarvis.RunStatus_Paused {
			c.Paused = true
			if p := r.Pause; p != nil {
				c.PausedTs, c.HeldBytes, c.NoAutoResumeUntil = p.PausedTs, p.HeldBytes, p.NoAutoResumeUntil
				c.ByPerson = p.By == runpause.By_Manual
			}
			out = append(out, c)
			continue
		}
		if !tight {
			continue
		}
		g, ok := dagOf(ctx, r)
		if !ok {
			continue // not knowing whether it is merging, it is not picked
		}
		c.TasksDone, c.Finalizing, c.MidMerge = TasksDone(g), Finalizing(g), MidMerge(g)
		if !c.Finalizing && !c.MidMerge {
			n, err := heldBytes(ctx, c.ChannelID, c.RunID)
			if err != nil {
				log.Printf("runregulator: measuring run %s: %v", c.RunID, err)
			}
			c.HeldBytes = n
		}
		out = append(out, c)
	}
	return out
}

// dagOf is r's dag: nil for a run with none, or whose DagORef names no stored dag. ok is false when the dag exists but
// could not be read.
func dagOf(ctx context.Context, r *waveobj.Run) (*waveobj.TaskGroup, bool) {
	if r.DagORef == "" {
		return nil, true
	}
	g, err := loadDag(ctx, r.DagORef)
	switch {
	case errors.Is(err, wstore.ErrNotFound):
		return nil, true
	case err != nil:
		log.Printf("runregulator: loading the dag of run %s: %v", r.ID, err)
		return nil, false
	}
	return g, true
}

// loadLiveRuns is every run that has not ended: the statuses runqueue.Active counts, a paused run's included.
func loadLiveRuns(ctx context.Context) ([]*waveobj.Run, error) {
	return wstore.GetRunsByStatus(ctx, jarvis.RunStatus_Planning, jarvis.RunStatus_AwaitingReview, jarvis.RunStatus_Executing,
		jarvis.RunStatus_Blocked, jarvis.RunStatus_Paused)
}

// freeBytes is the RAM available, read as the job queue reads it (startJobQueue in cmd/server).
func freeBytes(ctx context.Context) (uint64, error) {
	vm, err := mem.VirtualMemoryWithContext(ctx)
	if err != nil {
		return 0, err
	}
	return vm.Available, nil
}
