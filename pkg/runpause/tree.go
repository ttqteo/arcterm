// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runpause

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// tree is a top-level run and everything its pause covers: the runs of its dag, every run its lead spawned (a quick
// run, or an orchestrator run with a dag, lead and workers of its own), and so on down. It is a read-only snapshot:
// the runs and dags are shared with the store's cache, and every write goes through wstore.UpdateRun and UpdateDag.
type tree struct {
	top     *waveobj.Run
	runs    []*waveobj.Run // every run of the tree, the top first
	byID    map[string]*waveobj.Run
	spawned map[string]bool // the runs a lead spawned (found by ParentLeadORef), not the dag's own
	dags    []*waveobj.TaskGroup
	owned   map[string]*waveobj.TaskGroup // owner run id -> the dag it owns
}

func (t *tree) add(r *waveobj.Run) bool {
	if _, ok := t.byID[r.ID]; ok {
		return false
	}
	t.byID[r.ID] = r
	t.runs = append(t.runs, r)
	return true
}

// walk reads the tree under the run topID of channelId. A child run is found by its ParentLeadORef naming a tab of a
// run already in the tree; a run that owns a dag brings the dag's runs (its tasks, reviewers, plan reviewers and final
// verifier). It repeats until nothing is added, since a child can bring a dag and a dag's worker can spawn a child.
func walk(ctx context.Context, channelId, topID string) (*tree, error) {
	all, err := wstore.GetChannelRunsShared(ctx, channelId)
	if err != nil {
		return nil, fmt.Errorf("listing the runs of channel %s: %w", channelId, err)
	}
	byID := make(map[string]*waveobj.Run, len(all))
	for _, r := range all {
		byID[r.ID] = r
	}
	top, ok := byID[topID]
	if !ok {
		return nil, fmt.Errorf("run %s not found in channel %s", topID, channelId)
	}
	t := &tree{top: top, byID: map[string]*waveobj.Run{top.ID: top}, runs: []*waveobj.Run{top},
		spawned: map[string]bool{}, owned: map[string]*waveobj.TaskGroup{}}
	dagsRead := map[string]*waveobj.TaskGroup{} // by oid; a task run names its owner's dag too, so one read answers them all
	for changed := true; changed; {
		changed = false
		tabs := map[string]bool{}
		for _, r := range t.runs {
			for _, p := range r.Phases {
				for _, w := range p.WorkerOrefs {
					tabs[w] = true
				}
			}
		}
		for _, r := range all {
			if r.ParentLeadORef != "" && tabs[r.ParentLeadORef] && t.add(r) {
				t.spawned[r.ID] = true
				changed = true
			}
		}
		for i := 0; i < len(t.runs); i++ {
			r := t.runs[i]
			if r.DagORef == "" || t.owned[r.ID] != nil {
				continue
			}
			g, ok := dagsRead[r.DagORef]
			if !ok {
				var err error
				if g, err = wstore.GetDagShared(ctx, r.DagORef); err != nil {
					return nil, fmt.Errorf("reading dag %s of run %s: %w", r.DagORef, r.ID, err)
				}
				dagsRead[r.DagORef] = g
			}
			if g.RunID != r.ID {
				continue // a task run of a dag whose owner brings it
			}
			t.dags = append(t.dags, g)
			t.owned[r.ID] = g
			for _, id := range orchestrate.DagRunIDs(g) {
				if run, ok := byID[id]; ok && t.add(run) {
					changed = true
				}
			}
		}
	}
	return t, nil
}

// runningPhase is the index of r's running phase, or -1.
func runningPhase(r *waveobj.Run) int {
	for i := range r.Phases {
		if r.Phases[i].State == jarvis.PhaseState_Running {
			return i
		}
	}
	return -1
}

