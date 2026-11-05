// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package runpause pauses and resumes a whole top-level run tree: the run, every child run under it, and each dag's
// agents and commands. A pause frees the RAM the tree holds and keeps every worktree, commit and session; a resume
// reopens each agent in its own session. wshserver (the Pause and Resume buttons and `wsh runs pause`), the RAM
// regulator and the boot resume all call this one package, and the regulator cannot import wshserver.
//
// The order of a pause is its invariant: it marks before it stops anything. The top-level run's Pause record, each
// known child run's PausedUnder and each dag's PausedTs are written first, so every exit, outcome or tab-close that
// a stop causes already reads as paused. A pause that fails after the marks rolls itself back.
//
// A resume goes the other way round: each dag resumes first (which reopens its sessions and clears its own marks),
// then the sessions outside a dag are reopened, and the run's own record and the marks left are cleared last, so the
// run reads paused until every agent is back.
package runpause

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/runqueue"
	"github.com/wavetermdev/waveterm/pkg/util/keyedmutex"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// Who paused or resumed a run: Pause.By, and the "by" of the run-paused and run-resumed events.
const (
	By_Auto   = "auto"   // the RAM regulator
	By_Manual = "manual" // the person, from the UI or `wsh runs pause`
	By_Boot   = "boot"   // the resume at boot
)

// noFlapHold is how long the regulator leaves alone a run it paused again after a resume: every resume costs a full
// re-read of the agent's context, and a lapsed cache makes that a full cache write (spec decision 12).
const noFlapHold = 30 * time.Minute

// What the package calls in the engine and in jarvis, as vars so the tests need no live tab, dag or process.
var (
	pauseDag        = orchestrate.PauseDag
	resumeDag       = orchestrate.ResumeDag
	reopenSession   = orchestrate.ReopenSession
	cancelDag       = orchestrate.Cancel
	scheduleDag     = orchestrate.Schedule
	suspendWorker   = jarvis.SuspendRunWorker
	stopWorkers     = jarvis.StopRunWorkers
	pausedNudge     = jarvis.PausedNudge
	blockTreeBytes  = orchestrate.BlockTreeBytes
	runCommandBytes = orchestrate.RunCommandBytes
	readPressure    = jobqueue.ReadPressure

	// goAsync runs a tick off the caller's goroutine: a dag's tick can merge, run Setup and spawn, which no RPC budget
	// should wait on.
	goAsync = func(fn func()) { go fn() }
)

// treeLocks serializes the pause, resume and cancel-cleanup of one top-level run, so a regulator pause racing a
// button, or a resume racing either, finds the state the other left.
var treeLocks = keyedmutex.New()

func nowMs() int64 { return time.Now().UnixMilli() }

// checkBy refuses an initiator that is not one of the By_* constants: it is stored and shown.
func checkBy(by string) error {
	switch by {
	case By_Auto, By_Manual, By_Boot:
		return nil
	}
	return fmt.Errorf("unknown initiator %q", by)
}

// pauseRefusal is why r cannot be paused, or "" when it can. The words reach the person, through the CLI or the UI.
func pauseRefusal(r *waveobj.Run) string {
	switch {
	case !runqueue.TopLevel(r):
		return fmt.Sprintf("run %s is not a top-level run: only a run you started can be paused, with everything under it", r.ID)
	case r.Status == jarvis.RunStatus_Done:
		return fmt.Sprintf("run %s is done: there is nothing left to pause", r.ID)
	case r.Status == jarvis.RunStatus_Cancelled:
		return fmt.Sprintf("run %s is cancelled: there is nothing left to pause", r.ID)
	case r.Pause != nil || r.Status == jarvis.RunStatus_Paused:
		return fmt.Sprintf("run %s is already paused", r.ID)
	}
	return ""
}

