// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"log"
	"slices"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// DagStatus_Paused reads on a dag while TaskGroup.PausedTs is set, unless the dag is done or cancelled
// (RecomputeDagStatus). The dag's runs keep their own statuses; Run.PausedUnder marks them.
const DagStatus_Paused = "paused"

// The three functions below are the engine's half of a run's pause (spec 2026-11-05-run-pause-design, decisions 5 to
// 7). Their signatures are final and pkg/runpause calls them.
//
// A pause marks before it stops anything: the dag's PausedTs and every run's PausedUnder are one transaction, and
// only after it commits is a Verify, a Final command or an agent stopped. So every exit, outcome or tab-close a stop
// causes already finds the run and its dag paused, and the guards that read them (jarvis.RunPaused, the dag's
// PausedTs) leave it alone.

// errSetupPaused is the cause a pause or a cancel cuts a Setup off with (context.Cause).
var errSetupPaused = errors.New("the dag was paused or cancelled")

// dagSetups holds the cancel of every plan Setup (and base Check) running for a dag, as finalRuns holds the final
// commands': Setup runs under the dag lock for up to SetupTimeout, which a pause would otherwise wait out. pausing
// counts the pauses in flight, so a Setup that starts after the cancel (a base Check does not need the lock) is born
// cancelled. In memory only: a restart kills the commands, and the next tick starts them again.
var dagSetups = struct {
	sync.Mutex
	next    int
	byDag   map[string]map[int]context.CancelCauseFunc
	pausing map[string]int
}{byDag: make(map[string]map[int]context.CancelCauseFunc), pausing: make(map[string]int)}

// dagSetupCtx returns ctx as stopDagSetup can cancel it, and the func that ends the registration (call it once the
// command is over).
func dagSetupCtx(ctx context.Context, dagID string) (context.Context, func()) {
	ctx, cancel := context.WithCancelCause(ctx)
	dagSetups.Lock()
	defer dagSetups.Unlock()
	id := dagSetups.next
	dagSetups.next++
	if dagSetups.byDag[dagID] == nil {
		dagSetups.byDag[dagID] = make(map[int]context.CancelCauseFunc)
	}
	dagSetups.byDag[dagID][id] = cancel
	if dagSetups.pausing[dagID] > 0 {
		cancel(errSetupPaused)
	}
	return ctx, func() {
		dagSetups.Lock()
		delete(dagSetups.byDag[dagID], id)
		if len(dagSetups.byDag[dagID]) == 0 {
			delete(dagSetups.byDag, dagID)
		}
		dagSetups.Unlock()
		cancel(nil)
	}
}

// setupCut reports whether a pause cut off the command ctx (from dagSetupCtx) ran under, as against a timeout or an
// error of its own.
func setupCut(ctx context.Context) bool {
	return errors.Is(context.Cause(ctx), errSetupPaused)
}

// stopDagSetup cancels every Setup running for dagID and keeps cancelling new ones until the returned func is called.
func stopDagSetup(dagID string) func() {
	dagSetups.Lock()
	defer dagSetups.Unlock()
	dagSetups.pausing[dagID]++
	for _, cancel := range dagSetups.byDag[dagID] {
		cancel(errSetupPaused)
	}
	return func() {
		dagSetups.Lock()
		defer dagSetups.Unlock()
		if dagSetups.pausing[dagID]--; dagSetups.pausing[dagID] <= 0 {
			delete(dagSetups.pausing, dagID)
		}
	}
}

// dagPaused reports whether g holds a pause.
func dagPaused(g *waveobj.TaskGroup) bool {
	return g != nil && g.PausedTs != 0
}

// runUnderPause is the guard of an exit, an outcome or a tab-close of run: it is paused itself (jarvis.RunPaused), or
// its dag is. The dag's own mark covers a worker spawned in the instant before the dag lock was taken, which no run
// mark names yet. An unreadable dag reads as not paused: the path that follows reads the same dag and reports it.
func runUnderPause(ctx context.Context, run *waveobj.Run) bool {
	if jarvis.RunPaused(run) {
		return true
	}
	if run == nil || run.DagORef == "" {
		return false
	}
	g, err := wstore.GetDag(ctx, run.DagORef)
	return err == nil && dagPaused(g)
}

