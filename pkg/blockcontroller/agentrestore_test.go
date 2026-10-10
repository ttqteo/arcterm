// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"context"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func agentMeta(cmd string, args ...string) waveobj.MetaMapType {
	list := make([]any, len(args))
	for i, a := range args {
		list[i] = a
	}
	return waveobj.MetaMapType{
		waveobj.MetaKey_Controller: BlockController_Cmd,
		waveobj.MetaKey_Cmd:        cmd,
		waveobj.MetaKey_CmdArgs:    list,
	}
}

func withMeta(m waveobj.MetaMapType, k string, v any) waveobj.MetaMapType {
	m[k] = v
	return m
}

func TestTracksAgentLive(t *testing.T) {
	cases := []struct {
		name string
		meta waveobj.MetaMapType
		want bool
	}{
		{"claude", agentMeta("claude", "do the thing"), true},
		{"pi", agentMeta("pi"), true},
		{"opencode", agentMeta("opencode"), true},
		{"agy", agentMeta("agy", "-i", "do the thing"), true},
		{"codex", agentMeta("codex", "fix the bug"), true},
		{"an unknown harness", agentMeta("aider"), false},
		{"a shell", waveobj.MetaMapType{waveobj.MetaKey_Controller: BlockController_Shell}, false},
		{"a run's worker comes back through its run", withMeta(agentMeta("claude"), metaKeyAgentRunId, "r1"), false},
	}
	for _, c := range cases {
		if got := tracksAgentLive(c.meta); got != c.want {
			t.Errorf("%s: tracksAgentLive = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestShouldRestoreAgent(t *testing.T) {
	live := func(m waveobj.MetaMapType) waveobj.MetaMapType { return withMeta(m, MetaKey_AgentLive, "123") }
	cases := []struct {
		name string
		meta waveobj.MetaMapType
		want bool
	}{
		{"claude with its session baked", live(agentMeta("claude", "--resume", "abc")), true},
		{"claude with flags after the session", live(agentMeta("claude", "--resume", "abc", "--model", "opus")), true},
		{"opencode", live(agentMeta("opencode", "-s", "ses_1")), true},
		{"pi", live(agentMeta("pi", "--session", `C:\t\s.jsonl`)), true},
		{"agy with its conversation baked", live(agentMeta("agy", "--conversation", "c1", "--sandbox")), true},
		{"agy still on its task: a relaunch would replay it", live(agentMeta("agy", "-i", "fix the bug")), false},
		{"agy with another harness's flag", live(agentMeta("agy", "--resume", "c1")), false},
		{"not running when the server died", agentMeta("claude", "--resume", "abc"), false},
		{"no session yet: a relaunch would replay its task", live(agentMeta("claude", "fix the bug")), false},
		{"another harness's flag", live(agentMeta("claude", "--session", "abc")), false},
		{"an empty session key", live(agentMeta("claude", "--resume", "")), false},
		{"codex with its session baked", live(agentMeta("codex", "resume", "abc", "--full-auto")), true},
		{"codex still on its task", live(agentMeta("codex", "--full-auto", "fix the bug")), false},
		{"a run's worker", withMeta(live(agentMeta("claude", "--resume", "abc")), metaKeyAgentRunId, "r1"), false},
		{"not a cmd block", live(waveobj.MetaMapType{waveobj.MetaKey_Controller: BlockController_Shell}), false},
	}
	for _, c := range cases {
		if got := shouldRestoreAgent(c.meta); got != c.want {
			t.Errorf("%s: shouldRestoreAgent = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestShouldClearAgentLive(t *testing.T) {
	cases := []struct {
		name               string
		current, token     string
		shuttingDown, want bool
	}{
		{"its own process exited", "t1", "t1", false, true},
		{"a quit is killing it: the next boot brings it back", "t1", "t1", true, false},
		{"a relaunch already marked its successor", "t2", "t1", false, false},
		{"never marked", "", "", false, false},
		{"already cleared", "", "t1", false, false},
	}
	for _, c := range cases {
		if got := shouldClearAgentLive(c.current, c.token, c.shuttingDown); got != c.want {
			t.Errorf("%s: shouldClearAgentLive = %v, want %v", c.name, got, c.want)
		}
	}
}

// insertAgentBlock stores a tab holding one block with meta, and returns the block's id and the tab's.
func insertAgentBlock(t *testing.T, meta waveobj.MetaMapType) (string, string) {
	t.Helper()
	ctx := context.Background()
	tabId, blockId := uuid.NewString(), uuid.NewString()
	block := &waveobj.Block{OID: blockId, ParentORef: waveobj.MakeORef(waveobj.OType_Tab, tabId).String(), Meta: meta}
	if err := wstore.DBInsert(ctx, &waveobj.Tab{OID: tabId, BlockIds: []string{blockId}, Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.DBInsert(ctx, block); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		wstore.DBDelete(ctx, waveobj.OType_Block, blockId)
		wstore.DBDelete(ctx, waveobj.OType_Tab, tabId)
	})
	return blockId, tabId
}

func liveMark(t *testing.T, blockId string) string {
	t.Helper()
	block, err := wstore.DBMustGet[*waveobj.Block](context.Background(), blockId)
	if err != nil {
		t.Fatal(err)
	}
	return block.Meta.GetString(MetaKey_AgentLive, "")
}

func TestRestoreLiveAgents(t *testing.T) {
	var mu sync.Mutex
	started := map[string]string{} // blockId -> tabId
	done := make(chan struct{}, 8)
	oldRestart, oldStagger := restartAgentBlock, restoreAgentStagger
	restartAgentBlock = func(_ context.Context, tabId, blockId string) error {
		mu.Lock()
		started[blockId] = tabId
		mu.Unlock()
		done <- struct{}{}
		return nil
	}
	restoreAgentStagger = time.Millisecond
	t.Cleanup(func() { restartAgentBlock, restoreAgentStagger = oldRestart, oldStagger })

	live := func(m waveobj.MetaMapType) waveobj.MetaMapType { return withMeta(m, MetaKey_AgentLive, "1") }
	claude, claudeTab := insertAgentBlock(t, live(agentMeta("claude", "--resume", "abc")))
	pi, piTab := insertAgentBlock(t, live(agentMeta("pi", "--session", "/s.jsonl")))
	unbaked, _ := insertAgentBlock(t, live(agentMeta("claude", "fix the bug")))
	orphan, _ := insertAgentBlock(t, agentMeta("claude", "--resume", "old"))
	worker, _ := insertAgentBlock(t, withMeta(live(agentMeta("claude", "--resume", "w")), metaKeyAgentRunId, "r1"))

	RestoreLiveAgents(context.Background())
	for range 2 {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("restored agents did not start")
		}
	}
	select {
	case <-done:
		t.Fatal("started more than the two restorable agents")
	case <-time.After(50 * time.Millisecond):
	}

	mu.Lock()
	defer mu.Unlock()
	if started[claude] != claudeTab || started[pi] != piTab {
		t.Errorf("started %v, want claude in %s and pi in %s", started, claudeTab, piTab)
	}
	var ids []string
	for id := range started {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	if len(ids) != 2 {
		t.Errorf("started %v, want only claude and pi", ids)
	}
	// every mark the last server left is cleared; a relaunch sets its own
	for _, id := range []string{claude, pi, unbaked, orphan, worker} {
		if mark := liveMark(t, id); mark != "" {
			t.Errorf("block %s still marked %q", id, mark)
		}
	}
}

func TestAgentLiveMarkLifecycle(t *testing.T) {
	blockId, _ := insertAgentBlock(t, agentMeta("claude", "--resume", "abc"))
	meta := agentMeta("claude", "--resume", "abc")

	first := markAgentLive(blockId, meta)
	if first == "" || liveMark(t, blockId) != first {
		t.Fatalf("mark = %q, block holds %q", first, liveMark(t, blockId))
	}
	// a relaunch marks its successor before the replaced process's exit is handled
	time.Sleep(time.Millisecond)
	second := markAgentLive(blockId, meta)
	clearAgentLive(blockId, first)
	if liveMark(t, blockId) != second {
		t.Fatalf("the replaced process's exit cleared its successor's mark")
	}
	clearAgentLive(blockId, second)
	if mark := liveMark(t, blockId); mark != "" {
		t.Fatalf("an exit on its own left the mark %q", mark)
	}

	shell, _ := insertAgentBlock(t, waveobj.MetaMapType{waveobj.MetaKey_Controller: BlockController_Shell})
	if token := markAgentLive(shell, waveobj.MetaMapType{waveobj.MetaKey_Controller: BlockController_Shell}); token != "" {
		t.Errorf("a shell block was marked live: %q", token)
	}
}

func TestAgentLiveMarkSurvivesShutdown(t *testing.T) {
	blockId, _ := insertAgentBlock(t, agentMeta("claude", "--resume", "abc"))
	token := markAgentLive(blockId, agentMeta("claude", "--resume", "abc"))
	shuttingDown.Store(true)
	t.Cleanup(func() { shuttingDown.Store(false) })
	clearAgentLive(blockId, token)
	if liveMark(t, blockId) != token {
		t.Fatalf("a quit cleared the mark the next boot restores from")
	}
}