// Pause pauses the top-level run runId and everything under it, by who (By_*). It refuses a run that is not
// top-level, or is done, cancelled or already paused, with a reason the CLI and the UI can show.
//
// It marks first (the run's Pause record, each other run's PausedUnder; PauseDag marks its dag), then stops the dags
// and the sessions outside them, then keeps the sessions it suspended for the resume. A failure after the marks puts
// everything back and returns the error.
func Pause(ctx context.Context, channelId, runId, by string) error {
	if err := checkBy(by); err != nil {
		return fmt.Errorf("pausing run %s: %w", runId, err)
	}
	treeLocks.Lock(runId)
	defer treeLocks.Unlock(runId)

	t, err := walk(ctx, channelId, runId)
	if err != nil {
		return fmt.Errorf("pausing run %s: %w", runId, err)
	}
	if reason := pauseRefusal(t.top); reason != "" {
		return errors.New(reason)
	}
	plan, err := t.stopPlan()
	if err != nil {
		return err
	}
	now := nowMs()
	pause := &waveobj.RunPause{PausedTs: now, By: by, HeldBytes: t.heldBytes(ctx)}
	if by == By_Auto && t.top.LastResumedTs != 0 {
		pause.NoAutoResumeUntil = now + noFlapHold.Milliseconds()
	}
	if err := markTree(ctx, t, pause); err != nil {
		return fmt.Errorf("marking run %s paused: %w", runId, err)
	}

	var st stopped
	err = plan.stop(ctx, runId, &st)
	if err == nil {
		err = storeSessions(ctx, channelId, runId, st.all())
	}
	if err != nil {
		err = fmt.Errorf("pausing run %s: %w", runId, err)
		if uerr := st.undo(ctx, t); uerr != nil {
			err = errors.Join(err, fmt.Errorf("rolling the pause back: %w", uerr))
		}
		publishUpdates(channelId, runIDs(t)...)
		return err
	}
	appendEvent(ctx, channelId, runId, waveobj.RunEventKindRunPaused, map[string]any{"by": by, "heldbytes": pause.HeldBytes})
	publishUpdates(channelId, runIDs(t)...)
	return nil
}

// Resume reopens every session a pause suspended and carries the run on. It refuses a run that is not paused.
//
// Each paused dag resumes first, with the sessions of its own runs; the sessions outside a dag are reopened next; then
// the run's record and the marks left are cleared, so the run reads paused until every agent is back. A dag that fails
// to resume stops the resume and leaves the run paused; what already reopened is not reopened again by a retry. An agent
// that cannot be reopened fails its phase instead, so the run reads blocked and the person can restart it.
func Resume(ctx context.Context, channelId, runId, by string) error {
	if err := checkBy(by); err != nil {
		return fmt.Errorf("resuming run %s: %w", runId, err)
	}
	treeLocks.Lock(runId)
	defer treeLocks.Unlock(runId)

	t, err := walk(ctx, channelId, runId)
	if err != nil {
		return fmt.Errorf("resuming run %s: %w", runId, err)
	}
	if t.top.Pause == nil || t.top.Status != jarvis.RunStatus_Paused {
		return fmt.Errorf("run %s is not paused", runId)
	}
	sessions := t.resumable(t.top.Pause.Sessions)
	var resumed []string
	for _, g := range t.dags {
		if g.PausedTs == 0 {
			continue
		}
		mine, rest := splitByDag(sessions, g)
		if err := resumeDag(ctx, g.OID, mine); err != nil {
			return fmt.Errorf("resuming run %s: dag %s: %w", runId, g.OID, err)
		}
		resumed = append(resumed, g.OID)
		sessions = rest
		if err := storeSessions(ctx, channelId, runId, sessions); err != nil {
			log.Printf("runpause: keeping what run %s has left to reopen: %v", runId, err)
		}
	}
	for _, s := range sessions {
		if err := reopen(ctx, s); err != nil {
			log.Printf("runpause: reopening the agent of run %s while resuming run %s: %v", s.RunId, runId, err)
			failRunningPhase(ctx, channelId, s.RunId)
		}
	}
	changed, err := clearMarks(ctx, channelId, runId, func(r *waveobj.Run) { jarvis.ClearRunPause(r, nowMs()) })
	if err != nil {
		return fmt.Errorf("resuming run %s: clearing its pause: %w", runId, err)
	}
	appendEvent(ctx, channelId, runId, waveobj.RunEventKindRunResumed, map[string]any{"by": by})
	publishUpdates(channelId, append(changed, runIDs(t)...)...)
	// each dag's own resume ticked it while its runs were still marked; tick once more now that nothing is
	tickCtx := context.WithoutCancel(ctx)
	for _, oid := range resumed {
		goAsync(func() {
			if err := scheduleDag(tickCtx, oid); err != nil {
				log.Printf("runpause: ticking dag %s after run %s resumed: %v", oid, runId, err)
			}
		})
	}
	return nil
}

