// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"log"
	"maps"
	"math"
	"path/filepath"
	"reflect"
	"slices"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// landTurns is each project checkout's land line: the run whose land is in its turn. Runs of one project land one
// at a time, in the order they asked, so none is checked against a base another is about to move. In memory only: a
// restart ends the land a turn covered, and the driver's first pass puts that land back in line.
var landTurns = struct {
	sync.Mutex
	byProject map[string]string
}{byProject: make(map[string]string)}

// landProjectKey is a project checkout's key in the line, the same as in claimProject.
func landProjectKey(project string) string { return filepath.Clean(project) }

// tryTakeTurn gives runID the project's turn when nobody has it. It never waits.
func tryTakeTurn(project, runID string) bool {
	key := landProjectKey(project)
	landTurns.Lock()
	defer landTurns.Unlock()
	if _, taken := landTurns.byProject[key]; taken {
		return false
	}
	landTurns.byProject[key] = runID
	return true
}

func releaseTurn(project, runID string) {
	key := landProjectKey(project)
	landTurns.Lock()
	defer landTurns.Unlock()
	if landTurns.byProject[key] == runID {
		delete(landTurns.byProject, key)
	}
}

// projectClaimed says whether a task's merge or its Verify holds the project checkout (claimProject) now.
func projectClaimed(project string) bool {
	landings.Lock()
	defer landings.Unlock()
	return landings.byProject[landProjectKey(project)] != nil
}

// asksBefore says whether the land asked for at aTs by run aID comes before bTs by bID: the line's order.
func asksBefore(aTs int64, aID string, bTs int64, bID string) bool {
	if aTs != bTs {
		return aTs < bTs
	}
	return aID < bID
}

// takeLineTurn gives run its project's turn when it is free and no queued land asked first, so a fresh land never
// passes one that has waited. A land that is queued itself is in line at its own QueuedTs.
func takeLineTurn(ctx context.Context, run *waveobj.Run) bool {
	if !tryTakeTurn(run.ProjectPath, run.ID) {
		return false
	}
	if olderLandQueued(ctx, run) {
		releaseTurn(run.ProjectPath, run.ID)
		return false
	}
	return true
}

func olderLandQueued(ctx context.Context, run *waveobj.Run) bool {
	queued, err := wstore.GetRunsByLandState(ctx, LandState_Queued)
	if err != nil {
		log.Printf("run %s: listing the queued lands: %v", run.ID, err)
		return false
	}
	ts, key := int64(math.MaxInt64), landProjectKey(run.ProjectPath)
	if run.Land != nil && run.Land.State == LandState_Queued {
		ts = run.Land.QueuedTs
	}
	for _, other := range queued {
		if other.ID != run.ID && !other.Land.Fixture && landProjectKey(other.ProjectPath) == key &&
			asksBefore(other.Land.QueuedTs, other.ID, ts, run.ID) {
			return true
		}
	}
	return false
}

// queuedTs is when run's land asks for its turn: the time it first did, if it is queued already.
func queuedTs(run *waveobj.Run) int64 {
	if run.Land != nil && run.Land.State == LandState_Queued && run.Land.QueuedTs != 0 {
		return run.Land.QueuedTs
	}
	return time.Now().UnixMilli()
}

func resolverTried(run *waveobj.Run) bool {
	return run.Land != nil && run.Land.ResolverTried
}

// queueLand puts run's land in line for its project's turn, asked for at ts. A land already queued so writes
// nothing, and joining the line is recorded once.
func queueLand(ctx context.Context, run *waveobj.Run, force bool, ts int64) (*waveobj.RunLand, error) {
	land := &waveobj.RunLand{State: LandState_Queued, QueuedTs: ts, Force: force, ResolverTried: resolverTried(run)}
	if reflect.DeepEqual(run.Land, land) {
		return run.Land, nil
	}
	if err := saveLand(ctx, run.ChannelOID, run.ID, land); err != nil {
		return nil, err
	}
	if run.Land == nil || run.Land.State != LandState_Queued {
		appendLandQueued(ctx, run.ChannelOID, run.ID)
	}
	return land, nil
}

// appendLandQueued records that runID joined the line, and how many lands are before it.
func appendLandQueued(ctx context.Context, channelID, runID string) {
	var runs []*waveobj.Run
	for _, state := range []string{LandState_Pending, LandState_Queued} {
		got, err := wstore.GetRunsByLandState(ctx, state)
		if err != nil {
			log.Printf("run %s: listing the %s lands: %v", runID, state, err)
			continue
		}
		runs = append(runs, got...)
	}
	place, _ := LandPlace(runs, runID)
	appendRunEvent(ctx, channelID, runID, waveobj.RunEventKindLandQueued, nil, map[string]any{"ahead": max(place-1, 0)})
}

