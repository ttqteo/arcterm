package jarvis

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestStopRunWorkerDisablesRunOnStart(t *testing.T) {
	ctx := context.Background()
	tabId := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	blockId := "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	tab := &waveobj.Tab{OID: tabId, BlockIds: []string{blockId}}
	if err := wstore.DBInsert(ctx, tab); err != nil {
		t.Fatal(err)
	}
	block := &waveobj.Block{OID: blockId, ParentORef: "tab:" + tabId, Meta: waveobj.MetaMapType{waveobj.MetaKey_CmdRunOnStart: true}}
	if err := wstore.DBInsert(ctx, block); err != nil {
		t.Fatal(err)
	}
	oref := waveobj.MakeORef(waveobj.OType_Tab, tabId).String()
	if err := StopRunWorker(ctx, oref); err != nil {
		t.Fatalf("StopRunWorker: %v", err)
	}
	got, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		t.Fatal(err)
	}
	if got.Meta[waveobj.MetaKey_CmdRunOnStart] != false {
		t.Fatalf("cmd:runonstart = %#v, want false", got.Meta[waveobj.MetaKey_CmdRunOnStart])
	}
}

func TestStopRunWorkerReturnsRunOnStartPersistenceFailure(t *testing.T) {
	ctx := context.Background()
	oldDestroy := destroyBlockController
	destroyed := false
	destroyBlockController = func(string) { destroyed = true }
	t.Cleanup(func() { destroyBlockController = oldDestroy })
	tabID := "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
	missingBlockID := "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabID, BlockIds: []string{missingBlockID}}); err != nil {
		t.Fatal(err)
	}

	err := StopRunWorker(ctx, waveobj.MakeORef(waveobj.OType_Tab, tabID).String())
	if err == nil || !strings.Contains(err.Error(), missingBlockID) {
		t.Fatalf("stop error = %v, want missing block persistence failure", err)
	}
	if destroyed {
		t.Fatal("controller destroyed before durable runonstart marker persisted")
	}
}

func TestStopRunWorkerErrors(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name string
		oref string
	}{
		{name: "malformed", oref: "not-an-oref"},
		{name: "non-tab", oref: waveobj.MakeORef(waveobj.OType_Block, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb").String()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := StopRunWorker(ctx, tc.oref); err == nil {
				t.Fatalf("want error for %s", tc.name)
			}
		})
	}
}

// a finished worker's tab can be gone before a cancel or retry reaches it; with no tab nothing is left
// running, so the stop has nothing to do rather than failing the whole cancel.
func TestStopRunWorkerTreatsAMissingTabAsStopped(t *testing.T) {
	ctx := context.Background()
	oref := waveobj.MakeORef(waveobj.OType_Tab, "cccccccc-cccc-4ccc-8ccc-cccccccccccc").String()
	if err := StopRunWorker(ctx, oref); err != nil {
		t.Fatalf("StopRunWorker on a deleted tab: %v, want nil", err)
	}
}