// PauseDag pauses dagID for the top-level run topRunID. It marks every run of the dag except topRunID itself with
// PausedUnder = topRunID, sets the dag's PausedTs in the same write, and only then stops Verify, Final and every
// live session. It returns the sessions it suspended, for the caller to keep in Pause.Sessions: a session whose
// suspend failed is not among them, since it still runs, and its error is returned beside the rest.
//
// It refuses a cancelled or done dag, and does nothing for one already paused. It waits for the dag lock, so a
// merge under way lands first; a running Setup, which holds that lock for minutes, is cancelled first.
func PauseDag(ctx context.Context, dagID, topRunID string) ([]waveobj.PausedSession, error) {
	// a pause that has marked the dag must stop what it marked, whether or not its caller still waits
	ctx = context.WithoutCancel(ctx)
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return nil, fmt.Errorf("loading dag %s: %w", dagID, err)
	}
	if already, err := pauseRefusal(g); err != nil || already {
		return nil, err
	}
	endPausing := stopDagSetup(dagID)
	defer endPausing()
	var sessions []waveobj.PausedSession
	var marked bool
	if err := withDagMutation(dagID, func() error {
		var perr error
		sessions, marked, perr = markDagPaused(ctx, dagID, topRunID)
		return perr
	}); err != nil || !marked {
		return nil, err
	}
	// marked: nothing below can be read as a failure. Verify and Final record nothing for a paused dag.
	stopDagVerify(dagID)
	stopDagFinal(dagID)
	releaseWorkerClaim(dagID)
	var errs []error
	suspended := make([]waveobj.PausedSession, 0, len(sessions))
	for _, s := range sessions {
		if err := jarvis.SuspendRunWorker(ctx, s.WorkerORef); err != nil {
			errs = append(errs, fmt.Errorf("suspending %s of run %s: %w", s.WorkerORef, s.RunId, err))
			continue
		}
		suspended = append(suspended, s)
	}
	return suspended, errors.Join(errs...)
}

// pauseRefusal is why g cannot be paused, or already when it is paused.
func pauseRefusal(g *waveobj.TaskGroup) (already bool, err error) {
	switch {
	case g.Status == DagStatus_Cancelled:
		return false, fmt.Errorf("dag %s is cancelled", g.OID)
	case g.Status == DagStatus_Done:
		return false, fmt.Errorf("dag %s is done", g.OID)
	}
	return dagPaused(g), nil
}

// markDagPaused is the locked half of PauseDag: PausedTs on the dag and PausedUnder on each of its runs, in one
// transaction. It returns each live session as it stood, and false when the dag turned out to be paused already. The
// caller holds the dag lock.
func markDagPaused(ctx context.Context, dagID, topRunID string) ([]waveobj.PausedSession, bool, error) {
	var sessions []waveobj.PausedSession
	var runIDs []string
	var channelID string
	marked := false
	err := withMutationTx(ctx, func(tx *wstore.TxWrap) error {
		txCtx := tx.Context()
		g, err := wstore.GetDag(txCtx, dagID)
		if err != nil {
			return fmt.Errorf("loading dag %s: %w", dagID, err)
		}
		// re-decided under the lock: a cancel, a finish or another pause may have won the wait
		if already, err := pauseRefusal(g); err != nil || already {
			return err
		}
		now := time.Now().UnixMilli()
		g.PausedTs, g.UpdatedTs = now, now
		RecomputeDagStatus(g)
		if err := wstore.UpdateDag(txCtx, dagID, func(cur *waveobj.TaskGroup) error {
			*cur = *g
			return nil
		}); err != nil {
			return err
		}
		channelID = g.ChannelId
		seen := map[string]bool{}
		for _, runID := range DagRunIDs(g) {
			if seen[runID] {
				continue
			}
			seen[runID] = true
			run, err := wstore.DBGet[*waveobj.Run](txCtx, runID)
			if err != nil {
				return fmt.Errorf("loading run %s: %w", runID, err)
			}
			if run == nil {
				log.Printf("pause dag %s: run %s is not stored, so it is not marked", dagID, runID)
				continue
			}
			if runID != topRunID {
				if err := wstore.UpdateRun(txCtx, channelID, runID, func(r *waveobj.Run) error {
					r.PausedUnder = topRunID
					return nil
				}); err != nil {
					return fmt.Errorf("marking run %s: %w", runID, err)
				}
			}
			if s, ok := runningSession(run); ok {
				sessions = append(sessions, s)
			}
			runIDs = append(runIDs, runID)
		}
		marked = true
		return nil
	})
	if err != nil || !marked {
		return nil, false, err
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, dagID))
	for _, runID := range runIDs {
		wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Run, runID))
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, channelID))
	return sessions, true, nil
}

// runningSession is the session run has working: the last worker of its running phase, in its own session. A run with no
// running phase (it finished or failed) or no worker has none.
func runningSession(run *waveobj.Run) (waveobj.PausedSession, bool) {
	i := jarvis.RunningPhaseIndex(*run)
	if i < 0 || len(run.Phases[i].WorkerOrefs) == 0 {
		return waveobj.PausedSession{}, false
	}
	workers := run.Phases[i].WorkerOrefs
	return waveobj.PausedSession{RunId: run.ID, WorkerORef: workers[len(workers)-1], Runtime: run.Runtime, SessionId: run.SessionId}, true
}