// LandPlace is a queued land's place in its project's line: 1 when it lands next, one more for each queued land of
// the project that asked before it, and one more when a land of the project is in its turn (pending). ahead is the
// land just before it. A run whose land is not queued has no place: 0.
func LandPlace(runs []*waveobj.Run, runID string) (place int, ahead *waveobj.Run) {
	var me *waveobj.Run
	for _, r := range runs {
		if r.ID == runID {
			me = r
		}
	}
	if me == nil || me.Land == nil || me.Land.State != LandState_Queued {
		return 0, nil
	}
	key := landProjectKey(me.ProjectPath)
	var before []*waveobj.Run
	var inTurn *waveobj.Run
	for _, r := range runs {
		if r.ID == me.ID || r.Land == nil || landProjectKey(r.ProjectPath) != key {
			continue
		}
		switch {
		case r.Land.State == LandState_Pending:
			if inTurn == nil || r.ID < inTurn.ID {
				inTurn = r
			}
		case r.Land.State == LandState_Queued && asksBefore(r.Land.QueuedTs, r.ID, me.Land.QueuedTs, me.ID):
			before = append(before, r)
		}
	}
	slices.SortFunc(before, func(a, b *waveobj.Run) int {
		switch {
		case asksBefore(a.Land.QueuedTs, a.ID, b.Land.QueuedTs, b.ID):
			return -1
		case asksBefore(b.Land.QueuedTs, b.ID, a.Land.QueuedTs, a.ID):
			return 1
		}
		return 0
	})
	if inTurn != nil {
		before = slices.Insert(before, 0, inTurn)
	}
	if len(before) > 0 {
		ahead = before[len(before)-1]
	}
	return len(before) + 1, ahead
}

// landLinePass keeps one pass of the driver at a time. A pass asked for while another runs makes that one scan
// again when it ends, so a turn released after its scan is not left for the next tick.
var landLinePass struct {
	sync.Mutex
	running, again bool
}

// landLineBoot makes the driver's first pass also look for lands the last server died in the middle of.
var landLineBoot sync.Once

// driveLandLine gives the turn of each project to its oldest queued land, and tends the lands being resolved. It
// starts the lands and returns: the watchdog calls it every tick, and a land that ends calls it again.
func driveLandLine(ctx context.Context) {
	landLinePass.Lock()
	if landLinePass.running {
		landLinePass.again = true
		landLinePass.Unlock()
		return
	}
	landLinePass.running = true
	landLinePass.Unlock()
	for {
		driveLandLinePass(ctx)
		landLinePass.Lock()
		if !landLinePass.again {
			landLinePass.running = false
			landLinePass.Unlock()
			return
		}
		landLinePass.again = false
		landLinePass.Unlock()
	}
}

func driveLandLinePass(ctx context.Context) {
	boot := false
	landLineBoot.Do(func() { boot = true })
	if boot {
		requeueOrphanedLands(ctx)
	}
	// before the scan of the queue, so a land whose resolver just ended is in line for this pass
	tendResolvingLands(ctx)
	queued, err := wstore.GetRunsByLandState(ctx, LandState_Queued)
	if err != nil {
		log.Printf("listing queued lands: %v", err)
		return
	}
	oldest := make(map[string]*waveobj.Run)
	for _, run := range queued {
		if run.Land.Fixture {
			continue
		}
		key := landProjectKey(run.ProjectPath)
		if cur := oldest[key]; cur == nil || asksBefore(run.Land.QueuedTs, run.ID, cur.Land.QueuedTs, cur.ID) {
			oldest[key] = run
		}
	}
	for _, key := range slices.Sorted(maps.Keys(oldest)) {
		run := oldest[key]
		if !tryTakeTurn(run.ProjectPath, run.ID) {
			continue
		}
		if !landLocks.TryLock(run.ID) {
			releaseTurn(run.ProjectPath, run.ID)
			continue
		}
		goStage("land "+run.ID, func() { landInTurn(ctx, run) })
	}
}

// landInTurn lands run, whose project's turn and land lock the driver took, then gives the turn up and drives the
// line on. A land that went back in line found the checkout claimed, and one that failed to save is not moved on:
// driving again now would only find the same land first.
func landInTurn(ctx context.Context, run *waveobj.Run) {
	// a merge cut off halfway would leave the checkout mid-merge
	lctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), LandTimeout)
	land, err := landRunLocked(lctx, run.ChannelOID, run.ID, false, true)
	cancel()
	landLocks.Unlock(run.ID)
	releaseTurn(run.ProjectPath, run.ID)
	if err != nil {
		log.Printf("run %s: landing it in its turn: %v", run.ID, err)
		return
	}
	if land == nil || land.State != LandState_Queued {
		driveLandLine(ctx)
	}
}

// requeueOrphanedLands puts back in line each land the last server died in the middle of: it reads pending, and
// no land is under way, since one holds its run's land lock. The first pass only; later a pending land is a live one.
func requeueOrphanedLands(ctx context.Context) {
	runs, err := wstore.GetRunsByLandState(ctx, LandState_Pending)
	if err != nil {
		log.Printf("listing pending lands: %v", err)
		return
	}
	for _, run := range runs {
		if run.Land.Fixture || !landLocks.TryLock(run.ID) {
			continue
		}
		requeueOrphan(ctx, run)
	}
}

// requeueOrphan reads run again under the land lock requeueOrphanedLands took, and releases it.
func requeueOrphan(ctx context.Context, listed *waveobj.Run) {
	defer landLocks.Unlock(listed.ID)
	run, err := wstore.GetRun(ctx, listed.ChannelOID, listed.ID)
	if err != nil || run.Land == nil || run.Land.State != LandState_Pending {
		return
	}
	if _, err := queueLand(ctx, run, run.Land.Force, time.Now().UnixMilli()); err != nil {
		log.Printf("run %s: putting its land back in line: %v", run.ID, err)
	}
}