func TestStopRunWorkersJoinsErrors(t *testing.T) {
	ctx := context.Background()
	run := NewRun("g", "ws-1", "/tmp", nil, RunMode_Quick, QuickPlaybook(), 1)
	run.Phases[0].WorkerOrefs = []string{
		"bad-oref-1",
		"bad-oref-2",
	}
	err := StopRunWorkers(ctx, &run)
	if err == nil {
		t.Fatal("want joined error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "bad-oref-1") || !strings.Contains(msg, "bad-oref-2") {
		t.Fatalf("joined error %q missing orefs", msg)
	}
}

// a brainstorm's builder check or judge whose agent closes goes with it: its worker stops and its tab leaves the
// workspace; a worker tab already closed is no error
func TestCloseRunWorkerTabsStopsAndDeletesTheTab(t *testing.T) {
	ctx := context.Background()
	var destroyed []string
	oldDestroy := destroyBlockController
	destroyBlockController = func(id string) { destroyed = append(destroyed, id) }
	t.Cleanup(func() { destroyBlockController = oldDestroy })
	wsId := "2b3c4d5e-0001-4000-8000-000000000001"
	workerTab, workerBlock := "2b3c4d5e-0002-4000-8000-000000000002", "2b3c4d5e-0003-4000-8000-000000000003"
	otherTab := "2b3c4d5e-0004-4000-8000-000000000004"
	for _, obj := range []waveobj.WaveObj{
		&waveobj.Workspace{OID: wsId, TabIds: []string{otherTab, workerTab}, ActiveTabId: otherTab},
		&waveobj.Tab{OID: workerTab, BlockIds: []string{workerBlock}},
		&waveobj.Block{OID: workerBlock, ParentORef: "tab:" + workerTab, Meta: waveobj.MetaMapType{waveobj.MetaKey_Controller: "cmd"}},
		&waveobj.Tab{OID: otherTab},
	} {
		if err := wstore.DBInsert(ctx, obj); err != nil {
			t.Fatal(err)
		}
	}
	run := NewRun("judge", wsId, "/tmp", nil, RunMode_Quick, QuickPlaybook(), 1)
	run.Phases[0].WorkerOrefs = []string{"tab:" + workerTab, "tab:2b3c4d5e-0005-4000-8000-000000000005"}

	if err := CloseRunWorkerTabs(ctx, &run); err != nil {
		t.Fatalf("CloseRunWorkerTabs: %v", err)
	}
	if len(destroyed) != 1 || destroyed[0] != workerBlock {
		t.Fatalf("destroyed %v, want the worker's block", destroyed)
	}
	if tab, _ := wstore.DBGet[*waveobj.Tab](ctx, workerTab); tab != nil {
		t.Fatal("the worker's tab is still in the store")
	}
	ws, err := wstore.DBMustGet[*waveobj.Workspace](ctx, wsId)
	if err != nil {
		t.Fatal(err)
	}
	if len(ws.TabIds) != 1 || ws.TabIds[0] != otherTab || ws.ActiveTabId != otherTab {
		t.Fatalf("workspace tabs %v active %s, want only %s, still active", ws.TabIds, ws.ActiveTabId, otherTab)
	}
}

// stubDestroy records the blocks whose controller a stop or suspend destroys, and restores the real seam on cleanup.
func stubDestroy(t *testing.T) *[]string {
	t.Helper()
	var destroyed []string
	old := destroyBlockController
	destroyBlockController = func(id string) { destroyed = append(destroyed, id) }
	t.Cleanup(func() { destroyBlockController = old })
	return &destroyed
}

// a pause frees the worker's memory but keeps its tab, scrollback and launch args, and leaves the block disarmed so a
// resync cannot start it again: the frontend issues one whenever the block renders, a forced one ignores runonstart.
func TestSuspendRunWorkerEndsTheProcessKeepsTheTabAndDisarmsTheBlock(t *testing.T) {
	ctx := context.Background()
	destroyed := stubDestroy(t)
	tabORef, blockId := newWorkerTab(t, waveobj.MetaMapType{
		waveobj.MetaKey_Controller:    "cmd",
		waveobj.MetaKey_CmdRunOnStart: true,
		waveobj.MetaKey_CmdRunOnce:    true,
		waveobj.MetaKey_Cmd:           "claude",
		waveobj.MetaKey_CmdArgs:       []string{"--session-id", "sess-1", "the task"},
		"agent:baseargs":              []string{"--dangerously-skip-permissions"},
	})

	if err := SuspendRunWorker(ctx, tabORef); err != nil {
		t.Fatalf("SuspendRunWorker: %v", err)
	}
	if len(*destroyed) != 1 || (*destroyed)[0] != blockId {
		t.Fatalf("destroyed %v, want the worker's block", *destroyed)
	}
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		t.Fatal(err)
	}
	if name := block.Meta.GetString(waveobj.MetaKey_Controller, ""); name != "" {
		t.Fatalf("controller = %q, want empty so a resync cannot restart the worker", name)
	}
	for _, key := range []string{waveobj.MetaKey_CmdRunOnStart, waveobj.MetaKey_CmdRunOnce} {
		if block.Meta[key] != false {
			t.Fatalf("%s = %#v, want false", key, block.Meta[key])
		}
	}
	// what a resume needs, and what the scrollback belongs to, survives
	if block.Meta.GetString(waveobj.MetaKey_Cmd, "") != "claude" || !block.Meta.HasKey("agent:baseargs") ||
		len(block.Meta.GetStringList(waveobj.MetaKey_CmdArgs)) != 3 {
		t.Fatalf("suspending must keep the block's command and args, got %#v", block.Meta)
	}
	tabId := strings.TrimPrefix(tabORef, "tab:")
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil || tab == nil || len(tab.BlockIds) != 1 || tab.BlockIds[0] != blockId {
		t.Fatalf("suspending must keep the tab with its block, got %#v (err %v)", tab, err)
	}
	for _, force := range []bool{false, true} {
		if err := blockcontroller.ResyncController(ctx, tabId, blockId, &waveobj.RuntimeOpts{}, force); err != nil {
			t.Fatalf("ResyncController(force=%v): %v", force, err)
		}
		if blockcontroller.GetBlockControllerRuntimeStatus(blockId) != nil {
			t.Fatalf("a resync (force=%v) started a suspended worker", force)
		}
	}
}