// liveSession is the agent r has working now: the newest worker tab of its running phase, with what it takes to
// reopen it. A run with no running phase has none.
func liveSession(r *waveobj.Run) (waveobj.PausedSession, bool) {
	i := runningPhase(r)
	if i < 0 {
		return waveobj.PausedSession{}, false
	}
	workers := r.Phases[i].WorkerOrefs
	for j := len(workers) - 1; j >= 0; j-- {
		if strings.HasPrefix(workers[j], "tab:") {
			return waveobj.PausedSession{RunId: r.ID, WorkerORef: workers[j], Runtime: r.Runtime, SessionId: r.SessionId}, true
		}
	}
	return waveobj.PausedSession{}, false
}

// tabBlockIDs lists the blocks of a tab. A var so tests need no live tab; a closed tab holds none.
var tabBlockIDs = func(ctx context.Context, tabORef string) []string {
	oref, err := waveobj.ParseORef(tabORef)
	if err != nil || oref.OType != waveobj.OType_Tab {
		return nil
	}
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, oref.OID)
	if err != nil {
		log.Printf("runpause: reading tab %s: %v", tabORef, err)
		return nil
	}
	if tab == nil {
		return nil
	}
	return tab.BlockIds
}

// heldBytes is the RAM the tree holds now: the process tree of every live session block, plus every plan command
// (Setup, Check, Verify, Final) running for one of its runs.
func (t *tree) heldBytes(ctx context.Context) uint64 {
	var total uint64
	ids := make([]string, len(t.runs))
	for i, r := range t.runs {
		ids[i] = r.ID
		if s, ok := liveSession(r); ok {
			for _, blockId := range tabBlockIDs(ctx, s.WorkerORef) {
				total += blockTreeBytes(blockId)
			}
		}
	}
	return total + runCommandBytes(ids)
}

// stopPlan is what a pause stops: the dags that PauseDag handles (with every session of their runs), and the
// sessions outside them that it suspends itself.
type stopPlan struct {
	dags     []*waveobj.TaskGroup
	sessions []waveobj.PausedSession
}

// stopPlan splits the tree's work. A dag that is done or cancelled is left alone: it has no agent to stop, and a done
// dag can belong to a run whose lead still waits on its land, which is then a plain session here. It refuses a session
// that has no session id yet: nothing could reopen it, and a pause would lose the agent.
func (t *tree) stopPlan() (stopPlan, error) {
	var p stopPlan
	covered := map[string]bool{}
	for _, g := range t.dags {
		if g.Status == orchestrate.DagStatus_Done || g.Status == orchestrate.DagStatus_Cancelled {
			continue
		}
		p.dags = append(p.dags, g)
		for _, id := range orchestrate.DagRunIDs(g) {
			covered[id] = true
		}
	}
	for _, r := range t.runs {
		if covered[r.ID] {
			continue
		}
		s, ok := liveSession(r)
		if !ok {
			continue
		}
		if s.SessionId == "" {
			return p, fmt.Errorf("run %s has an agent with no session yet, which a resume could not reopen: try again in a moment", r.ID)
		}
		p.sessions = append(p.sessions, s)
	}
	return p, nil
}

// stopped is what a pause has stopped so far, for the rollback of a pause that fails part way.
type stopped struct {
	dags     []stoppedDag
	sessions []waveobj.PausedSession // suspended outside a dag
}

type stoppedDag struct {
	oid      string
	sessions []waveobj.PausedSession
}

func (s *stopped) all() []waveobj.PausedSession {
	var out []waveobj.PausedSession
	for _, d := range s.dags {
		out = append(out, d.sessions...)
	}
	return append(out, s.sessions...)
}

