// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// stubControllerStatus swaps controllerStatusFn for a fixed answer and restores it on cleanup.
func stubControllerStatus(t *testing.T, status *blockcontroller.BlockControllerRuntimeStatus) {
	t.Helper()
	orig := controllerStatusFn
	controllerStatusFn = func(string) *blockcontroller.BlockControllerRuntimeStatus { return status }
	t.Cleanup(func() { controllerStatusFn = orig })
}

// askBlock returns a block oref; absent means no block is inserted at all, i.e. the terminal was closed.
func askBlock(t *testing.T, absent bool) string {
	t.Helper()
	blockId := uuid.NewString()
	oref := waveobj.MakeORef(waveobj.OType_Block, blockId).String()
	if absent {
		return oref
	}
	if err := wstore.DBInsert(context.Background(), &waveobj.Block{OID: blockId, Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatalf("insert block: %v", err)
	}
	return oref
}

// pruneCase registers one pending ask against a freshly built block and reports whether the ask
// survived the poll's liveness check, both in the returned map and in the registry itself.
func pruneCase(t *testing.T, absent bool) (inList bool, inRegistry bool) {
	t.Helper()
	oref := askBlock(t, absent)
	old := agentask.GlobalRegistry
	agentask.GlobalRegistry = agentask.MakeRegistry()
	defer func() { agentask.GlobalRegistry = old }()
	agentask.GlobalRegistry.Set(oref, agentask.PendingAsk{AskId: "a-1", BlockId: uuid.NewString(), Ts: 1})

	live, err := LivePendingAsks(context.Background())
	if err != nil {
		t.Fatalf("LivePendingAsks: %v", err)
	}
	_, inList = live[oref]
	_, inRegistry = agentask.GlobalRegistry.Get(oref)
	return inList, inRegistry
}

func TestLivePendingAsksRetiresAnAskWhoseBlockIsGone(t *testing.T) {
	inList, inRegistry := pruneCase(t, true)
	if inList || inRegistry {
		t.Fatalf("an ask for a deleted block survived: list=%v registry=%v", inList, inRegistry)
	}
}

// a kept block whose process ended has no clear coming — the agent that would send it is gone — so the
// poll has to notice the controller's own status.
func TestLivePendingAsksRetiresAnAskFromABlockWhoseProcessEnded(t *testing.T) {
	stubControllerStatus(t, &blockcontroller.BlockControllerRuntimeStatus{ShellProcStatus: blockcontroller.Status_Done})
	inList, inRegistry := pruneCase(t, false)
	if inList || inRegistry {
		t.Fatalf("an ask for a finished block survived: list=%v registry=%v", inList, inRegistry)
	}
}

func TestLivePendingAsksKeepsAnAskFromABlockWhoseProcessIsRunning(t *testing.T) {
	stubControllerStatus(t, &blockcontroller.BlockControllerRuntimeStatus{ShellProcStatus: blockcontroller.Status_Running})
	inList, _ := pruneCase(t, false)
	if !inList {
		t.Fatalf("an ask for a running block was pruned")
	}
}

// ownedAskBlock stores run, and a worker tab stamped as its own with one block in it (the stamp the exit hook finds a
// worker's run through), and returns the block's oref.
func ownedAskBlock(t *testing.T, run waveobj.Run) string {
	t.Helper()
	ctx := context.Background()
	run.OID = run.ID
	run.ChannelOID = uuid.NewString()
	if err := wstore.DBInsert(ctx, &run); err != nil {
		t.Fatalf("insert run: %v", err)
	}
	tabId, blockId := uuid.NewString(), uuid.NewString()
	tab := &waveobj.Tab{OID: tabId, BlockIds: []string{blockId}, Meta: waveobj.MetaMapType{
		wstore.MetaKey_JarvisRunORef:     waveobj.MakeORef(waveobj.OType_Run, run.ID).String(),
		wstore.MetaKey_JarvisChannelORef: waveobj.MakeORef(waveobj.OType_Channel, run.ChannelOID).String(),
	}}
	if err := wstore.DBInsert(ctx, tab); err != nil {
		t.Fatalf("insert tab: %v", err)
	}
	block := &waveobj.Block{OID: blockId, ParentORef: waveobj.MakeORef(waveobj.OType_Tab, tabId).String(), Meta: waveobj.MetaMapType{}}
	if err := wstore.DBInsert(ctx, block); err != nil {
		t.Fatalf("insert block: %v", err)
	}
	return waveobj.MakeORef(waveobj.OType_Block, blockId).String()
}

// askSurvivesPoll registers one pending ask under oref and reports whether it survives a LivePendingAsks poll, in the
// returned map and in the registry.
func askSurvivesPoll(t *testing.T, oref string) (inList, inRegistry bool) {
	t.Helper()
	old := agentask.GlobalRegistry
	agentask.GlobalRegistry = agentask.MakeRegistry()
	defer func() { agentask.GlobalRegistry = old }()
	agentask.GlobalRegistry.Set(oref, agentask.PendingAsk{AskId: "a-1", BlockId: uuid.NewString(), Ts: 1})
	live, err := LivePendingAsks(context.Background())
	if err != nil {
		t.Fatalf("LivePendingAsks: %v", err)
	}
	_, inList = live[oref]
	_, inRegistry = agentask.GlobalRegistry.Get(oref)
	return inList, inRegistry
}

// a pause ends the agent's process on purpose, so its controller reads done while the run waits to resume: the ask
// is the person's to answer then, and the answer is held for the resumed agent. Pruning it would lose the question.
func TestLivePendingAsksKeepsAnAskOfAPausedRunWhoseProcessEnded(t *testing.T) {
	stubControllerStatus(t, &blockcontroller.BlockControllerRuntimeStatus{ShellProcStatus: blockcontroller.Status_Done})
	run := NewRun("goal", "ws-1", "/p", nil, RunMode_Quick, QuickPlaybook(), 1000)
	SetRunPause(&run, &waveobj.RunPause{PausedTs: 2000, By: "manual"})
	if run.Status != RunStatus_Paused {
		t.Fatalf("fixture: run status %q, want paused", run.Status)
	}
	inList, inRegistry := askSurvivesPoll(t, ownedAskBlock(t, run))
	if !inList || !inRegistry {
		t.Fatalf("an ask of a paused run was pruned: list=%v registry=%v", inList, inRegistry)
	}
}

// a child run keeps its own status under a paused top-level run; only PausedUnder marks it
func TestLivePendingAsksKeepsAnAskOfAChildRunUnderAPausedRun(t *testing.T) {
	stubControllerStatus(t, &blockcontroller.BlockControllerRuntimeStatus{ShellProcStatus: blockcontroller.Status_Done})
	child := NewRun("task", "ws-1", "/p", nil, RunMode_Quick, QuickPlaybook(), 1000)
	child.PausedUnder = "top-level-run"
	if child.Status == RunStatus_Paused {
		t.Fatalf("fixture: a child run keeps its own status")
	}
	inList, inRegistry := askSurvivesPoll(t, ownedAskBlock(t, child))
	if !inList || !inRegistry {
		t.Fatalf("an ask of a child run under a paused run was pruned: list=%v registry=%v", inList, inRegistry)
	}
}

// only a paused run's ask is spared: the same ended block of a run that is not paused still loses its ask
func TestLivePendingAsksRetiresAnAskOfARunThatIsNotPausedWhoseProcessEnded(t *testing.T) {
	stubControllerStatus(t, &blockcontroller.BlockControllerRuntimeStatus{ShellProcStatus: blockcontroller.Status_Done})
	run := NewRun("goal", "ws-1", "/p", nil, RunMode_Quick, QuickPlaybook(), 1000)
	inList, inRegistry := askSurvivesPoll(t, ownedAskBlock(t, run))
	if inList || inRegistry {
		t.Fatalf("an ask of a run that is not paused survived its ended process: list=%v registry=%v", inList, inRegistry)
	}
}

// before the frontend re-mounts a block's controller (e.g. right after boot), there is no controller to
// ask yet — that silence must not be misread as the process having ended.
func TestLivePendingAsksKeepsAnAskFromABlockWithNoController(t *testing.T) {
	stubControllerStatus(t, nil)
	inList, _ := pruneCase(t, false)
	if !inList {
		t.Fatalf("an ask for a block with no controller yet was pruned")
	}
}