func TestSuspendRunWorkerTreatsAMissingTabAsSuspended(t *testing.T) {
	destroyed := stubDestroy(t)
	oref := waveobj.MakeORef(waveobj.OType_Tab, "cccccccc-cccc-4ccc-8ccc-ccccccccccc1").String()
	if err := SuspendRunWorker(context.Background(), oref); err != nil {
		t.Fatalf("SuspendRunWorker on a closed tab: %v, want nil", err)
	}
	if len(*destroyed) != 0 {
		t.Fatalf("nothing to destroy for a closed tab, got %v", *destroyed)
	}
}

func TestSuspendRunWorkerErrors(t *testing.T) {
	ctx := context.Background()
	destroyed := stubDestroy(t)
	for name, oref := range map[string]string{
		"malformed": "not-an-oref",
		"non-tab":   waveobj.MakeORef(waveobj.OType_Block, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1").String(),
	} {
		if err := SuspendRunWorker(ctx, oref); err == nil {
			t.Errorf("%s: want an error", name)
		}
	}
	// a block that cannot be disarmed is not destroyed either: the process must never end while a resync could restart it
	tabID, missingBlockID := "dddddddd-dddd-4ddd-8ddd-ddddddddddd1", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1"
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabID, BlockIds: []string{missingBlockID}}); err != nil {
		t.Fatal(err)
	}
	err := SuspendRunWorker(ctx, waveobj.MakeORef(waveobj.OType_Tab, tabID).String())
	if err == nil || !strings.Contains(err.Error(), missingBlockID) {
		t.Fatalf("suspend error = %v, want the block that could not be disarmed", err)
	}
	if len(*destroyed) != 0 {
		t.Fatalf("destroyed %v before the block was durably disarmed", *destroyed)
	}
}