// stop stops what p names, after the marks are written: each dag through PauseDag, then each other session. It fills
// st as it goes, so a failure leaves st holding what has to be undone: a dag whose PauseDag failed is included, with
// whatever sessions it returned, since it may have marked itself and suspended some before it failed.
func (p stopPlan) stop(ctx context.Context, topID string, st *stopped) error {
	for _, g := range p.dags {
		sessions, err := pauseDag(ctx, g.OID, topID)
		st.dags = append(st.dags, stoppedDag{oid: g.OID, sessions: sessions})
		if err != nil {
			return fmt.Errorf("pausing dag %s: %w", g.OID, err)
		}
	}
	for _, s := range p.sessions {
		if err := suspendWorker(ctx, s.WorkerORef); err != nil {
			return fmt.Errorf("suspending the agent of run %s: %w", s.RunId, err)
		}
		st.sessions = append(st.sessions, s)
	}
	return nil
}

// undo puts back what st stopped and drops the pause, for a pause that failed. It does not note a resume, since the run
// never ran paused: LastResumedTs would hold a later automatic pause back for nothing. Errors are joined, not stopped on.
func (st *stopped) undo(ctx context.Context, t *tree) error {
	var errs []error
	for _, d := range st.dags {
		if err := resumeDag(ctx, d.oid, d.sessions); err != nil {
			errs = append(errs, fmt.Errorf("resuming dag %s: %w", d.oid, err))
		}
	}
	for _, s := range st.sessions {
		if err := reopen(ctx, s); err != nil {
			errs = append(errs, fmt.Errorf("reopening the agent of run %s: %w", s.RunId, err))
		}
	}
	if _, err := clearMarks(ctx, t.top.ChannelOID, t.top.ID, func(r *waveobj.Run) { jarvis.SetRunPause(r, nil) }); err != nil {
		errs = append(errs, fmt.Errorf("clearing the marks: %w", err))
	}
	return errors.Join(errs...)
}

// reopen reopens one suspended session with the paused nudge, which also hands it the answers given while it was
// paused (and consumes them: a reopen that fails does not get them back).
func reopen(ctx context.Context, s waveobj.PausedSession) error {
	return reopenSession(ctx, s, pausedNudge(ctx, s.WorkerORef))
}