// ResumeDag resumes dagID: it reopens each session the caller stored in Pause.Sessions in its own session, resets each
// running task's stall baseline, then in one transaction clears the dag's PausedTs and the PausedUnder mark of each of
// its runs, restarts a Verify the pause cut off, and ticks the dag. The top-level run's own Pause record is
// pkg/runpause's to clear, and ResumeDag does not need it cleared first.
//
// The sessions are reopened while PausedTs is still set, so an exit one causes reads as paused; clearing it first
// would let the next tick see dead controllers and retry the tasks in fresh sessions, losing their context. A
// session that cannot be reopened is logged and left to the existing stalled retry.
func ResumeDag(ctx context.Context, dagID string, sessions []waveobj.PausedSession) error {
	ctx = context.WithoutCancel(ctx)
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return fmt.Errorf("loading dag %s: %w", dagID, err)
	}
	// a cancel clears PausedTs, and a dag that is not paused has no suspended session to reopen
	if !dagPaused(g) || g.Status == DagStatus_Cancelled {
		return nil
	}
	for _, s := range sessions {
		// PausedNudge hands over the answers held for this tab, once: ask for it right before the reopen that uses it
		if err := ReopenSession(ctx, s, jarvis.PausedNudge(ctx, s.WorkerORef)); err != nil {
			log.Printf("resume dag %s: reopening %s of run %s: %v", dagID, s.WorkerORef, s.RunId, err)
		}
	}
	var resumed *waveobj.TaskGroup
	if err := withDagMutation(dagID, func() error {
		var rerr error
		resumed, rerr = unmarkDagPaused(ctx, dagID)
		return rerr
	}); err != nil {
		return err
	}
	if resumed == nil {
		return nil
	}
	resumeVerify(ctx, resumed)
	return Schedule(ctx, dagID)
}

// unmarkDagPaused is the locked half of ResumeDag; it returns the dag it resumed, nil when a cancel won the wait. The
// caller holds the dag lock.
func unmarkDagPaused(ctx context.Context, dagID string) (*waveobj.TaskGroup, error) {
	var resumed *waveobj.TaskGroup
	var runIDs []string
	err := withMutationTx(ctx, func(tx *wstore.TxWrap) error {
		txCtx := tx.Context()
		g, err := wstore.GetDag(txCtx, dagID)
		if err != nil {
			return fmt.Errorf("loading dag %s: %w", dagID, err)
		}
		if !dagPaused(g) || g.Status == DagStatus_Cancelled {
			return nil
		}
		now := time.Now().UnixMilli()
		// the pause is a wait the stall clocks must not count, as an ask's is: a task silent through it is not hung
		for i := range g.Tasks {
			if t := &g.Tasks[i]; t.State == TaskState_Running {
				t.LastActivity, t.AskTs, t.ProgressTs = now, now, now
			}
		}
		g.PausedTs, g.UpdatedTs = 0, now
		RecomputeDagStatus(g)
		if err := wstore.UpdateDag(txCtx, dagID, func(cur *waveobj.TaskGroup) error {
			*cur = *g
			return nil
		}); err != nil {
			return err
		}
		seen := map[string]bool{}
		for _, runID := range DagRunIDs(g) {
			if seen[runID] {
				continue
			}
			seen[runID] = true
			if run, err := wstore.DBGet[*waveobj.Run](txCtx, runID); err != nil || run == nil || run.PausedUnder == "" {
				continue
			}
			if err := wstore.UpdateRun(txCtx, g.ChannelId, runID, func(r *waveobj.Run) error {
				r.PausedUnder = ""
				return nil
			}); err != nil {
				return fmt.Errorf("unmarking run %s: %w", runID, err)
			}
			runIDs = append(runIDs, runID)
		}
		resumed = g
		return nil
	})
	if err != nil || resumed == nil {
		return nil, err
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, dagID))
	for _, runID := range runIDs {
		wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Run, runID))
	}
	return resumed, nil
}

// ReopenSession reopens one suspended session with nudge as its first turn: in its own tab, or in a new tab when
// that tab was closed. Both ResumeDag and pkg/runpause call it.
func ReopenSession(ctx context.Context, s waveobj.PausedSession, nudge string) error {
	if s.WorkerORef == "" || s.SessionId == "" {
		return fmt.Errorf("reopening session of run %s: it recorded no tab or no session", s.RunId)
	}
	if !workerTabGone(ctx, s.WorkerORef) {
		return jarvis.ResumeRunWorker(ctx, s.WorkerORef, s.Runtime, s.SessionId, nudge)
	}
	run, err := wstore.DBGet[*waveobj.Run](ctx, s.RunId)
	if err != nil {
		return fmt.Errorf("loading run %s: %w", s.RunId, err)
	}
	if run == nil {
		return fmt.Errorf("run %s is gone", s.RunId)
	}
	// the phase that held the closed tab, not the running one: a resume of a failed phase is not this path's
	phaseIdx := slices.IndexFunc(run.Phases, func(p waveobj.RunPhase) bool { return slices.Contains(p.WorkerOrefs, s.WorkerORef) })
	if phaseIdx < 0 {
		return fmt.Errorf("run %s holds no phase whose worker is the closed tab %s", s.RunId, s.WorkerORef)
	}
	if err := resumeInNewTab(ctx, run, phaseIdx, s.WorkerORef, nudge); err != nil {
		return fmt.Errorf("reopening %s of run %s in a new tab: %w", s.WorkerORef, s.RunId, err)
	}
	sendRunUpdates(run.ChannelOID, run.ID)
	return nil
}