// the resume of a suspended worker: the block's controller is armed again together with the runtime's resume args,
// and only then started, whichever of the four harnesses ran in it
func TestResumeRunWorkerAfterSuspendRearmsTheBlockWithTheResumeArgsForEveryRuntime(t *testing.T) {
	const nudge = "Arc paused this run and has resumed it."
	base := []string{"--dangerously-skip-permissions", "--model", "opus"}
	for _, runtime := range []string{"claude", "pi", "agy", "codex"} {
		t.Run(runtime, func(t *testing.T) {
			ctx := context.Background()
			stubDestroy(t)
			tabORef, blockId := newWorkerTab(t, waveobj.MetaMapType{
				waveobj.MetaKey_Controller:    "cmd",
				waveobj.MetaKey_CmdRunOnStart: true,
				waveobj.MetaKey_Cmd:           runtime,
				waveobj.MetaKey_CmdArgs:       []string{"the first prompt"},
				"agent:baseargs":              base,
			})
			if err := SuspendRunWorker(ctx, tabORef); err != nil {
				t.Fatalf("SuspendRunWorker: %v", err)
			}

			var events []string
			var persisted waveobj.MetaMapType
			oldPersist, oldStart := persistWorkerBlockMeta, startWorkerController
			t.Cleanup(func() { persistWorkerBlockMeta, startWorkerController = oldPersist, oldStart })
			persistWorkerBlockMeta = func(ctx context.Context, id string, meta waveobj.MetaMapType) error {
				events = append(events, "persist "+id)
				persisted = meta
				return oldPersist(ctx, id, meta)
			}
			startWorkerController = func(ctx context.Context, _, id string) error {
				// by the time the controller starts, the block must already name it and carry the resume args
				block, err := wstore.DBMustGet[*waveobj.Block](ctx, id)
				if err != nil {
					return err
				}
				if name := block.Meta.GetString(waveobj.MetaKey_Controller, ""); name != "cmd" {
					t.Errorf("controller at start = %q, want cmd", name)
				}
				events = append(events, "start "+id)
				return nil
			}

			if err := ResumeRunWorker(ctx, tabORef, runtime, "sess-1", nudge); err != nil {
				t.Fatalf("ResumeRunWorker: %v", err)
			}
			wantArgs, ok := ResumeWorkerArgs(runtime, "sess-1", base, nudge)
			if !ok {
				t.Fatalf("ResumeWorkerArgs refused %q", runtime)
			}
			// the write as the seam sees it, before the store's JSON round trip turns a []string into a []any
			if got := persisted[waveobj.MetaKey_CmdArgs]; !reflect.DeepEqual(got, wantArgs) {
				t.Fatalf("persisted cmd:args = %v, want %v", got, wantArgs)
			}
			block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
			if err != nil {
				t.Fatal(err)
			}
			if got := block.Meta.GetStringList(waveobj.MetaKey_CmdArgs); !reflect.DeepEqual(got, wantArgs) {
				t.Fatalf("stored cmd:args = %v, want %v", got, wantArgs)
			}
			if name := persisted.GetString(waveobj.MetaKey_Controller, ""); name != "cmd" {
				t.Fatalf("persisted controller = %q, want cmd", name)
			}
			if want := []string{"persist " + blockId, "start " + blockId}; !reflect.DeepEqual(events, want) {
				t.Fatalf("events = %v, want %v: the block is armed before it starts, and started once", events, want)
			}
		})
	}
}

// A stop that only clears runonstart is not durable: the block keeps its controller name, so the next
// ResyncController builds a fresh controller and runs the command again (a forced resync does not even
// consult runonstart). Clearing the controller makes resync destroy instead of create.
func TestStopRunWorkerDisarmsTheBlockForResync(t *testing.T) {
	ctx := context.Background()
	tabId := "1a2b3c4d-0001-4000-8000-000000000001"
	blockId := "1a2b3c4d-0002-4000-8000-000000000002"
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabId, BlockIds: []string{blockId}}); err != nil {
		t.Fatal(err)
	}
	block := &waveobj.Block{OID: blockId, ParentORef: "tab:" + tabId, Meta: waveobj.MetaMapType{
		waveobj.MetaKey_Controller:    "cmd",
		waveobj.MetaKey_CmdRunOnStart: true,
		waveobj.MetaKey_CmdRunOnce:    true,
		waveobj.MetaKey_Cmd:           "claude",
	}}
	if err := wstore.DBInsert(ctx, block); err != nil {
		t.Fatal(err)
	}
	if err := StopRunWorker(ctx, waveobj.MakeORef(waveobj.OType_Tab, tabId).String()); err != nil {
		t.Fatalf("StopRunWorker: %v", err)
	}
	got, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		t.Fatal(err)
	}
	// ResyncController reads this with GetString(MetaKey_Controller, "") and returns early on empty
	if name := got.Meta.GetString(waveobj.MetaKey_Controller, ""); name != "" {
		t.Fatalf("controller = %q, want empty so a resync cannot restart the worker", name)
	}
	for _, key := range []string{waveobj.MetaKey_CmdRunOnStart, waveobj.MetaKey_CmdRunOnce} {
		if got.Meta[key] != false {
			t.Fatalf("%s = %#v, want false", key, got.Meta[key])
		}
	}
	// the scrollback the evidence snapshot reads must survive the stop
	if got.Meta.GetString(waveobj.MetaKey_Cmd, "") != "claude" {
		t.Fatalf("stopping a worker must not erase the block's command, got %#v", got.Meta[waveobj.MetaKey_Cmd])
	}
}
