// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// swap sets *p to v for the test.
func swap[T any](t *testing.T, p *T, v T) {
	t.Helper()
	old := *p
	*p = v
	t.Cleanup(func() { *p = old })
}

// sleepWorld scripts everything sleeping and waking touch outside the roster: one block's meta, its controller, its
// process tree, the agent's status reports and what gets delivered to it.
type sleepWorld struct {
	t  *testing.T
	mu sync.Mutex

	meta      waveobj.MetaMapType // the block's meta, as the store holds it
	events    []string            // meta / destroy / kill / resync / deliver, in order
	delivered []agentsDelivery

	pids              []int32        // the agent's process tree
	alive             map[int32]bool // which of them run
	survivesStop      map[int32]bool // destroy does not end these
	unkillable        map[int32]bool // killPids does not end these either
	killed            []int32        // what killPids was handed
	sleepingAtDestroy bool           // agent:sleeping was already written when the controller was destroyed

	statusCalls  int
	status       func(call int) baseds.AgentStatusData // latestStatus
	exited       func() (bool, int)                    // controllerExited
	resyncs      int
	resyncErr    error
	onResync     func()
	argsAtResync any
}

func newSleepWorld(t *testing.T, meta waveobj.MetaMapType) *sleepWorld {
	t.Helper()
	w := &sleepWorld{
		t:            t,
		meta:         meta,
		pids:         []int32{10, 11},
		alive:        map[int32]bool{},
		survivesStop: map[int32]bool{},
		unkillable:   map[int32]bool{},
		status:       func(int) baseds.AgentStatusData { return baseds.AgentStatusData{} },
		exited:       func() (bool, int) { return false, 0 },
	}
	for _, pid := range w.pids {
		w.alive[pid] = true
	}
	swap(t, &readBlockMeta, func(context.Context, string) (waveobj.MetaMapType, error) {
		w.mu.Lock()
		defer w.mu.Unlock()
		cp := waveobj.MetaMapType{}
		for k, v := range w.meta {
			cp[k] = v
		}
		return cp, nil
	})
	swap(t, &updateBlockMeta, func(_ context.Context, _ string, update waveobj.MetaMapType) error {
		w.mu.Lock()
		defer w.mu.Unlock()
		w.events = append(w.events, "meta")
		for k, v := range update {
			if v == nil {
				delete(w.meta, k)
			} else {
				w.meta[k] = v
			}
		}
		return nil
	})
	swap(t, &destroyBlock, func(string) {
		w.mu.Lock()
		defer w.mu.Unlock()
		w.events = append(w.events, "destroy")
		_, w.sleepingAtDestroy = w.meta[waveobj.MetaKey_AgentSleeping]
		for _, pid := range w.pids {
			if !w.survivesStop[pid] {
				w.alive[pid] = false
			}
		}
	})
	swap(t, &resyncBlock, func(context.Context, string, string) error {
		w.mu.Lock()
		w.events = append(w.events, "resync")
		w.resyncs++
		w.argsAtResync = w.meta[waveobj.MetaKey_CmdArgs]
		on, err := w.onResync, w.resyncErr
		w.mu.Unlock()
		if on != nil {
			on()
		}
		return err
	})
	swap(t, &treePids, func(string) []int32 { return w.pids })
	swap(t, &pidsAlive, func(pids []int32) []int32 {
		w.mu.Lock()
		defer w.mu.Unlock()
		var live []int32
		for _, pid := range pids {
			if w.alive[pid] {
				live = append(live, pid)
			}
		}
		return live
	})
	swap(t, &killPids, func(pids []int32) {
		w.mu.Lock()
		defer w.mu.Unlock()
		w.events = append(w.events, "kill")
		w.killed = append(w.killed, pids...)
		for _, pid := range pids {
			if !w.unkillable[pid] {
				w.alive[pid] = false
			}
		}
	})
	swap(t, &consumerSampler, func() memusage.Sampler {
		return memusage.Sampler{Footprint: func(pid int32) (uint64, bool) { return uint64(pid) * 1000, true }}
	})
	swap(t, &latestStatus, func(string, string) baseds.AgentStatusData {
		w.mu.Lock()
		w.statusCalls++
		call := w.statusCalls
		w.mu.Unlock()
		return w.status(call)
	})
	swap(t, &controllerExited, func(string) (bool, int) { return w.exited() })
	swap(t, &hasStream, func(string) bool { return false })
	swap(t, &wakeReadyTimeout, 2*time.Second)
	swap(t, &wakePoll, time.Millisecond)
	swap(t, &sleepPoll, time.Millisecond)
	swap(t, &sleepStopWait, 30*time.Millisecond)
	swap(t, &sleepKillWait, 30*time.Millisecond)
	return w
}