// markTree writes the pause where every guard reads it, before anything is stopped: the Pause record on the top-level
// run and PausedUnder on every other run of the tree, in one transaction, so a failure marks nothing. The refusal is
// checked again on the row being written, since the run can have ended since it was read.
func markTree(ctx context.Context, t *tree, pause *waveobj.RunPause) error {
	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		txCtx := tx.Context()
		if err := wstore.UpdateRun(txCtx, t.top.ChannelOID, t.top.ID, func(r *waveobj.Run) error {
			if reason := pauseRefusal(r); reason != "" {
				return errors.New(reason)
			}
			jarvis.SetRunPause(r, pause)
			return nil
		}); err != nil {
			return err
		}
		for _, r := range t.runs[1:] {
			if err := wstore.UpdateRun(txCtx, t.top.ChannelOID, r.ID, func(cur *waveobj.Run) error {
				cur.PausedUnder = t.top.ID
				return nil
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

// clearMarks drops every PausedUnder mark under the top-level run topID and applies top to that run itself (nil leaves
// it alone), in one transaction. It reads the marks fresh, since a dag's resume may have cleared its own. It returns
// the ids of the runs it wrote.
func clearMarks(ctx context.Context, channelId, topID string, top func(*waveobj.Run)) ([]string, error) {
	t, err := walk(ctx, channelId, topID)
	if err != nil {
		return nil, err
	}
	var changed []string
	err = wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		txCtx := tx.Context()
		changed = nil
		if top != nil {
			if err := wstore.UpdateRun(txCtx, channelId, topID, func(r *waveobj.Run) error {
				top(r)
				return nil
			}); err != nil {
				return err
			}
			changed = append(changed, topID)
		}
		for _, r := range t.runs[1:] {
			if r.PausedUnder == "" {
				continue
			}
			if err := wstore.UpdateRun(txCtx, channelId, r.ID, func(cur *waveobj.Run) error {
				cur.PausedUnder = ""
				return nil
			}); err != nil {
				return err
			}
			changed = append(changed, r.ID)
		}
		return nil
	})
	return changed, err
}

// storeSessions keeps sessions in the top-level run's pause record: every session a pause suspended, and, while a
// resume goes, what it has not reopened yet, so a resume that fails part way is not repeated on what it already did.
func storeSessions(ctx context.Context, channelId, topID string, sessions []waveobj.PausedSession) error {
	return wstore.UpdateRun(ctx, channelId, topID, func(r *waveobj.Run) error {
		if r.Pause == nil {
			return fmt.Errorf("run %s is no longer paused", topID)
		}
		r.Pause.Sessions = sessions
		return nil
	})
}

// resumable drops the sessions of runs that ended while the run was paused (the person cancelled a task, say): a
// finished run's agent must stay closed.
func (t *tree) resumable(sessions []waveobj.PausedSession) []waveobj.PausedSession {
	var out []waveobj.PausedSession
	for _, s := range sessions {
		r, ok := t.byID[s.RunId]
		if !ok || r.Status == jarvis.RunStatus_Done || r.Status == jarvis.RunStatus_Cancelled {
			continue
		}
		out = append(out, s)
	}
	return out
}

// splitByDag divides sessions into those of the runs of g and the rest.
func splitByDag(sessions []waveobj.PausedSession, g *waveobj.TaskGroup) (mine, rest []waveobj.PausedSession) {
	own := map[string]bool{}
	for _, id := range orchestrate.DagRunIDs(g) {
		own[id] = true
	}
	for _, s := range sessions {
		if own[s.RunId] {
			mine = append(mine, s)
		} else {
			rest = append(rest, s)
		}
	}
	return mine, rest
}

// failRunningPhase fails the running phase of a run whose agent could not be reopened, so it reads blocked and the
// person can restart it, as after a failed restart. Nothing else would notice: its exit was ignored while it was paused.
func failRunningPhase(ctx context.Context, channelId, runId string) {
	err := wstore.UpdateRun(ctx, channelId, runId, func(r *waveobj.Run) error {
		i := runningPhase(r)
		if i < 0 {
			return nil
		}
		next, err := jarvis.FailPhase(*r, i, nowMs())
		if err != nil {
			return err
		}
		*r = next
		return nil
	})
	if err != nil {
		log.Printf("runpause: failing the phase of run %s whose agent could not be reopened: %v", runId, err)
	}
}

// cancelSpawned cancels a run the lead of a paused tree spawned. A run with a dag of its own goes through the dag's
// cancel, which stops every worker under it; any other run is cancelled and its worker stopped. Its agents are
// suspended, and nothing would ever resume them.
func (t *tree) cancelSpawned(ctx context.Context, r *waveobj.Run) error {
	if g := t.owned[r.ID]; g != nil && g.Status != orchestrate.DagStatus_Done && g.Status != orchestrate.DagStatus_Cancelled {
		if err := cancelDag(ctx, g.OID); err != nil {
			return fmt.Errorf("cancelling dag %s of run %s: %w", g.OID, r.ID, err)
		}
		return nil
	}
	if err := wstore.UpdateRun(ctx, r.ChannelOID, r.ID, func(cur *waveobj.Run) error {
		if cur.Status == jarvis.RunStatus_Done || cur.Status == jarvis.RunStatus_Cancelled {
			return nil
		}
		*cur = jarvis.CancelRun(*cur)
		return nil
	}); err != nil {
		return fmt.Errorf("cancelling run %s: %w", r.ID, err)
	}
	fresh, err := wstore.GetRun(ctx, r.ChannelOID, r.ID)
	if err != nil {
		return fmt.Errorf("reloading run %s: %w", r.ID, err)
	}
	if err := stopWorkers(ctx, fresh); err != nil {
		return fmt.Errorf("stopping the agent of run %s: %w", r.ID, err)
	}
	return nil
}
