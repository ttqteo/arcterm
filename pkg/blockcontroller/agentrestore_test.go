// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"context"
	"slices"
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

func TestResumeArgs(t *testing.T) {
	cases := []struct {
		name, harness, session string
		base, want             []string
		ok                     bool
	}{
		{"claude puts the session first, the launch flags after", "claude", "abc", []string{"--model", "opus"}, []string{"--resume", "abc", "--model", "opus"}, true},
		{"claude with no launch flags", "claude", "abc", nil, []string{"--resume", "abc"}, true},
		{"claude drops a resume it already carried", "claude", "new", []string{"--resume", "old", "--continue", "--model", "opus"}, []string{"--resume", "new", "--model", "opus"}, true},
		{"claude drops a bare resume (its own picker), not the flag after it", "claude", "new", []string{"--resume", "--settings", "ask.json"}, []string{"--resume", "new", "--settings", "ask.json"}, true},
		{"pi takes the transcript path whole", "pi", `C:\t\s.jsonl`, []string{"--session", "old", "--model", "x"}, []string{"--session", `C:\t\s.jsonl`, "--model", "x"}, true},
		{"agy", "agy", "c1", []string{"--sandbox", "-c", "--conversation", "old"}, []string{"--conversation", "c1", "--sandbox"}, true},
		{"opencode", "opencode", "ses_1", []string{"-s", "old", "--continue", "--x"}, []string{"-s", "ses_1", "--x"}, true},
		{"codex resumes through its subcommand", "codex", "abc", nil, []string{"resume", "abc"}, true},
		{"codex keeps its launch flags after the subcommand", "codex", "abc", []string{"--model", "gpt-5.5"}, []string{"resume", "abc", "--model", "gpt-5.5"}, true},
		{"a harness with no resume flag", "shell", "abc", nil, nil, false},
		{"no session to reopen", "claude", "", []string{"--model", "opus"}, nil, false},
	}
	for _, c := range cases {
		base := append([]string(nil), c.base...)
		got, ok := ResumeArgs(c.harness, c.session, c.base)
		if ok != c.ok || !slices.Equal(got, c.want) {
			t.Errorf("%s: ResumeArgs = %q, %v; want %q, %v", c.name, got, ok, c.want, c.ok)
		}
		if !slices.Equal(c.base, base) {
			t.Errorf("%s: ResumeArgs changed its base args to %q", c.name, c.base)
		}
	}
}

func TestStripSessionArgs(t *testing.T) {
	got := StripSessionArgs("pi", []string{"--session", "old.jsonl", "--model", "x"})
	if !slices.Equal(got, []string{"--model", "x"}) {
		t.Errorf("StripSessionArgs(pi) = %q, want the session dropped", got)
	}
	if got := StripSessionArgs("claude", nil); got == nil || len(got) != 0 {
		t.Errorf("StripSessionArgs of nothing = %#v, want an empty list that is not nil", got)
	}
	if got := StripSessionArgs("codex", []string{"--resume", "x"}); !slices.Equal(got, []string{"--resume", "x"}) {
		t.Errorf("StripSessionArgs(codex) = %q, want a harness with no session flags left alone", got)
	}
}

// a woken agent must come back after a crash or an update: shouldRestoreAgent wants the flag and the session first
func TestShouldRestoreAgentAcceptsResumeArgs(t *testing.T) {
	for _, harness := range []string{"claude", "pi", "agy", "opencode"} {
		args, ok := ResumeArgs(harness, "session-1", []string{"--model", "x", "--resume", "stale"})
		if !ok {
			t.Fatalf("%s: no resume args", harness)
		}
		meta := withMeta(agentMeta(harness, args...), MetaKey_AgentLive, "123")
		if !shouldRestoreAgent(meta) {
			t.Errorf("%s: shouldRestoreAgent rejects cmd:args %q", harness, args)
		}
	}
}