// install scripts the roster over facts and makes deliveries land in the world's event log.
func (w *sleepWorld) install(facts *agentRosterFacts) {
	w.t.Helper()
	scriptAgents(w.t, facts)
	swap(w.t, &deliverAgentMessage, func(blockId, text string) {
		w.mu.Lock()
		defer w.mu.Unlock()
		w.events = append(w.events, "deliver")
		w.delivered = append(w.delivered, agentsDelivery{blockId, text})
	})
}

func (w *sleepWorld) eventLog() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return slices.Clone(w.events)
}

func (w *sleepWorld) metaValue(key string) any {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.meta[key]
}

func (w *sleepWorld) deliveries() []agentsDelivery {
	w.mu.Lock()
	defer w.mu.Unlock()
	return slices.Clone(w.delivered)
}

// readyAt is a status report from the agent that came after any wake.
func readyStatus() baseds.AgentStatusData {
	return baseds.AgentStatusData{State: baseds.AgentState_Idle, Ts: time.Now().UnixMilli() + 60_000}
}

// staleStatus is the idle report the sleep left behind.
func staleStatus() baseds.AgentStatusData {
	return baseds.AgentStatusData{State: baseds.AgentState_Idle, Ts: 1}
}

func claudeMeta() waveobj.MetaMapType {
	return waveobj.MetaMapType{
		waveobj.MetaKey_Cmd:     "claude",
		waveobj.MetaKey_CmdArgs: []any{"fix the bug"},
		"agent:baseargs":        []any{"--model", "opus"},
	}
}

