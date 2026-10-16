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

// before the frontend re-mounts a block's controller (e.g. right after boot), there is no controller to
// ask yet — that silence must not be misread as the process having ended.
func TestLivePendingAsksKeepsAnAskFromABlockWithNoController(t *testing.T) {
	stubControllerStatus(t, nil)
	inList, _ := pruneCase(t, false)
	if !inList {
		t.Fatalf("an ask for a block with no controller yet was pruned")
	}
}