func TestAgentAsleep(t *testing.T) {
	if agentAsleep(agentMeta("claude", "--resume", "abc")) {
		t.Error("an agent with no sleep mark is awake")
	}
	if !agentAsleep(withMeta(agentMeta("claude", "--resume", "abc"), waveobj.MetaKey_AgentSleeping, float64(1790000000000))) {
		t.Error("an agent with agent:sleeping set is asleep")
	}
	if agentAsleep(withMeta(agentMeta("claude", "--resume", "abc"), waveobj.MetaKey_AgentSleeping, float64(0))) {
		t.Error("agent:sleeping of 0 is awake")
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

func inTurnMark(t *testing.T, blockId string) bool {
	t.Helper()
	block, err := wstore.DBMustGet[*waveobj.Block](context.Background(), blockId)
	if err != nil {
		t.Fatal(err)
	}
	return block.Meta.GetBool(MetaKey_AgentInTurn, false)
}

func TestRestoreLiveAgents(t *testing.T) {
	var mu sync.Mutex
	started := map[string]string{} // blockId -> tabId
	nudged := map[string]bool{}
	done := make(chan struct{}, 8)
	oldRestart, oldStagger := restartAgentBlock, restoreAgentStagger
	restartAgentBlock = func(_ context.Context, tabId, blockId string) error {
		mu.Lock()
		started[blockId] = tabId
		nudged[blockId] = takeRestoreNudge(blockId, time.Now())
		mu.Unlock()
		done <- struct{}{}
		return nil
	}
	restoreAgentStagger = time.Millisecond
	t.Cleanup(func() { restartAgentBlock, restoreAgentStagger = oldRestart, oldStagger })

	live := func(m waveobj.MetaMapType) waveobj.MetaMapType { return withMeta(m, MetaKey_AgentLive, "1") }
	inTurn := func(m waveobj.MetaMapType) waveobj.MetaMapType { return withMeta(m, MetaKey_AgentInTurn, true) }
	claude, claudeTab := insertAgentBlock(t, live(agentMeta("claude", "--resume", "abc")))
	pi, piTab := insertAgentBlock(t, live(agentMeta("pi", "--session", "/s.jsonl")))
	busy, busyTab := insertAgentBlock(t, inTurn(live(agentMeta("claude", "--resume", "mid"))))
	unbaked, _ := insertAgentBlock(t, live(agentMeta("claude", "fix the bug")))
	orphan, _ := insertAgentBlock(t, agentMeta("claude", "--resume", "old"))
	// in turn when its process died on its own: never restored, and its mark is stale
	died, _ := insertAgentBlock(t, inTurn(agentMeta("claude", "--resume", "gone")))
	worker, _ := insertAgentBlock(t, withMeta(live(agentMeta("claude", "--resume", "w")), metaKeyAgentRunId, "r1"))

	RestoreLiveAgents(context.Background())
	for range 3 {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("restored agents did not start")
		}
	}
	select {
	case <-done:
		t.Fatal("started more than the three restorable agents")
	case <-time.After(50 * time.Millisecond):
	}

	mu.Lock()
	defer mu.Unlock()
	if started[claude] != claudeTab || started[pi] != piTab || started[busy] != busyTab {
		t.Errorf("started %v, want claude in %s, pi in %s and the busy claude in %s", started, claudeTab, piTab, busyTab)
	}
	var ids []string
	for id := range started {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	if len(ids) != 3 {
		t.Errorf("started %v, want only claude, pi and the busy claude", ids)
	}
	// only the agent cut off mid-turn is nudged to carry on
	if !nudged[busy] || nudged[claude] || nudged[pi] {
		t.Errorf("nudged %v, want only the busy claude %s", nudged, busy)
	}
	// every mark the last server left is cleared; a relaunch sets its own
	for _, id := range []string{claude, pi, busy, unbaked, orphan, died, worker} {
		if mark := liveMark(t, id); mark != "" {
			t.Errorf("block %s still marked %q", id, mark)
		}
		if inTurnMark(t, id) {
			t.Errorf("block %s still marked in turn", id)
		}
	}
}

// two tabs on one conversation would run two processes writing one transcript: the boot brings back one of them, the
// one cut off mid-turn first, else the one started last, and puts the other to sleep so its pane does not start it
func TestRestoreLiveAgentsRunsOneBlockPerSession(t *testing.T) {
	var mu sync.Mutex
	started := map[string]bool{}
	done := make(chan struct{}, 8)
	oldRestart, oldStagger := restartAgentBlock, restoreAgentStagger
	restartAgentBlock = func(_ context.Context, _, blockId string) error {
		mu.Lock()
		started[blockId] = true
		mu.Unlock()
		done <- struct{}{}
		return nil
	}
	restoreAgentStagger = time.Millisecond
	t.Cleanup(func() { restartAgentBlock, restoreAgentStagger = oldRestart, oldStagger })

	live := func(token string, m waveobj.MetaMapType) waveobj.MetaMapType {
		return withMeta(m, MetaKey_AgentLive, token)
	}
	older, _ := insertAgentBlock(t, live("100", agentMeta("claude", "--resume", "dup")))
	newer, _ := insertAgentBlock(t, live("200", agentMeta("claude", "--resume", "dup", "--model", "opus")))
	busy, _ := insertAgentBlock(t, withMeta(live("100", agentMeta("claude", "--resume", "dup2")), MetaKey_AgentInTurn, true))
	idle, _ := insertAgentBlock(t, live("300", agentMeta("claude", "--resume", "dup2")))
	alone, _ := insertAgentBlock(t, live("100", agentMeta("pi", "--session", "/dup")))

	RestoreLiveAgents(context.Background())
	for range 3 {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("restored agents did not start")
		}
	}
	select {
	case <-done:
		t.Fatal("started a second block on one session")
	case <-time.After(50 * time.Millisecond):
	}

	mu.Lock()
	defer mu.Unlock()
	if !started[newer] || !started[busy] || !started[alone] || started[older] || started[idle] {
		t.Errorf("started %v, want %s (started last), %s (mid-turn) and %s (its own session)", started, newer, busy, alone)
	}
	for _, id := range []string{older, idle} {
		block, err := wstore.DBMustGet[*waveobj.Block](context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if !agentAsleep(block.Meta) {
			t.Errorf("block %s left awake beside the one restored on its session", id)
		}
	}
	for _, id := range []string{newer, busy, alone} {
		block, _ := wstore.DBMustGet[*waveobj.Block](context.Background(), id)
		if agentAsleep(block.Meta) {
			t.Errorf("restored block %s marked asleep", id)
		}
	}
}

func TestShouldRestoreAgentWantsASession(t *testing.T) {
	// a bare --resume opens claude's picker, which names no session to bring back
	if shouldRestoreAgent(withMeta(agentMeta("claude", "--resume", "--settings", "ask.json"), MetaKey_AgentLive, "1")) {
		t.Error("a bare --resume was restored")
	}
}

func TestInTurnForState(t *testing.T) {
	cases := []struct {
		state        string
		inTurn, isOk bool
	}{
		{"working", true, true},
		{"waiting", true, true}, // a permission prompt, mid-turn
		{"asking", true, true},
		{"idle", false, true},
		{"", false, false}, // a usage snapshot
		{"bogus", false, false},
	}
	for _, c := range cases {
		if inTurn, ok := inTurnForState(c.state); inTurn != c.inTurn || ok != c.isOk {
			t.Errorf("inTurnForState(%q) = %v, %v, want %v, %v", c.state, inTurn, ok, c.inTurn, c.isOk)
		}
	}
}

func TestWithRestoreNudge(t *testing.T) {
	cases := []struct {
		harness string
		args    []string
		want    []string
		ok      bool
	}{
		{"claude", []string{"--resume", "abc", "--model", "opus"}, []string{"--resume", "abc", "--model", "opus", "go on"}, true},
		{"pi", []string{"--session", "/s.jsonl"}, []string{"--session", "/s.jsonl", "go on"}, true},
		{"codex", []string{"resume", "abc"}, []string{"resume", "abc", "go on"}, true},
		{"agy", []string{"--conversation", "abc"}, []string{"--conversation", "abc", "-i", "go on"}, true},
		// opencode's positional arg is a project directory, not a prompt
		{"opencode", []string{"-s", "abc"}, []string{"-s", "abc"}, false},
	}
	for _, c := range cases {
		args := slices.Clone(c.args)
		got, ok := withRestoreNudge(c.harness, args, "go on")
		if ok != c.ok || !slices.Equal(got, c.want) {
			t.Errorf("withRestoreNudge(%s) = %v, %v, want %v, %v", c.harness, got, ok, c.want, c.ok)
		}
		if !slices.Equal(args, c.args) {
			t.Errorf("withRestoreNudge(%s) changed the args it was given: %v", c.harness, args)
		}
	}
}

func TestRestoreStartArgsTakesTheNudgeOnce(t *testing.T) {
	blockId := uuid.NewString()
	meta := agentMeta("claude", "--resume", "abc")
	args := []string{"--resume", "abc"}
	if got := restoreStartArgs(blockId, meta, args); !slices.Equal(got, args) {
		t.Fatalf("a start with no nudge queued ran %v", got)
	}
	queueRestoreNudge(blockId, time.Now())
	if got := restoreStartArgs(blockId, meta, args); !slices.Equal(got, []string{"--resume", "abc", restoreNudge}) {
		t.Fatalf("the restore's start ran %v", got)
	}
	if got := restoreStartArgs(blockId, meta, args); !slices.Equal(got, args) {
		t.Fatalf("a second start repeated the nudge: %v", got)
	}
	// a start long after the restore queued it is not the turn it was for
	queueRestoreNudge(blockId, time.Now().Add(-2*restoreNudgeTTL))
	if got := restoreStartArgs(blockId, meta, args); !slices.Equal(got, args) {
		t.Fatalf("a late start took a stale nudge: %v", got)
	}
}

func TestNoteAgentState(t *testing.T) {
	blockId, _ := insertAgentBlock(t, agentMeta("claude", "--resume", "abc"))
	steps := []struct {
		state string
		want  bool
	}{
		{"working", true},
		{"", true}, // a usage snapshot leaves the mark as it is
		{"waiting", true},
		{"asking", true},
		{"idle", false},
		{"working", true},
	}
	for _, s := range steps {
		NoteAgentState(blockId, s.state)
		if got := inTurnMark(t, blockId); got != s.want {
			t.Fatalf("after %q the block is in turn %v, want %v", s.state, got, s.want)
		}
	}

	// a quit's last reports must not clear the mark the next boot nudges from
	shuttingDown.Store(true)
	NoteAgentState(blockId, "idle")
	shuttingDown.Store(false)
	if !inTurnMark(t, blockId) {
		t.Fatal("an idle reported while quitting cleared the in-turn mark")
	}

	shell, _ := insertAgentBlock(t, waveobj.MetaMapType{waveobj.MetaKey_Controller: BlockController_Shell})
	NoteAgentState(shell, "working")
	if inTurnMark(t, shell) {
		t.Error("a shell block was marked in turn")
	}
	worker, _ := insertAgentBlock(t, withMeta(agentMeta("claude", "--resume", "w"), metaKeyAgentRunId, "r1"))
	NoteAgentState(worker, "working")
	if inTurnMark(t, worker) {
		t.Error("a run's worker was marked in turn: its run brings it back")
	}
}

// a server relaunch (the boot restore, a pane mounting) must not start a sleeping agent; only a forced restart, which
// a wake is, does. Stopping the check at the guard also keeps the test from launching a real process.
func TestResyncLeavesASleepingAgentAsleepUnlessForced(t *testing.T) {
	meta := withMeta(agentMeta("claude", "--resume", "abc"), waveobj.MetaKey_AgentSleeping, float64(1790000000000))
	blockId, tabId := insertAgentBlock(t, meta)
	if err := ResyncController(context.Background(), tabId, blockId, nil, false); err != nil {
		t.Fatalf("ResyncController on a sleeping agent: %v", err)
	}
	if getController(blockId) != nil {
		DestroyBlockController(blockId)
		t.Fatal("a non-forced resync started a sleeping agent")
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
	NoteAgentState(blockId, "working")
	clearAgentLive(blockId, second)
	if mark := liveMark(t, blockId); mark != "" {
		t.Fatalf("an exit on its own left the mark %q", mark)
	}
	if inTurnMark(t, blockId) {
		t.Fatal("an exit on its own left the agent marked in turn")
	}
	// and the next process's turn marks it again
	NoteAgentState(blockId, "working")
	if !inTurnMark(t, blockId) {
		t.Fatal("a turn after a relaunch did not mark the agent in turn")
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