// writeTranscript writes <stem>.jsonl in a fresh dir and returns its path.
func writeTranscript(t *testing.T, stem string, lines ...string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), stem+".jsonl")
	if err := os.WriteFile(p, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

const backgroundTaskLine = `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu1","name":"Bash","input":{"command":"npm run dev","description":"dev server","run_in_background":true}}]}}`

// idleClaude is an idle claude agent tab whose transcript is transcriptPath.
func idleClaude(transcriptPath string) agentTabFacts {
	tf := agentFacts(agentsTabA, "design", agentsBlockA, "claude", baseds.AgentState_Idle)
	tf.Status.TranscriptPath = transcriptPath
	return tf
}

// sleepingClaude is the tab of a claude agent that was put to sleep.
func sleepingClaude(slept time.Time) agentTabFacts {
	tf := agentFacts(agentsTabA, "design", agentsBlockA, "claude", baseds.AgentState_Idle)
	tf.ShellRunning = false
	tf.Cmd = "claude"
	tf.Sleeping = slept.UnixMilli()
	tf.SleepFreed = 21000
	tf.Status.TranscriptPath = filepath.Join("work", "abc.jsonl")
	return tf
}

func sleepingMeta(slept time.Time) waveobj.MetaMapType {
	return waveobj.MetaMapType{
		waveobj.MetaKey_Cmd:             "claude",
		waveobj.MetaKey_CmdArgs:         []any{"--resume", "abc", "--model", "opus"},
		"agent:baseargs":                []any{"--model", "opus"},
		waveobj.MetaKey_AgentSleeping:   float64(slept.UnixMilli()),
		waveobj.MetaKey_AgentSleepFreed: float64(21000),
	}
}

func rowOf(t *testing.T, tf agentTabFacts) *agentRow {
	t.Helper()
	rows := buildAgentRoster(&agentRosterFacts{Tabs: []agentTabFacts{tf}})
	if len(rows) != 1 {
		t.Fatalf("roster = %+v, want one row", rows)
	}
	return &rows[0]
}

func TestRosterKeepsASleepingAgent(t *testing.T) {
	slept := time.Now().Add(-time.Hour)
	rows := buildAgentRoster(&agentRosterFacts{Tabs: []agentTabFacts{sleepingClaude(slept)}})
	if len(rows) != 1 {
		t.Fatalf("roster = %+v, want the sleeping agent's row", rows)
	}
	row := rows[0]
	if row.State != wshrpc.AgentsState_Sleeping || row.SleptAt != slept.UnixMilli() || row.FreedBytes != 21000 {
		t.Errorf("row = %+v, want state sleeping, slept at %d, freed 21000", row.AgentInfo, slept.UnixMilli())
	}
	if row.TabId != agentsTabA || row.Name != "design" || row.Harness != "claude" || row.blockId != agentsBlockA {
		t.Errorf("row = %+v, want the tab, its name and the harness the block's cmd names", row)
	}
	if row.status.TranscriptPath == "" {
		t.Error("a sleeping row lost its transcript path")
	}
}

func TestRosterStillDropsAnEndedAgent(t *testing.T) {
	ended := agentFacts(agentsTabA, "design", agentsBlockA, "claude", baseds.AgentState_Idle)
	ended.ShellRunning = false
	ended.Cmd = "claude"
	if rows := buildAgentRoster(&agentRosterFacts{Tabs: []agentTabFacts{ended}}); len(rows) != 0 {
		t.Fatalf("roster = %+v, want no row for an agent that exited", rows)
	}
	// asleep, but not a harness the roster lists
	odd := sleepingClaude(time.Now())
	odd.Cmd = "codex"
	odd.Status.Agent = "codex"
	if rows := buildAgentRoster(&agentRosterFacts{Tabs: []agentTabFacts{odd}}); len(rows) != 0 {
		t.Fatalf("roster = %+v, want no row for a sleeping codex", rows)
	}
}

func TestSleepFactsFromBlockMeta(t *testing.T) {
	// the bare idle an exit publishes carries no transcript path and no cwd
	tf := agentTabFacts{Status: baseds.AgentStatusData{Agent: "claude", State: baseds.AgentState_Idle}}
	applySleepMeta(&tf, waveobj.MetaMapType{
		waveobj.MetaKey_Cmd:                 "claude",
		waveobj.MetaKey_AgentSleeping:       float64(1790000000000),
		waveobj.MetaKey_AgentSleepFreed:     float64(5000),
		waveobj.MetaKey_AgentTranscriptPath: "/t/abc.jsonl",
		waveobj.MetaKey_CmdCwd:              "/work/proj",
	})
	if tf.Sleeping != 1790000000000 || tf.SleepFreed != 5000 || tf.Cmd != "claude" {
		t.Errorf("facts = %+v, want sleeping, freed and cmd read from meta", tf)
	}
	if tf.Status.TranscriptPath != "/t/abc.jsonl" || tf.Status.Cwd != "/work/proj" {
		t.Errorf("status = %+v, want the transcript path and cwd the exit event lacked", tf.Status)
	}
	// what the status already says wins
	live := agentTabFacts{Status: baseds.AgentStatusData{TranscriptPath: "/live.jsonl", Cwd: "/live"}}
	applySleepMeta(&live, waveobj.MetaMapType{waveobj.MetaKey_AgentSleeping: float64(1), waveobj.MetaKey_AgentTranscriptPath: "/old.jsonl", waveobj.MetaKey_CmdCwd: "/old"})
	if live.Status.TranscriptPath != "/live.jsonl" || live.Status.Cwd != "/live" {
		t.Errorf("status = %+v, meta overrode what the status reported", live.Status)
	}
}

func TestSessionKey(t *testing.T) {
	cases := []struct {
		name, harness, transcript, sessionID, want string
	}{
		{"claude: the transcript's stem", "claude", "/p/abc-123.jsonl", "ignored", "abc-123"},
		{"claude on a windows path", "claude", `C:\Users\me\.claude\projects\x\abc-123.jsonl`, "", "abc-123"},
		{"pi: the whole path", "pi", `C:\Users\me\.pi\sessions\s.jsonl`, "ignored", `C:\Users\me\.pi\sessions\s.jsonl`},
		{"agy: the status's session id, never the transcript", "agy", "/p/transcript_full.jsonl", "conv-9", "conv-9"},
		{"claude without a transcript", "claude", "", "abc", ""},
		{"agy without a session id", "agy", "/p/transcript_full.jsonl", "", ""},
		{"codex has none", "codex", "/p/x.jsonl", "x", ""},
	}
	for _, c := range cases {
		if got := sessionKey(c.harness, c.transcript, c.sessionID); got != c.want {
			t.Errorf("%s: sessionKey = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestSleepWritesResumeArgsThenDestroys(t *testing.T) {
	w := newSleepWorld(t, claudeMeta())
	row := rowOf(t, idleClaude(writeTranscript(t, "abc")))
	before := time.Now().UnixMilli()

	rtn, err := sleepAgent(context.Background(), row, false)
	if err != nil {
		t.Fatal(err)
	}
	if rtn.FreedBytes != 21000 || len(rtn.Background) != 0 {
		t.Errorf("result = %+v, want 21000 bytes freed and no background work", rtn)
	}
	if got := w.eventLog(); !slices.Equal(got, []string{"meta", "destroy"}) {
		t.Fatalf("events = %v, want the meta write, then the destroy", got)
	}
	if !w.sleepingAtDestroy {
		t.Error("the controller was destroyed before agent:sleeping was written")
	}
	if got, _ := w.metaValue(waveobj.MetaKey_CmdArgs).([]string); !slices.Equal(got, []string{"--resume", "abc", "--model", "opus"}) {
		t.Errorf("cmd:args = %v, want --resume abc then the launch flags", w.metaValue(waveobj.MetaKey_CmdArgs))
	}
	if at, _ := w.metaValue(waveobj.MetaKey_AgentSleeping).(int64); at < before {
		t.Errorf("agent:sleeping = %v, want the time it slept", w.metaValue(waveobj.MetaKey_AgentSleeping))
	}
	if freed, _ := w.metaValue(waveobj.MetaKey_AgentSleepFreed).(int64); freed != 21000 {
		t.Errorf("agent:sleepfreed = %v, want 21000", w.metaValue(waveobj.MetaKey_AgentSleepFreed))
	}
}

func TestSleepRefusesWithoutASession(t *testing.T) {
	w := newSleepWorld(t, claudeMeta())
	_, err := sleepAgent(context.Background(), rowOf(t, idleClaude("")), false)
	if err == nil || !strings.Contains(err.Error(), "no session") {
		t.Fatalf("err = %v, want it to say the agent has no session to resume", err)
	}
	if got := w.eventLog(); len(got) != 0 {
		t.Errorf("events = %v, want nothing touched", got)
	}
}

func TestSleepRefusesAnAgentThatIsAlreadyAsleep(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	_, err := sleepAgent(context.Background(), rowOf(t, idleClaude(writeTranscript(t, "abc"))), false)
	if err == nil || !strings.Contains(err.Error(), "already asleep") {
		t.Fatalf("err = %v, want already asleep", err)
	}
	if got := w.eventLog(); len(got) != 0 {
		t.Errorf("events = %v, want nothing touched", got)
	}
}

func TestSleepReportsBackgroundWorkUnlessForced(t *testing.T) {
	w := newSleepWorld(t, claudeMeta())
	row := rowOf(t, idleClaude(writeTranscript(t, "abc", backgroundTaskLine)))

	rtn, err := sleepAgent(context.Background(), row, false)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(rtn.Background, []string{"dev server"}) || rtn.FreedBytes != 0 {
		t.Fatalf("result = %+v, want the background task named and nothing freed", rtn)
	}
	if got := w.eventLog(); len(got) != 0 {
		t.Fatalf("events = %v, want nothing slept while background work runs", got)
	}

	rtn, err = sleepAgent(context.Background(), row, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(rtn.Background) != 0 || rtn.FreedBytes != 21000 {
		t.Errorf("forced result = %+v, want it slept", rtn)
	}
	if got := w.eventLog(); !slices.Equal(got, []string{"meta", "destroy"}) {
		t.Errorf("events = %v, want the agent slept once forced", got)
	}
}

func TestSleepReportsARunningSubagent(t *testing.T) {
	w := newSleepWorld(t, claudeMeta())
	parent := writeTranscript(t, "abc")
	subDir := filepath.Join(filepath.Dir(parent), "abc", "subagents")
	if err := os.MkdirAll(subDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// a first prompt and no terminal turn after it: still running
	if err := os.WriteFile(filepath.Join(subDir, "agent-x1.jsonl"), []byte(`{"type":"user","message":{"content":"audit auth"}}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	rtn, err := sleepAgent(context.Background(), rowOf(t, idleClaude(parent)), false)
	if err != nil {
		t.Fatal(err)
	}
	if len(rtn.Background) != 1 || !strings.Contains(rtn.Background[0], "audit auth") {
		t.Fatalf("background = %q, want the running subagent named", rtn.Background)
	}
	if got := w.eventLog(); len(got) != 0 {
		t.Errorf("events = %v, want nothing slept", got)
	}
}

func TestSleepFailsWhenTheTreeSurvives(t *testing.T) {
	w := newSleepWorld(t, claudeMeta())
	w.survivesStop[11], w.unkillable[11] = true, true
	row := rowOf(t, idleClaude(writeTranscript(t, "abc")))

	_, err := sleepAgent(context.Background(), row, false)
	if err == nil || !strings.Contains(err.Error(), "did not stop") || !strings.Contains(err.Error(), "11") || !strings.Contains(err.Error(), "design") {
		t.Fatalf("err = %v, want it to name the agent and the pids that did not stop", err)
	}
	if !slices.Equal(w.killed, []int32{11}) {
		t.Errorf("killed = %v, want the survivor killed before giving up", w.killed)
	}
	if got, _ := w.metaValue(waveobj.MetaKey_CmdArgs).([]any); !reflect.DeepEqual(got, []any{"fix the bug"}) {
		t.Errorf("cmd:args = %#v, want the old args back", w.metaValue(waveobj.MetaKey_CmdArgs))
	}
	for _, key := range []string{waveobj.MetaKey_AgentSleeping, waveobj.MetaKey_AgentSleepFreed} {
		if v := w.metaValue(key); v != nil {
			t.Errorf("%s = %v, want it deleted", key, v)
		}
	}
}

func TestSleepKillsStragglersBeforeGivingUp(t *testing.T) {
	w := newSleepWorld(t, claudeMeta())
	w.survivesStop[11] = true // destroy leaves it, killPids ends it
	rtn, err := sleepAgent(context.Background(), rowOf(t, idleClaude(writeTranscript(t, "abc"))), false)
	if err != nil {
		t.Fatalf("err = %v, want the agent slept once its straggler was killed", err)
	}
	if rtn.FreedBytes != 21000 || !slices.Equal(w.killed, []int32{11}) {
		t.Errorf("result = %+v, killed = %v, want 21000 freed and only the straggler killed", rtn, w.killed)
	}
	if w.metaValue(waveobj.MetaKey_AgentSleeping) == nil {
		t.Error("agent:sleeping was not kept")
	}
}

func TestSleepCommandRefusals(t *testing.T) {
	lead := agentFacts(agentsTabB, "lead", agentsBlockB, "claude", baseds.AgentState_Idle)
	cases := []struct {
		name string
		tf   agentTabFacts
		runs []*waveobj.Run
		want string
	}{
		{"working", agentFacts(agentsTabA, "design", agentsBlockA, "claude", baseds.AgentState_Working), nil, "not idle"},
		{"waiting on a permission", agentFacts(agentsTabA, "design", agentsBlockA, "claude", baseds.AgentState_Waiting), nil, "not idle"},
		{"asking", agentFacts(agentsTabA, "design", agentsBlockA, "claude", baseds.AgentState_Asking), nil, "not idle"},
		{"already asleep", sleepingClaude(time.Now()), nil, "already asleep"},
		{"a run's worker", agentFacts(agentsTabA, "design", agentsBlockA, "claude", baseds.AgentState_Idle),
			[]*waveobj.Run{{OID: "run-1", Phases: []waveobj.RunPhase{{WorkerOrefs: []string{"tab:" + agentsTabA}}}}}, "run"},
	}
	for _, c := range cases {
		w := newSleepWorld(t, claudeMeta())
		c.tf.Status.TranscriptPath = writeTranscript(t, "abc")
		w.install(&agentRosterFacts{Tabs: []agentTabFacts{c.tf, lead}, Runs: c.runs})
		_, err := (&WshServer{}).AgentsSleepCommand(context.Background(), wshrpc.CommandAgentsSleepData{Tab: agentsTabA})
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: err = %v, want it to contain %q", c.name, err, c.want)
		}
		if got := w.eventLog(); len(got) != 0 {
			t.Errorf("%s: events = %v, want nothing touched", c.name, got)
		}
	}

	w := newSleepWorld(t, claudeMeta())
	tf := idleClaude(writeTranscript(t, "abc"))
	w.install(&agentRosterFacts{Tabs: []agentTabFacts{tf}})
	rtn, err := (&WshServer{}).AgentsSleepCommand(context.Background(), wshrpc.CommandAgentsSleepData{Tab: agentsTabA})
	if err != nil || rtn.FreedBytes != 21000 {
		t.Fatalf("an idle agent: rtn = %+v, err = %v, want it slept", rtn, err)
	}
}

func TestWakeCommandRefusesAnAwakeAgent(t *testing.T) {
	w := newSleepWorld(t, claudeMeta())
	w.install(&agentRosterFacts{Tabs: []agentTabFacts{idleClaude(writeTranscript(t, "abc"))}})
	err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA})
	if err == nil || !strings.Contains(err.Error(), "not asleep") {
		t.Fatalf("err = %v, want not asleep", err)
	}
	if w.resyncs != 0 {
		t.Error("an awake agent was restarted")
	}
}

func installSleeping(w *sleepWorld) {
	w.install(&agentRosterFacts{Tabs: []agentTabFacts{sleepingClaude(time.Now())}})
}

func TestWakeRestartsWithForceAndClearsMetaOnceReady(t *testing.T) {
	meta := sleepingMeta(time.Now())
	meta[waveobj.MetaKey_AgentWakeFailed] = "it exited (code 1) before it came back"
	w := newSleepWorld(t, meta)
	installSleeping(w)
	// stale for two polls, then the resumed agent reports in
	w.status = func(call int) baseds.AgentStatusData {
		if call < 3 {
			return staleStatus()
		}
		return readyStatus()
	}

	err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA})
	if err != nil {
		t.Fatal(err)
	}
	if w.statusCalls < 3 {
		t.Errorf("status read %d times, want the wake to wait for the report even with no message", w.statusCalls)
	}
	if got := w.eventLog(); !slices.Equal(got, []string{"meta", "resync", "meta"}) {
		t.Errorf("events = %v, want the failure cleared, the restart, then the sleep keys cleared", got)
	}
	for _, key := range []string{waveobj.MetaKey_AgentSleeping, waveobj.MetaKey_AgentSleepFreed, waveobj.MetaKey_AgentWakeFailed} {
		if v := w.metaValue(key); v != nil {
			t.Errorf("%s = %v, want it deleted", key, v)
		}
	}
	if got, _ := w.argsAtResync.([]any); !reflect.DeepEqual(got, []any{"--resume", "abc", "--model", "opus"}) {
		t.Errorf("cmd:args at the restart = %#v, want the resume args kept", w.argsAtResync)
	}
	if len(w.deliveries()) != 0 {
		t.Error("a wake with no message delivered something")
	}
}

func TestWakeThatExitsBeforeReadyStaysAsleepWithTheReason(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	installSleeping(w)
	w.exited = func() (bool, int) { return true, 1 }

	err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "carry on"})
	if err == nil || !strings.Contains(err.Error(), "exited (code 1) before it came back") {
		t.Fatalf("err = %v, want the exit named", err)
	}
	if v := w.metaValue(waveobj.MetaKey_AgentSleeping); v == nil {
		t.Error("agent:sleeping was cleared though the agent never came back")
	}
	if reason, _ := w.metaValue(waveobj.MetaKey_AgentWakeFailed).(string); !strings.Contains(reason, "exited (code 1) before it came back") {
		t.Errorf("agent:wakefailed = %q, want the reason the card shows", reason)
	}
	if len(w.deliveries()) != 0 {
		t.Errorf("delivered %+v, want nothing sent to an agent that did not come back", w.deliveries())
	}
}

func TestWakeIgnoresTheIdleAnExitPublishes(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	installSleeping(w)
	// an exit publishes a bare idle, stamped after the wake
	w.status = func(int) baseds.AgentStatusData { return readyStatus() }
	w.exited = func() (bool, int) { return true, 2 }

	err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "carry on"})
	if err == nil {
		t.Fatal("a status published by an exit counted as the agent coming back")
	}
	if w.metaValue(waveobj.MetaKey_AgentSleeping) == nil || len(w.deliveries()) != 0 {
		t.Errorf("agent:sleeping = %v, delivered = %+v, want it asleep and nothing sent", w.metaValue(waveobj.MetaKey_AgentSleeping), w.deliveries())
	}
}

func TestWakeFreshDropsTheResumeArgs(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	installSleeping(w)
	w.status = func(int) baseds.AgentStatusData { return readyStatus() }

	err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Fresh: true})
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := w.argsAtResync.([]string); !slices.Equal(got, []string{"--model", "opus"}) {
		t.Errorf("cmd:args at the restart = %#v, want the launch flags with no --resume", w.argsAtResync)
	}
	if w.resyncs != 1 {
		t.Errorf("restarts = %d, want 1", w.resyncs)
	}
}

func TestWakeDeliversTheMessageOnceTheAgentReportsIn(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	installSleeping(w)
	w.status = func(call int) baseds.AgentStatusData {
		if call < 3 {
			return staleStatus()
		}
		return readyStatus()
	}

	err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "carry on"})
	if err != nil {
		t.Fatal(err)
	}
	if got := w.deliveries(); len(got) != 1 || got[0].blockId != agentsBlockA || got[0].text != "carry on" {
		t.Fatalf("delivered %+v, want the message once, to the agent's block", got)
	}
	if got := w.eventLog(); got[len(got)-2] != "meta" || got[len(got)-1] != "deliver" {
		t.Errorf("events = %v, want the sleep keys cleared before the message", got)
	}
}

func TestWakeReadyOnTheControlStream(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	installSleeping(w)
	calls := 0
	swap(t, &hasStream, func(string) bool { calls++; return calls >= 3 })

	if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "carry on"}); err != nil {
		t.Fatal(err)
	}
	if len(w.deliveries()) != 1 {
		t.Errorf("delivered %+v, want the message once the mod attached", w.deliveries())
	}
}

func TestWakeTimesOutWithoutDelivering(t *testing.T) {
	cases := []struct {
		name, message, want string
	}{
		{"with a message", "carry on", "your message was not sent"},
		{"without one", "", "did not report in"},
	}
	for _, c := range cases {
		w := newSleepWorld(t, sleepingMeta(time.Now()))
		installSleeping(w)
		swap(t, &wakeReadyTimeout, 40*time.Millisecond)
		swap(t, &wakePoll, 5*time.Millisecond)
		w.status = func(int) baseds.AgentStatusData { return staleStatus() }

		err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: c.message})
		if err == nil || !strings.Contains(err.Error(), c.want) || !strings.Contains(err.Error(), "design") {
			t.Fatalf("%s: err = %v, want it to name the agent and say %q", c.name, err, c.want)
		}
		for _, key := range []string{waveobj.MetaKey_AgentSleeping, waveobj.MetaKey_AgentSleepFreed} {
			if v := w.metaValue(key); v != nil {
				t.Errorf("%s: %s = %v, want it deleted: the process is running", c.name, key, v)
			}
		}
		if len(w.deliveries()) != 0 {
			t.Errorf("%s: delivered %+v, want nothing", c.name, w.deliveries())
		}
	}
}

func TestWakeThatCannotStartStaysAsleepWithTheReason(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	installSleeping(w)
	w.resyncErr = context.DeadlineExceeded

	err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA})
	if err == nil {
		t.Fatal("a restart that failed reported success")
	}
	if w.metaValue(waveobj.MetaKey_AgentSleeping) == nil {
		t.Error("agent:sleeping was cleared though nothing started")
	}
	if reason, _ := w.metaValue(waveobj.MetaKey_AgentWakeFailed).(string); reason == "" {
		t.Error("agent:wakefailed was not set for the card to show")
	}
}

func TestASecondWakeWaitsForTheFirst(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	installSleeping(w)
	resynced := make(chan struct{})
	release := make(chan struct{})
	w.onResync = func() { close(resynced) }
	w.status = func(int) baseds.AgentStatusData {
		select {
		case <-release:
			return readyStatus()
		default:
			return staleStatus()
		}
	}

	errs := make(chan error, 2)
	go func() {
		errs <- (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA})
	}()
	<-resynced
	go func() {
		errs <- (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "later"})
	}()
	time.Sleep(30 * time.Millisecond)
	close(release)
	for range 2 {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	if w.resyncs != 1 {
		t.Errorf("restarts = %d, want the second wake to wait for the first, not restart it", w.resyncs)
	}
	if got := w.deliveries(); len(got) != 1 || got[0].text != "later" {
		t.Errorf("delivered %+v, want the second wake's message once", got)
	}
}

func TestSendToASleepingAgentWakesIt(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	sender := agentFacts(agentsTabB, "lead", agentsBlockB, "claude", baseds.AgentState_Working)
	w.install(&agentRosterFacts{Tabs: []agentTabFacts{sleepingClaude(time.Now()), sender}})
	w.status = func(int) baseds.AgentStatusData { return readyStatus() }

	rtn, err := (&WshServer{}).AgentsSendCommand(context.Background(), wshrpc.CommandAgentsSendData{Tab: agentsTabA, Text: "tabs, not spaces", FromORef: blockORef(agentsBlockB)})
	if err != nil {
		t.Fatal(err)
	}
	if rtn.TabId != agentsTabA {
		t.Errorf("result = %+v, want the sleeping agent's tab", rtn)
	}
	if w.resyncs != 1 {
		t.Errorf("restarts = %d, want the send to wake the agent", w.resyncs)
	}
	got := w.deliveries()
	if len(got) != 1 || got[0].blockId != agentsBlockA || !strings.Contains(got[0].text, "tabs, not spaces") || !strings.Contains(got[0].text, "lead") {
		t.Fatalf("delivered %+v, want the envelope to the woken agent once", got)
	}
}

func TestSendToASleepingAgentThatDoesNotComeBackReportsIt(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	sender := agentFacts(agentsTabB, "lead", agentsBlockB, "claude", baseds.AgentState_Working)
	w.install(&agentRosterFacts{Tabs: []agentTabFacts{sleepingClaude(time.Now()), sender}})
	w.exited = func() (bool, int) { return true, 1 }

	_, err := (&WshServer{}).AgentsSendCommand(context.Background(), wshrpc.CommandAgentsSendData{Tab: agentsTabA, Text: "tabs, not spaces", FromORef: blockORef(agentsBlockB)})
	if err == nil {
		t.Fatal("a send to an agent that did not wake reported success")
	}
	if len(w.deliveries()) != 0 {
		t.Errorf("delivered %+v, want nothing", w.deliveries())
	}
}

func TestSetModelRefusesASleepingAgent(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	installSleeping(w)
	_, err := (&WshServer{}).AgentsSetModelCommand(context.Background(), wshrpc.CommandAgentsSetModelData{Tab: agentsTabA, Model: "sonnet"})
	if err == nil || !strings.Contains(err.Error(), "is asleep; wake it first") {
		t.Fatalf("err = %v, want it to say the agent is asleep", err)
	}
	if len(w.deliveries()) != 0 {
		t.Errorf("delivered %+v, want no /model line sent to no process", w.deliveries())
	}
}

func TestSetViewingExpires(t *testing.T) {
	swap(t, &viewing, viewingPush{})
	if got := viewingTabs(time.Now()); len(got) != 0 {
		t.Fatalf("viewing = %v before any push, want none", got)
	}
	if err := (&WshServer{}).AgentsSetViewingCommand(context.Background(), wshrpc.CommandAgentsSetViewingData{TabIds: []string{agentsTabA, agentsTabB}}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if got := viewingTabs(now); !got[agentsTabA] || !got[agentsTabB] || len(got) != 2 {
		t.Errorf("viewing = %v, want both tabs just pushed", got)
	}
	if got := viewingTabs(now.Add(2*time.Minute + 59*time.Second)); len(got) != 2 {
		t.Errorf("viewing = %v, want the push still good just under 3 minutes on", got)
	}
	if got := viewingTabs(now.Add(3*time.Minute + 2*time.Second)); len(got) != 0 {
		t.Errorf("viewing = %v, want a push older than 3 minutes to count as none", got)
	}
	// a fresh push replaces the last
	if err := (&WshServer{}).AgentsSetViewingCommand(context.Background(), wshrpc.CommandAgentsSetViewingData{TabIds: []string{agentsTabC}}); err != nil {
		t.Fatal(err)
	}
	if got := viewingTabs(time.Now()); len(got) != 1 || !got[agentsTabC] {
		t.Errorf("viewing = %v, want only the latest push", got)
	}
}
