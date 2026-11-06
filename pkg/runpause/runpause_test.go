// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runpause

import (
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/runqueue"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// TestMain gives the tests a real store in a throwaway data dir, as pkg/jarvis and pkg/orchestrate do.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "runpause-test-*")
	if err != nil {
		panic(err)
	}
	wavebase.DataHome_VarCache = dir
	if err := wavebase.EnsureWaveDBDir(); err != nil {
		panic(err)
	}
	if err := wstore.InitWStore(); err != nil {
		panic(err)
	}
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

// fixture is a channel in the real store and fakes for everything that would touch a live tab or a live dag. The fakes
// record each call in order and, for the two that stop things, check the marks are already in the store: the pause
// order is the invariant under test.
type fixture struct {
	t   *testing.T
	ctx context.Context
	ch  *waveobj.Channel

	calls []string

	// the run ids and the top-level run the marks are checked against when something is stopped
	topID      string
	marked     []string
	markedDags []string

	dagErr     map[string]error // dag oid -> what pauseDag returns for it
	suspendErr map[string]error // tab oref -> what suspendWorker returns for it
	reopenErr  map[string]error // tab oref -> what reopenSession returns for it
	resumeErr  map[string]error // dag oid -> what resumeDag returns for it

	blockBytes map[string]uint64 // block id -> bytes
	cmdBytes   map[string]uint64 // run id -> bytes
	pressure   jobqueue.Pressure
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "runpause-"+uuid.NewString(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{
		t: t, ctx: ctx, ch: ch,
		dagErr: map[string]error{}, suspendErr: map[string]error{}, reopenErr: map[string]error{}, resumeErr: map[string]error{},
		blockBytes: map[string]uint64{}, cmdBytes: map[string]uint64{}, pressure: jobqueue.PressureNormal,
	}
	restore := swapSeams()
	t.Cleanup(restore)

	pauseDag = func(ctx context.Context, dagID, topRunID string) ([]waveobj.PausedSession, error) {
		f.record("pauseDag " + dagID)
		f.checkMarked("pauseDag " + dagID)
		var sessions []waveobj.PausedSession
		g, err := wstore.GetDag(ctx, dagID)
		if err != nil {
			return nil, err
		}
		if err := wstore.UpdateDag(ctx, dagID, func(d *waveobj.TaskGroup) error {
			d.PausedTs = time.Now().UnixMilli()
			return nil
		}); err != nil {
			return nil, err
		}
		for _, id := range orchestrate.DagRunIDs(g) {
			run, err := wstore.GetRun(ctx, g.ChannelId, id)
			if err != nil {
				return nil, err
			}
			if s, ok := liveSession(run); ok {
				sessions = append(sessions, s)
			}
		}
		return sessions, f.dagErr[dagID]
	}
	resumeDag = func(ctx context.Context, dagID string, sessions []waveobj.PausedSession) error {
		f.record("resumeDag " + dagID + " [" + sessionTabs(sessions) + "]")
		if err := f.resumeErr[dagID]; err != nil {
			return err
		}
		return wstore.UpdateDag(ctx, dagID, func(d *waveobj.TaskGroup) error {
			d.PausedTs = 0
			return nil
		})
	}
	reopenSession = func(ctx context.Context, s waveobj.PausedSession, nudge string) error {
		f.record("reopen " + s.WorkerORef + " nudge=" + nudge)
		return f.reopenErr[s.WorkerORef]
	}
	suspendWorker = func(ctx context.Context, workerORef string) error {
		f.record("suspend " + workerORef)
		f.checkMarked("suspend " + workerORef)
		return f.suspendErr[workerORef]
	}
	stopWorkers = func(ctx context.Context, run *waveobj.Run) error {
		f.record("stop " + run.ID)
		return nil
	}
	cancelDag = func(ctx context.Context, dagID string) error {
		f.record("cancelDag " + dagID)
		// the real cancel also drops each run's pause mark and the dag's PausedTs (CancelGroup); this one leaves the
		// dag's PausedTs, so the test sees ClearOnCancel clear what the cancel did not reach
		g, err := wstore.GetDag(ctx, dagID)
		if err != nil {
			return err
		}
		for _, id := range orchestrate.DagRunIDs(g) {
			if err := wstore.UpdateRun(ctx, g.ChannelId, id, func(r *waveobj.Run) error {
				if r.Status != jarvis.RunStatus_Done {
					*r = jarvis.CancelRun(*r)
				}
				return nil
			}); err != nil {
				return err
			}
		}
		return wstore.UpdateDag(ctx, dagID, func(d *waveobj.TaskGroup) error {
			d.Status = orchestrate.DagStatus_Cancelled
			return nil
		})
	}
	scheduleDag = func(ctx context.Context, dagID string) error {
		f.record("schedule " + dagID)
		return nil
	}
	goAsync = func(fn func()) { fn() }
	pausedNudge = func(ctx context.Context, workerORef string) string { return "nudge" }
	blockTreeBytes = func(blockId string) uint64 { return f.blockBytes[blockId] }
	runCommandBytes = func(runIDs []string) uint64 {
		var n uint64
		for _, id := range runIDs {
			n += f.cmdBytes[id]
		}
		return n
	}
	tabBlockIDs = func(ctx context.Context, tabORef string) []string { return []string{"blk-" + tabORef} }
	readPressure = func(context.Context) jobqueue.Pressure { return f.pressure }
	return f
}

// swapSeams returns a func that puts back every seam the fixture replaces.
func swapSeams() func() {
	p, r, o, s, sw, cd, sd, ga, pn, bb, rb, tb, rp := pauseDag, resumeDag, reopenSession, suspendWorker, stopWorkers, cancelDag,
		scheduleDag, goAsync, pausedNudge, blockTreeBytes, runCommandBytes, tabBlockIDs, readPressure
	return func() {
		pauseDag, resumeDag, reopenSession, suspendWorker, stopWorkers, cancelDag = p, r, o, s, sw, cd
		scheduleDag, goAsync, pausedNudge, blockTreeBytes, runCommandBytes, tabBlockIDs, readPressure = sd, ga, pn, bb, rb, tb, rp
	}
}

func sessionTabs(sessions []waveobj.PausedSession) string {
	tabs := make([]string, len(sessions))
	for i, s := range sessions {
		tabs[i] = s.WorkerORef
	}
	return strings.Join(tabs, ",")
}

func (f *fixture) record(call string) { f.calls = append(f.calls, call) }

// callsWith lists the recorded calls that start with prefix, in order.
func (f *fixture) callsWith(prefix string) []string {
	var out []string
	for _, c := range f.calls {
		if strings.HasPrefix(c, prefix) {
			out = append(out, c)
		}
	}
	return out
}

// checkMarked fails the test unless the pause is already in the store: the top-level record, every expected child's
// mark and, once the dag is being stopped, the dag's pause.
func (f *fixture) checkMarked(what string) {
	f.t.Helper()
	top, err := wstore.GetRun(f.ctx, f.ch.OID, f.topID)
	if err != nil {
		f.t.Errorf("%s: %v", what, err)
		return
	}
	if top.Pause == nil || top.Status != jarvis.RunStatus_Paused {
		f.t.Errorf("%s ran before the top-level run was marked paused (status %q)", what, top.Status)
	}
	for _, id := range f.marked {
		if r := f.get(id); r.PausedUnder != f.topID {
			f.t.Errorf("%s ran before run %s was marked paused under the top (PausedUnder %q)", what, id, r.PausedUnder)
		}
	}
}

func (f *fixture) get(id string) *waveobj.Run {
	f.t.Helper()
	r, err := wstore.GetRun(f.ctx, f.ch.OID, id)
	if err != nil {
		f.t.Fatal(err)
	}
	return r
}

func (f *fixture) dag(oid string) *waveobj.TaskGroup {
	f.t.Helper()
	g, err := wstore.GetDag(f.ctx, oid)
	if err != nil {
		f.t.Fatal(err)
	}
	return g
}

// run stores a run with one running phase whose worker is a tab of its own, and a session.
func (f *fixture) run(mut ...func(*waveobj.Run)) *waveobj.Run {
	f.t.Helper()
	r := jarvis.NewRun("goal", "ws-1", f.ch.ProjectPath, nil, jarvis.RunMode_Quick,
		[]waveobj.RunPhase{{Kind: jarvis.PhaseKind_Execute, State: jarvis.PhaseState_Pending}}, 1)
	r.Phases[0].WorkerOrefs = []string{"tab:" + uuid.NewString()}
	r.Runtime = "claude"
	r.SessionId = "sess-" + r.ID
	for _, m := range mut {
		m(&r)
	}
	if err := wstore.AppendRun(f.ctx, f.ch.OID, r); err != nil {
		f.t.Fatal(err)
	}
	return &r
}

func tabOf(r *waveobj.Run) string { return r.Phases[0].WorkerOrefs[0] }

// orchestrator stores an orchestrator run (its lead is the run's own session) with a dag of n tasks, each with a
// worker run. parentTab, when set, makes it a run another lead spawned.
func (f *fixture) orchestrator(parentTab string, n int) (*waveobj.Run, *waveobj.TaskGroup, []*waveobj.Run) {
	f.t.Helper()
	lead := jarvis.NewRun("lead goal", "ws-1", f.ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	lead.Phases[0].WorkerOrefs = []string{"tab:" + uuid.NewString()}
	lead.Runtime = "claude"
	lead.SessionId = "sess-" + lead.ID
	lead.ParentLeadORef = parentTab
	var tasks []waveobj.TaskNode
	for i := range n {
		tasks = append(tasks, waveobj.TaskNode{ID: fmt.Sprintf("t-%d", i), Label: "task"})
	}
	g, err := orchestrate.NewTaskGroup(lead.ID, f.ch.OID, "g", n, false, tasks, 1, nil)
	if err != nil {
		f.t.Fatal(err)
	}
	if err := wstore.AppendDag(f.ctx, &g); err != nil {
		f.t.Fatal(err)
	}
	lead.DagORef = g.OID
	if err := wstore.AppendRun(f.ctx, f.ch.OID, lead); err != nil {
		f.t.Fatal(err)
	}
	var workers []*waveobj.Run
	for i := range n {
		w := f.run(func(r *waveobj.Run) {
			r.DagORef = g.OID
			r.TaskId = fmt.Sprintf("t-%d", i)
		})
		workers = append(workers, w)
	}
	if err := wstore.UpdateDag(f.ctx, g.OID, func(d *waveobj.TaskGroup) error {
		for i, w := range workers {
			d.Tasks[i].RunID = w.ID
			d.Tasks[i].State = "running"
		}
		return nil
	}); err != nil {
		f.t.Fatal(err)
	}
	return &lead, f.dag(g.OID), workers
}

// expectMarked says which runs the stop calls must find marked, and under which top-level run.
func (f *fixture) expectMarked(top *waveobj.Run, others ...*waveobj.Run) {
	f.topID = top.ID
	f.marked = nil
	for _, r := range others {
		f.marked = append(f.marked, r.ID)
	}
}

func (f *fixture) events(runID, kind string) int {
	f.t.Helper()
	evs, err := wstore.QueryRunEventsByKind(f.ctx, f.ch.OID, runID, []string{kind}, 20)
	if err != nil {
		f.t.Fatal(err)
	}
	return len(evs)
}

func wantErr(t *testing.T, err error, contains string) {
	t.Helper()
	if err == nil {
		t.Fatalf("want an error containing %q, got none", contains)
	}
	if !strings.Contains(err.Error(), contains) {
		t.Fatalf("error %q does not contain %q", err, contains)
	}
}

func TestPauseRefusesWhatIsNotAnActiveTopLevelRun(t *testing.T) {
	f := newFixture(t)
	parent := f.run()
	cases := []struct {
		name string
		run  *waveobj.Run
		want string
	}{
		{"a child run", f.run(func(r *waveobj.Run) { r.ParentLeadORef = tabOf(parent) }), "top-level"},
		{"a task worker", f.run(func(r *waveobj.Run) { r.TaskId = "t-0" }), "top-level"},
		{"a reviewer", f.run(func(r *waveobj.Run) { r.TaskId = "t-0"; r.Review = true }), "top-level"},
		{"a stage session", f.run(func(r *waveobj.Run) { r.StageRole = "final-verifier" }), "top-level"},
		{"a done run", f.run(func(r *waveobj.Run) { r.Phases[0].State = jarvis.PhaseState_Done; r.Status = jarvis.RunStatus_Done }), "done"},
		{"a cancelled run", f.run(func(r *waveobj.Run) { *r = jarvis.CancelRun(*r) }), "cancelled"},
		{"a paused run", f.run(func(r *waveobj.Run) { jarvis.SetRunPause(r, &waveobj.RunPause{PausedTs: 1, By: By_Manual}) }), "already paused"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			before := len(f.calls)
			wantErr(t, Pause(f.ctx, f.ch.OID, c.run.ID, By_Manual), c.want)
			if len(f.calls) != before {
				t.Errorf("a refused pause stopped something: %v", f.calls[before:])
			}
			if got := f.get(c.run.ID); got.PausedUnder != "" {
				t.Errorf("a refused pause marked the run: %q", got.PausedUnder)
			}
		})
	}
}

func TestPauseRefusesAnAgentThatHasNoSessionYet(t *testing.T) {
	f := newFixture(t)
	r := f.run(func(r *waveobj.Run) { r.SessionId = "" })
	wantErr(t, Pause(f.ctx, f.ch.OID, r.ID, By_Manual), "session")
	if len(f.calls) != 0 {
		t.Errorf("stopped %v", f.calls)
	}
	if got := f.get(r.ID); got.Pause != nil || got.Status == jarvis.RunStatus_Paused {
		t.Errorf("the run was marked paused: %+v", got.Pause)
	}
}

func TestPauseASingleQuickRunSuspendsItsWorkerAndKeepsTheSession(t *testing.T) {
	f := newFixture(t)
	r := f.run()
	f.expectMarked(r)
	f.blockBytes["blk-"+tabOf(r)] = 700

	if err := Pause(f.ctx, f.ch.OID, r.ID, By_Manual); err != nil {
		t.Fatal(err)
	}
	if got := f.calls; len(got) != 1 || got[0] != "suspend "+tabOf(r) {
		t.Fatalf("calls = %v, want just the suspend of the worker", got)
	}
	got := f.get(r.ID)
	if got.Status != jarvis.RunStatus_Paused || got.Pause == nil {
		t.Fatalf("run reads %q with pause %+v", got.Status, got.Pause)
	}
	want := waveobj.PausedSession{RunId: r.ID, WorkerORef: tabOf(r), Runtime: "claude", SessionId: r.SessionId}
	if len(got.Pause.Sessions) != 1 || got.Pause.Sessions[0] != want {
		t.Errorf("sessions = %+v, want %+v kept", got.Pause.Sessions, want)
	}
	if got.Pause.By != By_Manual || got.Pause.HeldBytes != 700 || got.Pause.PausedTs == 0 {
		t.Errorf("pause = %+v, want by manual, 700 bytes held", got.Pause)
	}
	if got.Pause.NoAutoResumeUntil != 0 {
		t.Errorf("a first manual pause holds nothing back: %d", got.Pause.NoAutoResumeUntil)
	}
	if n := f.events(r.ID, waveobj.RunEventKindRunPaused); n != 1 {
		t.Errorf("run-paused events = %d, want 1", n)
	}
	// a paused run still holds its place against runs:maxactive
	if n := runqueue.Active([]*waveobj.Run{got}); n != 1 {
		t.Errorf("runqueue.Active counts the paused run %d times, want 1", n)
	}
	// and a second pause is refused
	wantErr(t, Pause(f.ctx, f.ch.OID, r.ID, By_Auto), "already paused")
}

func TestPauseAnOrchestratorTreePausesBothDagsAndMarksTheChild(t *testing.T) {
	f := newFixture(t)
	top, topDag, topTasks := f.orchestrator("", 2)
	child, childDag, childTasks := f.orchestrator(tabOf(top), 1) // a run the top's lead spawned, with a dag of its own
	quick := f.run(func(r *waveobj.Run) { r.ParentLeadORef = tabOf(top) })
	unrelated := f.run()
	f.expectMarked(top, child, topTasks[0], topTasks[1], childTasks[0], quick)

	// the RAM held: every live session block, and every plan command of the tree's runs
	f.blockBytes["blk-"+tabOf(top)] = 100
	f.blockBytes["blk-"+tabOf(topTasks[0])] = 10
	f.blockBytes["blk-"+tabOf(topTasks[1])] = 20
	f.blockBytes["blk-"+tabOf(child)] = 1000
	f.blockBytes["blk-"+tabOf(childTasks[0])] = 2000
	f.blockBytes["blk-"+tabOf(quick)] = 4000
	f.blockBytes["blk-"+tabOf(unrelated)] = 999999 // not in the tree
	f.cmdBytes[top.ID] = 50000
	f.cmdBytes[childTasks[0].ID] = 100000

	if err := Pause(f.ctx, f.ch.OID, top.ID, By_Auto); err != nil {
		t.Fatal(err)
	}
	if got := f.callsWith("pauseDag"); !slices.Equal(got, []string{"pauseDag " + topDag.OID, "pauseDag " + childDag.OID}) {
		t.Fatalf("pauseDag calls = %v, want both dags", got)
	}
	if got := f.callsWith("suspend"); !slices.Equal(got, []string{"suspend " + tabOf(quick)}) {
		t.Fatalf("suspend calls = %v, want only the quick run outside a dag", got)
	}
	topNow := f.get(top.ID)
	const wantHeld = 100 + 10 + 20 + 1000 + 2000 + 4000 + 50000 + 100000
	if topNow.Pause == nil || topNow.Pause.HeldBytes != wantHeld {
		t.Fatalf("held = %+v, want %d across every tree", topNow.Pause, wantHeld)
	}
	if topNow.Pause.By != By_Auto {
		t.Errorf("by = %q", topNow.Pause.By)
	}
	for _, r := range []*waveobj.Run{child, topTasks[0], topTasks[1], childTasks[0], quick} {
		if got := f.get(r.ID); got.PausedUnder != top.ID || !jarvis.RunPaused(got) {
			t.Errorf("run %s PausedUnder = %q", r.ID, got.PausedUnder)
		}
	}
	if got := f.get(unrelated.ID); got.PausedUnder != "" || got.Status == jarvis.RunStatus_Paused {
		t.Errorf("a run outside the tree was marked: %+v", got)
	}
	// every session PauseDag suspended and every one suspended here is kept, for the resume
	var tabs []string
	for _, s := range topNow.Pause.Sessions {
		tabs = append(tabs, s.WorkerORef)
	}
	slices.Sort(tabs)
	wantTabs := []string{tabOf(top), tabOf(topTasks[0]), tabOf(topTasks[1]), tabOf(child), tabOf(childTasks[0]), tabOf(quick)}
	slices.Sort(wantTabs)
	if !slices.Equal(tabs, wantTabs) {
		t.Errorf("sessions = %v, want %v", tabs, wantTabs)
	}
	if h, err := HeldBytes(f.ctx, f.ch.OID, top.ID); err != nil || h != wantHeld {
		t.Errorf("HeldBytes = %d, %v, want %d", h, err, wantHeld)
	}
	if n := f.events(top.ID, waveobj.RunEventKindRunPaused); n != 1 {
		t.Errorf("run-paused events = %d", n)
	}
}

func TestPauseSkipsADoneDagAndSuspendsItsLeadAsAPlainSession(t *testing.T) {
	f := newFixture(t)
	lead, g, tasks := f.orchestrator("", 1)
	// every task landed, so no worker is left: only the lead, which waits on its land
	if err := wstore.UpdateRun(f.ctx, f.ch.OID, tasks[0].ID, func(r *waveobj.Run) error {
		r.Phases[0].State = jarvis.PhaseState_Done
		r.Status = jarvis.RunStatus_Done
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(f.ctx, g.OID, func(d *waveobj.TaskGroup) error {
		d.Status = orchestrate.DagStatus_Done
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	f.expectMarked(lead)

	if err := Pause(f.ctx, f.ch.OID, lead.ID, By_Manual); err != nil {
		t.Fatal(err)
	}
	if got := f.callsWith("pauseDag"); len(got) != 0 {
		t.Errorf("a done dag was paused: %v", got)
	}
	// the lead waits on its land: it is suspended like any session outside a dag
	if got := f.callsWith("suspend"); !slices.Equal(got, []string{"suspend " + tabOf(lead)}) {
		t.Errorf("suspend calls = %v, want the lead", got)
	}
	if got := f.get(lead.ID); got.Status != jarvis.RunStatus_Paused {
		t.Errorf("lead reads %q", got.Status)
	}
}

func TestAnAutoPauseAfterAResumeHoldsTheRunBackFor30Minutes(t *testing.T) {
	f := newFixture(t)
	r := f.run()
	f.expectMarked(r)
	if err := Pause(f.ctx, f.ch.OID, r.ID, By_Auto); err != nil {
		t.Fatal(err)
	}
	if got := f.get(r.ID).Pause; got.NoAutoResumeUntil != 0 {
		t.Fatalf("a run never resumed has no hold: %d", got.NoAutoResumeUntil)
	}
	if err := Resume(f.ctx, f.ch.OID, r.ID, By_Manual); err != nil {
		t.Fatal(err)
	}

	before := time.Now().UnixMilli()
	if err := Pause(f.ctx, f.ch.OID, r.ID, By_Auto); err != nil {
		t.Fatal(err)
	}
	p := f.get(r.ID).Pause
	if lo, hi := before+noFlapHold.Milliseconds(), time.Now().UnixMilli()+noFlapHold.Milliseconds(); p.NoAutoResumeUntil < lo || p.NoAutoResumeUntil > hi {
		t.Errorf("hold until %d, want about 30 minutes from now (%d..%d)", p.NoAutoResumeUntil, lo, hi)
	}
	// a manual pause of a resumed run holds nothing back
	if err := Resume(f.ctx, f.ch.OID, r.ID, By_Manual); err != nil {
		t.Fatal(err)
	}
	if err := Pause(f.ctx, f.ch.OID, r.ID, By_Manual); err != nil {
		t.Fatal(err)
	}
	if p := f.get(r.ID).Pause; p.NoAutoResumeUntil != 0 {
		t.Errorf("a manual pause holds the run back until %d", p.NoAutoResumeUntil)
	}
}

func TestPauseRollsBackWhenAPauseDagFails(t *testing.T) {
	f := newFixture(t)
	top, topDag, topTasks := f.orchestrator("", 1)
	child, childDag, _ := f.orchestrator(tabOf(top), 1)
	f.dagErr[childDag.OID] = errors.New("boom")
	f.expectMarked(top, child, topTasks[0])

	err := Pause(f.ctx, f.ch.OID, top.ID, By_Auto)
	wantErr(t, err, "boom")
	// the dag that paused is resumed with its sessions, the one that failed too, and nothing is left marked
	resumed := f.callsWith("resumeDag")
	if len(resumed) != 2 || !strings.HasPrefix(resumed[0], "resumeDag "+topDag.OID) || !strings.HasPrefix(resumed[1], "resumeDag "+childDag.OID) {
		t.Errorf("resumeDag calls = %v", resumed)
	}
	if !strings.Contains(resumed[0], tabOf(top)) || !strings.Contains(resumed[0], tabOf(topTasks[0])) {
		t.Errorf("the paused dag was resumed without its sessions: %s", resumed[0])
	}
	got := f.get(top.ID)
	if got.Pause != nil || got.Status == jarvis.RunStatus_Paused || got.LastResumedTs != 0 {
		t.Errorf("top after a failed pause: status %q pause %+v lastresumed %d", got.Status, got.Pause, got.LastResumedTs)
	}
	for _, r := range []*waveobj.Run{child, topTasks[0]} {
		if f.get(r.ID).PausedUnder != "" {
			t.Errorf("run %s is still marked", r.ID)
		}
	}
	if n := f.events(top.ID, waveobj.RunEventKindRunPaused); n != 0 {
		t.Errorf("a failed pause recorded run-paused")
	}
}

func TestPauseRollsBackWhenASuspendFails(t *testing.T) {
	f := newFixture(t)
	top, _, _ := f.orchestrator("", 1)
	a := f.run(func(r *waveobj.Run) { r.ParentLeadORef = tabOf(top) })
	b := f.run(func(r *waveobj.Run) { r.ParentLeadORef = tabOf(top) })
	f.suspendErr[tabOf(b)] = errors.New("cannot disarm")
	f.expectMarked(top, a, b)

	wantErr(t, Pause(f.ctx, f.ch.OID, top.ID, By_Manual), "cannot disarm")
	// only a was suspended whole: it is reopened; b may still run, and is left alone
	if got := f.callsWith("reopen"); len(got) != 1 || !strings.HasPrefix(got[0], "reopen "+tabOf(a)) {
		t.Errorf("reopen calls = %v, want only the suspended worker", got)
	}
	if got := f.get(top.ID); got.Pause != nil || got.Status == jarvis.RunStatus_Paused {
		t.Errorf("top is still paused: %+v", got.Pause)
	}
	for _, r := range []*waveobj.Run{a, b} {
		if f.get(r.ID).PausedUnder != "" {
			t.Errorf("run %s is still marked", r.ID)
		}
	}
}

func TestResumeReopensEverySessionAndLeavesNothingMarked(t *testing.T) {
	f := newFixture(t)
	top, topDag, topTasks := f.orchestrator("", 1)
	child, childDag, childTasks := f.orchestrator(tabOf(top), 1)
	quick := f.run(func(r *waveobj.Run) { r.ParentLeadORef = tabOf(top) })
	f.expectMarked(top, child, topTasks[0], childTasks[0], quick)
	if err := Pause(f.ctx, f.ch.OID, top.ID, By_Manual); err != nil {
		t.Fatal(err)
	}
	f.calls = nil
	// the dags' pause and the quick run's mark are reread at resume, so what the fakes keep must read paused too
	if got := f.dag(topDag.OID); got.PausedTs == 0 {
		t.Fatal("the fake did not pause the dag")
	}

	// the fakes check the run still reads paused while sessions are reopened: it is cleared last
	stillPaused := func(what string) {
		if got := f.get(top.ID); got.Pause == nil {
			t.Errorf("%s ran after the pause was cleared", what)
		}
	}
	reopen := reopenSession
	reopenSession = func(ctx context.Context, s waveobj.PausedSession, nudge string) error {
		stillPaused("reopen " + s.WorkerORef)
		return reopen(ctx, s, nudge)
	}
	resume := resumeDag
	resumeDag = func(ctx context.Context, dagID string, sessions []waveobj.PausedSession) error {
		stillPaused("resumeDag " + dagID)
		return resume(ctx, dagID, sessions)
	}

	before := time.Now().UnixMilli()
	if err := Resume(f.ctx, f.ch.OID, top.ID, By_Manual); err != nil {
		t.Fatal(err)
	}
	// each dag gets the sessions of its own runs; the quick run is reopened on its own, with the nudge
	resumed := f.callsWith("resumeDag")
	if len(resumed) != 2 {
		t.Fatalf("resumeDag calls = %v", resumed)
	}
	for _, c := range resumed {
		switch {
		case strings.HasPrefix(c, "resumeDag "+topDag.OID):
			if !strings.Contains(c, tabOf(top)) || !strings.Contains(c, tabOf(topTasks[0])) || strings.Contains(c, tabOf(child)) {
				t.Errorf("the top's dag got the wrong sessions: %s", c)
			}
		case strings.HasPrefix(c, "resumeDag "+childDag.OID):
			if !strings.Contains(c, tabOf(child)) || !strings.Contains(c, tabOf(childTasks[0])) || strings.Contains(c, tabOf(top)) {
				t.Errorf("the child's dag got the wrong sessions: %s", c)
			}
		default:
			t.Errorf("unexpected %s", c)
		}
	}
	if got := f.callsWith("reopen"); !slices.Equal(got, []string{"reopen " + tabOf(quick) + " nudge=nudge"}) {
		t.Errorf("reopen calls = %v, want the quick run only, with the paused nudge", got)
	}
	if got := f.callsWith("schedule"); len(got) != 2 {
		t.Errorf("schedule calls = %v, want one per dag", got)
	}
	topNow := f.get(top.ID)
	if topNow.Pause != nil || topNow.Status != jarvis.RunStatus_Executing || topNow.LastResumedTs < before {
		t.Errorf("top = status %q pause %+v lastresumed %d, want executing, no record and a resume time", topNow.Status, topNow.Pause, topNow.LastResumedTs)
	}
	for _, r := range []*waveobj.Run{child, topTasks[0], childTasks[0], quick} {
		if got := f.get(r.ID); got.PausedUnder != "" || jarvis.RunPaused(got) {
			t.Errorf("run %s still reads paused (%q)", r.ID, got.PausedUnder)
		}
	}
	if n := f.events(top.ID, waveobj.RunEventKindRunResumed); n != 1 {
		t.Errorf("run-resumed events = %d, want 1", n)
	}
	wantErr(t, Resume(f.ctx, f.ch.OID, top.ID, By_Manual), "not paused")
}

func TestResumeReopensASessionWhoseTabWasClosed(t *testing.T) {
	// the tab is gone from the store; ReopenSession is what puts it in a new one, so Resume must pass it on
	f := newFixture(t)
	r := f.run()
	f.expectMarked(r)
	if err := Pause(f.ctx, f.ch.OID, r.ID, By_Manual); err != nil {
		t.Fatal(err)
	}
	if err := Resume(f.ctx, f.ch.OID, r.ID, By_Manual); err != nil {
		t.Fatal(err)
	}
	if got := f.callsWith("reopen"); len(got) != 1 || !strings.HasPrefix(got[0], "reopen "+tabOf(r)) {
		t.Errorf("reopen calls = %v", got)
	}
}

func TestResumeLeavesTheSessionsOfFinishedRunsClosed(t *testing.T) {
	f := newFixture(t)
	top, _, topTasks := f.orchestrator("", 2)
	f.expectMarked(top, topTasks[0], topTasks[1])
	if err := Pause(f.ctx, f.ch.OID, top.ID, By_Manual); err != nil {
		t.Fatal(err)
	}
	// the person cancelled one task while the run was paused
	if err := wstore.UpdateRun(f.ctx, f.ch.OID, topTasks[0].ID, func(r *waveobj.Run) error {
		*r = jarvis.CancelRun(*r)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	f.calls = nil
	if err := Resume(f.ctx, f.ch.OID, top.ID, By_Manual); err != nil {
		t.Fatal(err)
	}
	got := f.callsWith("resumeDag")
	if len(got) != 1 || strings.Contains(got[0], tabOf(topTasks[0])) || !strings.Contains(got[0], tabOf(topTasks[1])) {
		t.Errorf("resumeDag calls = %v: the cancelled task's session must not be reopened", got)
	}
}

func TestResumeFailsThePhaseOfASessionThatCannotBeReopened(t *testing.T) {
	f := newFixture(t)
	a := f.run()
	f.expectMarked(a)
	if err := Pause(f.ctx, f.ch.OID, a.ID, By_Manual); err != nil {
		t.Fatal(err)
	}
	f.reopenErr[tabOf(a)] = errors.New("no such session")
	if err := Resume(f.ctx, f.ch.OID, a.ID, By_Manual); err != nil {
		t.Fatal(err)
	}
	got := f.get(a.ID)
	// the run resumed, and shows what could not come back, so the person can restart it
	if got.Pause != nil || got.PausedUnder != "" {
		t.Errorf("still paused: %+v", got.Pause)
	}
	if got.Phases[0].State != jarvis.PhaseState_Failed || got.Status != jarvis.RunStatus_Blocked {
		t.Errorf("phase %q status %q, want a failed phase and a blocked run", got.Phases[0].State, got.Status)
	}
}

func TestResumeKeepsWhatItHasNotReopenedWhenADagFails(t *testing.T) {
	f := newFixture(t)
	top, topDag, _ := f.orchestrator("", 1)
	child, childDag, _ := f.orchestrator(tabOf(top), 1)
	f.expectMarked(top, child)
	if err := Pause(f.ctx, f.ch.OID, top.ID, By_Manual); err != nil {
		t.Fatal(err)
	}
	f.resumeErr[childDag.OID] = errors.New("store busy")
	f.calls = nil
	wantErr(t, Resume(f.ctx, f.ch.OID, top.ID, By_Manual), "store busy")
	if got := f.get(top.ID); got.Pause == nil {
		t.Fatal("a failed resume cleared the pause")
	}
	// a retry reopens only what is left: the dag that resumed must not be reopened again
	delete(f.resumeErr, childDag.OID)
	f.calls = nil
	if err := Resume(f.ctx, f.ch.OID, top.ID, By_Manual); err != nil {
		t.Fatal(err)
	}
	if got := f.callsWith("resumeDag"); len(got) != 1 || !strings.HasPrefix(got[0], "resumeDag "+childDag.OID) {
		t.Errorf("the retry's resumeDag calls = %v (the top's dag %s already resumed)", got, topDag.OID)
	}
	if got := f.callsWith("reopen"); len(got) != 0 {
		t.Errorf("the retry reopened %v", got)
	}
}

func TestResumeAtBootKeepsRunsPausedUnderTightPressure(t *testing.T) {
	for _, p := range []jobqueue.Pressure{jobqueue.PressureWarn, jobqueue.PressureCritical} {
		f := newFixture(t)
		r := f.run()
		f.expectMarked(r)
		if err := Pause(f.ctx, f.ch.OID, r.ID, By_Auto); err != nil {
			t.Fatal(err)
		}
		f.pressure = p
		ResumeAtBoot(f.ctx)
		if got := f.get(r.ID); got.Pause == nil || got.Status != jarvis.RunStatus_Paused {
			t.Errorf("pressure %v: the run resumed at boot (status %q)", p, got.Status)
		}
		if n := f.events(r.ID, waveobj.RunEventKindRunResumed); n != 0 {
			t.Errorf("pressure %v: run-resumed recorded", p)
		}
	}
}

func TestResumeAtBootResumesEveryPausedTopLevelRunOtherwise(t *testing.T) {
	for _, p := range []jobqueue.Pressure{jobqueue.PressureNormal, jobqueue.PressureUnknown} {
		f := newFixture(t)
		a := f.run()
		top, _, topTasks := f.orchestrator("", 1)
		f.expectMarked(a)
		if err := Pause(f.ctx, f.ch.OID, a.ID, By_Manual); err != nil {
			t.Fatal(err)
		}
		f.expectMarked(top, topTasks[0])
		if err := Pause(f.ctx, f.ch.OID, top.ID, By_Auto); err != nil {
			t.Fatal(err)
		}
		f.pressure = p
		ResumeAtBoot(f.ctx)
		for _, r := range []*waveobj.Run{a, top} {
			if got := f.get(r.ID); got.Pause != nil || jarvis.RunPaused(got) {
				t.Errorf("pressure %v: run %s is still paused", p, r.ID)
			}
			evs, err := wstore.QueryRunEventsByKind(f.ctx, f.ch.OID, r.ID, []string{waveobj.RunEventKindRunResumed}, 5)
			if err != nil || len(evs) != 1 || !strings.Contains(string(evs[0].Detail), By_Boot) {
				t.Errorf("pressure %v: run %s resume events %v, %v, want one by boot", p, r.ID, evs, err)
			}
		}
	}
}

func TestClearOnCancelLeavesNoRunPausedUnderACancelledRun(t *testing.T) {
	f := newFixture(t)
	top, topDag, topTasks := f.orchestrator("", 2)
	child, childDag, childTasks := f.orchestrator(tabOf(top), 1)
	quick := f.run(func(r *waveobj.Run) { r.ParentLeadORef = tabOf(top) })
	doneChild := f.run(func(r *waveobj.Run) {
		r.ParentLeadORef = tabOf(top)
		r.Phases[0].State = jarvis.PhaseState_Done
		r.Status = jarvis.RunStatus_Done
	})
	// a task that landed before the pause: the dag cancel keeps its outcome, and so its mark
	if err := wstore.UpdateRun(f.ctx, f.ch.OID, topTasks[1].ID, func(r *waveobj.Run) error {
		r.Phases[0].State = jarvis.PhaseState_Done
		r.Status = jarvis.RunStatus_Done
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	f.expectMarked(top, child, topTasks[0], topTasks[1], childTasks[0], quick, doneChild)
	if err := Pause(f.ctx, f.ch.OID, top.ID, By_Auto); err != nil {
		t.Fatal(err)
	}

	// refused while the run is still paused: that would wipe a live pause
	wantErr(t, ClearOnCancel(f.ctx, f.ch.OID, top.ID), "not cancelled")
	if got := f.get(top.ID); got.Pause == nil {
		t.Fatal("ClearOnCancel cleared the pause of a run that was not cancelled")
	}

	// what CancelRunCommand does for a dag run: the dag cancel reaches the top's own dag
	if err := cancelDag(f.ctx, topDag.OID); err != nil {
		t.Fatal(err)
	}
	f.calls = nil
	if err := ClearOnCancel(f.ctx, f.ch.OID, top.ID); err != nil {
		t.Fatal(err)
	}

	// the child orchestrator goes through its own dag's cancel, the quick child through the run cancel; the top's dag
	// is already cancelled and a child that is done is left alone
	if got := f.callsWith("cancelDag"); !slices.Equal(got, []string{"cancelDag " + childDag.OID}) {
		t.Errorf("cancelDag calls = %v, want only the child orchestrator's dag", got)
	}
	if got := f.callsWith("stop"); !slices.Equal(got, []string{"stop " + quick.ID}) {
		t.Errorf("stop calls = %v, want the quick child's worker", got)
	}
	if got := f.get(quick.ID); got.Status != jarvis.RunStatus_Cancelled {
		t.Errorf("quick child reads %q", got.Status)
	}
	if got := f.get(doneChild.ID); got.Status != jarvis.RunStatus_Done {
		t.Errorf("a done child was cancelled: %q", got.Status)
	}
	for _, r := range []*waveobj.Run{top, child, topTasks[0], topTasks[1], childTasks[0], quick, doneChild} {
		if got := f.get(r.ID); jarvis.RunPaused(got) || got.PausedUnder != "" || got.Pause != nil {
			t.Errorf("run %s still reads paused: status %q under %q", r.ID, got.Status, got.PausedUnder)
		}
	}
	for _, oid := range []string{topDag.OID, childDag.OID} {
		if g := f.dag(oid); g.PausedTs != 0 {
			t.Errorf("dag %s still has PausedTs %d", oid, g.PausedTs)
		}
	}
	// a run that carries nothing under it has nothing to clear
	f.calls = nil
	if err := ClearOnCancel(f.ctx, f.ch.OID, top.ID); err != nil || len(f.calls) != 0 {
		t.Errorf("a second ClearOnCancel did work or failed: %v %v", f.calls, err)
	}
}

func TestClearOnCancelIsANoOpForAPlainRun(t *testing.T) {
	f := newFixture(t)
	r := f.run()
	if err := wstore.UpdateRun(f.ctx, f.ch.OID, r.ID, func(r *waveobj.Run) error {
		*r = jarvis.CancelRun(*r)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := ClearOnCancel(f.ctx, f.ch.OID, r.ID); err != nil || len(f.calls) != 0 {
		t.Errorf("calls %v, err %v", f.calls, err)
	}
}