// ResumeAtBoot runs once at startup: every paused top-level run resumes with By_Boot, unless memory is already
// tight, when each stays paused for the regulator. Errors are logged per run.
func ResumeAtBoot(ctx context.Context) {
	if p := readPressure(ctx); p == jobqueue.PressureWarn || p == jobqueue.PressureCritical {
		log.Printf("runpause: memory is tight at startup: paused runs stay paused until it frees")
		return
	}
	runs, err := wstore.GetRunsByStatus(ctx, jarvis.RunStatus_Paused)
	if err != nil {
		log.Printf("runpause: listing the paused runs to resume at startup: %v", err)
		return
	}
	for _, r := range runs {
		if !runqueue.TopLevel(r) {
			continue
		}
		if err := Resume(ctx, r.ChannelOID, r.ID, By_Boot); err != nil {
			log.Printf("runpause: resuming run %s at startup: %v", r.ID, err)
		}
	}
}

// HeldBytes is the RAM runId's tree holds now (every live agent's process tree and every running plan command's), for
// the regulator to rank its candidates.
func HeldBytes(ctx context.Context, channelId, runId string) (uint64, error) {
	t, err := walk(ctx, channelId, runId)
	if err != nil {
		return 0, fmt.Errorf("measuring run %s: %w", runId, err)
	}
	return t.heldBytes(ctx), nil
}

// ClearOnCancel is what a cancel of a paused run leaves to do: clear every PausedUnder mark under the run, and
// cancel each lead-spawned child run that is not done, since its agents are suspended and nothing would resume them.
// It also clears the PausedTs of a dag the dag cancel did not reach. Call it after the run's own cancel; it refuses a
// run that is not cancelled, which would wipe a live pause, and does nothing for a run that is not top-level or that
// carries no pause. A failure on one child does not stop the rest; the errors are joined.
func ClearOnCancel(ctx context.Context, channelId, runId string) error {
	treeLocks.Lock(runId)
	defer treeLocks.Unlock(runId)

	t, err := walk(ctx, channelId, runId)
	if err != nil {
		return fmt.Errorf("clearing run %s after its cancel: %w", runId, err)
	}
	if !runqueue.TopLevel(t.top) {
		return nil
	}
	if t.top.Status != jarvis.RunStatus_Cancelled {
		return fmt.Errorf("run %s is not cancelled", runId)
	}
	if !t.carriesPause() {
		return nil
	}
	var errs []error
	var cancelled []string
	for _, r := range t.runs {
		if !t.spawned[r.ID] || r.Status == jarvis.RunStatus_Done || r.Status == jarvis.RunStatus_Cancelled {
			continue
		}
		if err := t.cancelSpawned(ctx, r); err != nil {
			errs = append(errs, err)
			continue
		}
		cancelled = append(cancelled, r.ID)
		appendEvent(ctx, channelId, r.ID, waveobj.RunEventKindRunCancelled, map[string]any{})
	}
	for _, g := range t.dags {
		if g.PausedTs == 0 {
			continue
		}
		if err := wstore.UpdateDag(ctx, g.OID, func(d *waveobj.TaskGroup) error {
			d.PausedTs = 0
			orchestrate.RecomputeDagStatus(d)
			return nil
		}); err != nil {
			errs = append(errs, fmt.Errorf("clearing the pause of dag %s: %w", g.OID, err))
		}
	}
	changed, err := clearMarks(ctx, channelId, runId, nil)
	if err != nil {
		errs = append(errs, fmt.Errorf("clearing the marks under run %s: %w", runId, err))
	}
	publishUpdates(channelId, append(changed, cancelled...)...)
	return errors.Join(errs...)
}

// carriesPause reports a tree that still holds something a pause left: a run marked under the top-level one, or a dag
// with its PausedTs set.
func (t *tree) carriesPause() bool {
	for _, r := range t.runs[1:] {
		if r.PausedUnder != "" {
			return true
		}
	}
	for _, g := range t.dags {
		if g.PausedTs != 0 {
			return true
		}
	}
	return false
}

func runIDs(t *tree) []string {
	ids := make([]string, len(t.runs))
	for i, r := range t.runs {
		ids[i] = r.ID
	}
	return ids
}

// publishUpdates tells the app that these runs, and so their channel, changed.
func publishUpdates(channelId string, runIds ...string) {
	for _, id := range runIds {
		wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Run, id))
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, channelId))
}

// appendEvent records a run event and broadcasts it to the run's view, as the RPC handlers do. Best effort: the
// transition it records has already happened, so a failure is logged.
func appendEvent(ctx context.Context, channelId, runId, kind string, detail any) {
	ev, err := wstore.AppendRunEvent(ctx, channelId, runId, kind, nil, detail)
	if err != nil {
		log.Printf("runpause: appending %s to run %s: %v", kind, runId, err)
		return
	}
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_RunEvent,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Run, runId).String()},
		Data:   wshrpc.RunEventData{ChannelId: channelId, RunId: runId, Event: ev},
	})
}
