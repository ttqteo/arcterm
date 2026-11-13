// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/runpause"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// insertLeadTab stores a tab holding one block, as a lead's tab does, and returns the tab's oref and the block's id.
func insertLeadTab(t *testing.T, ctx context.Context) (tabORef, blockID string) {
	t.Helper()
	tabID := uuid.NewString()
	blockID = uuid.NewString()
	tabORef = waveobj.MakeORef(waveobj.OType_Tab, tabID).String()
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabID, BlockIds: []string{blockID}, Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.DBInsert(ctx, &waveobj.Block{OID: blockID, ParentORef: tabORef, Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatal(err)
	}
	return tabORef, blockID
}

// pausedLead is an autonomous top-level orchestrator run: its lead runs in a real tab and block, its dag holds one
// running task whose worker has a tab of its own. The pause and the resume run the engine's own code over a real store;
// only the agent restart, the creation of a replacement tab and the start of a replacement lead are scripted.
type pausedLead struct {
	ctx     context.Context
	channel *waveobj.Channel
	runID   string
	tabORef string
	blockID string

	mu sync.Mutex
	// reopened is the tab each restart of an agent was asked for, in order
	reopened []string
	// spawnedBlock is the block of the tab a closed one was replaced with, once there is one
	spawnedBlock string
	// launched counts the leads the engine started for the run
	launched int
}

func newPausedLead(t *testing.T) *pausedLead {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "ctx-resume-"+uuid.NewString(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	f := &pausedLead{ctx: ctx, channel: ch}
	f.tabORef, f.blockID = insertLeadTab(t, ctx)
	lead := jarvis.NewRun("lead goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	lead.Runtime, lead.SessionId = "claude", "lead-sess"
	lead.Phases[0].WorkerOrefs = []string{f.tabORef}
	f.runID = lead.ID

	g, err := orchestrate.NewTaskGroup(lead.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "task"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	workerTab, _ := insertLeadTab(t, ctx)
	worker := jarvis.NewRun("task t-0", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	worker.Runtime, worker.SessionId, worker.DagORef, worker.TaskId = "claude", "worker-sess", g.OID, "t-0"
	worker.Phases[0].WorkerOrefs = []string{workerTab}
	if err := wstore.AppendRun(ctx, ch.OID, worker); err != nil {
		t.Fatal(err)
	}
	g.Tasks[0].RunID, g.Tasks[0].State = worker.ID, orchestrate.TaskState_Running
	g.PlanApprovedTs, g.Autonomous = 1, true
	orchestrate.RecomputeDagStatus(&g)
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	lead.DagORef = g.OID
	if err := wstore.AppendRun(ctx, ch.OID, lead); err != nil {
		t.Fatal(err)
	}

	oldResume, oldSpawn, oldLaunch := jarvis.ResumeRunWorker, jarvis.SpawnRunWorker, orchestrate.LaunchLeadHook
	// the lead had written its transcript before the pause: a session with none is started fresh, not resumed
	t.Cleanup(orchestrate.SetTranscriptCheckForTest(func(string) bool { return true }))
	t.Cleanup(func() {
		jarvis.ResumeRunWorker, jarvis.SpawnRunWorker, orchestrate.LaunchLeadHook = oldResume, oldSpawn, oldLaunch
	})
	jarvis.ResumeRunWorker = func(_ context.Context, tabORef, _, _, _ string) error {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.reopened = append(f.reopened, tabORef)
		return nil
	}
	jarvis.SpawnRunWorker = func(ctx context.Context, _ runroute.Capability, _, _, _, _ string, _ jarvis.RunWorkerOptions) (string, error) {
		tabORef, blockID := insertLeadTab(t, ctx)
		f.mu.Lock()
		defer f.mu.Unlock()
		f.spawnedBlock = blockID
		return tabORef, nil
	}
	orchestrate.LaunchLeadHook = func(context.Context, string, string, string) error {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.launched++
		return nil
	}
	return f
}

// ctxOf is what `wsh jarvis dag status` learns about its run from block, as JarvisCtxCommand answers it.
func (f *pausedLead) ctxOf(t *testing.T, blockID string) *wshrpc.CommandJarvisCtxRtnData {
	t.Helper()
	rtn, err := (&WshServer{}).JarvisCtxCommand(f.ctx, wshrpc.CommandJarvisCtxData{BlockORef: "block:" + blockID})
	if err != nil {
		t.Fatal(err)
	}
	return rtn
}

// pauseAndResume pauses the run, runs between while it is paused, and resumes it.
func (f *pausedLead) pauseAndResume(t *testing.T, between func()) {
	t.Helper()
	if err := runpause.Pause(f.ctx, f.channel.OID, f.runID, runpause.By_Manual); err != nil {
		t.Fatalf("pausing the run: %v", err)
	}
	if between != nil {
		between()
	}
	if err := runpause.Resume(f.ctx, f.channel.OID, f.runID, runpause.By_Manual); err != nil {
		t.Fatalf("resuming the run: %v", err)
	}
}

func (f *pausedLead) wantRunContext(t *testing.T, blockID, what string) {
	t.Helper()
	got := f.ctxOf(t, blockID)
	if got.RunId != f.runID || got.ChannelId != f.channel.OID {
		t.Fatalf("%s: resolves to run %q in %q, want run %q in %q", what, got.RunId, got.ChannelId, f.runID, f.channel.OID)
	}
}

func (f *pausedLead) leadsLaunched() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.launched
}

// the lead's own `wsh jarvis dag status` resolves its run from the lead's block: after a pause and a resume it must
// still (run 1cad2fd0: "no run context for this block")
func TestJarvisCtxResolvesALeadAfterAPauseAndResumeInItsOwnTab(t *testing.T) {
	f := newPausedLead(t)
	f.wantRunContext(t, f.blockID, "before the pause")
	f.pauseAndResume(t, nil)
	if !slices.Contains(f.reopened, f.tabORef) {
		t.Fatalf("the lead was not reopened in its own tab %s: reopened %v", f.tabORef, f.reopened)
	}
	f.wantRunContext(t, f.blockID, "after the resume")
}

func TestJarvisCtxResolvesALeadAfterAPauseAndResumeInANewTab(t *testing.T) {
	f := newPausedLead(t)
	f.pauseAndResume(t, func() {
		// the person closed the lead's tab while the run was paused
		tabID := waveobj.ParseORefNoErr(f.tabORef).OID
		if err := wstore.DBDelete(f.ctx, waveobj.OType_Tab, tabID); err != nil {
			t.Fatal(err)
		}
	})
	if f.spawnedBlock == "" {
		t.Fatal("the lead's closed tab was not replaced")
	}
	f.wantRunContext(t, f.spawnedBlock, "the lead's new tab after the resume")
}

// a pause ends the lead's process, so the next wake finds it "not running". That is the pause, not a death: judging
// the lead dead started a replacement lead in a new tab (run 1cad2fd0, two seconds after the pause) and dropped the old
// tab from the run, so the lead the resume reopened had no run context.
func TestJarvisCtxResolvesALeadWhenAWakeCameInWhileTheRunWasPaused(t *testing.T) {
	f := newPausedLead(t)
	f.pauseAndResume(t, func() {
		orchestrate.PostWake(f.ctx, f.channel.OID, f.runID, "wake: task t-0 may be stuck: worktree unchanged 21m while active.")
		// the engine hands a dead lead over on its own goroutine: give it the time it needs to be seen
		deadline := time.Now().Add(500 * time.Millisecond)
		for f.leadsLaunched() == 0 && time.Now().Before(deadline) {
			time.Sleep(10 * time.Millisecond)
		}
	})
	if n := f.leadsLaunched(); n != 0 {
		t.Fatalf("the engine started %d replacement lead(s) for a lead its own pause had stopped", n)
	}
	evs, err := wstore.QueryRunEventsByKind(f.ctx, f.channel.OID, f.runID, []string{waveobj.RunEventKindLeadWakeFailed}, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 0 {
		t.Fatalf("the paused lead was handed over as dead: %d lead-wake-failed event(s)", len(evs))
	}
	f.wantRunContext(t, f.blockID, "after the resume")
}
