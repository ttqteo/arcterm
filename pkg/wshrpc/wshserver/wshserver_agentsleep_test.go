// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/agentmsg"
	"github.com/wavetermdev/waveterm/pkg/agentsleep"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
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

	pids              []int32         // the agent's process tree
	alive             map[int32]bool  // which of them run
	survivesStop      map[int32]bool  // destroy does not end these
	unkillable        map[int32]bool  // killPids does not end these either
	started           map[int32]int64 // a pid's start time, when not its default (pid*10): another process took it
	killed            []int32         // what killPids was handed
	sleepingAtDestroy bool            // agent:sleeping was already written when the controller was destroyed

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
		started:      map[int32]int64{},
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
	swap(t, &updateBlockMeta, func(ctx context.Context, _ string, update waveobj.MetaMapType) error {
		// the store refuses a write whose context is over
		if err := ctx.Err(); err != nil {
			return err
		}
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
	swap(t, &pidStarted, func(pid int32) (int64, bool) {
		w.mu.Lock()
		defer w.mu.Unlock()
		if !w.alive[pid] {
			return 0, false
		}
		if at, ok := w.started[pid]; ok {
			return at, true
		}
		return int64(pid) * 10, true
	})
	swap(t, &leftovers, map[string]map[int32]int64{})
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
	w.exited = func() (bool, int) { return true, -1 } // asleep: its controller is gone
	_, err := sleepAgent(context.Background(), rowOf(t, idleClaude(writeTranscript(t, "abc"))), false)
	if err == nil || !strings.Contains(err.Error(), "already asleep") {
		t.Fatalf("err = %v, want already asleep", err)
	}
	if got := w.eventLog(); len(got) != 0 {
		t.Errorf("events = %v, want nothing touched", got)
	}
}

// a block whose process runs while its agent:sleeping mark stayed (a forced restart that was no wake, 2026-11-26: a
// Claude account switch restarted sleeping agents) is awake: the mark is stale, and the sleep goes ahead instead of
// failing "already asleep" every minute
func TestSleepGoesAheadOverAStaleSleepingMark(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now().Add(-time.Hour)))
	w.exited = func() (bool, int) { return false, 0 } // its process runs
	if _, err := sleepAgent(context.Background(), rowOf(t, idleClaude(writeTranscript(t, "abc"))), false); err != nil {
		t.Fatalf("err = %v, want the awake agent slept", err)
	}
	if got := w.eventLog(); !slices.Contains(got, "destroy") {
		t.Fatalf("events = %v, want its process stopped", got)
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

// a tree still ending after the destroy and the kill (a machine paging hard): the controller is gone either way, so the
// agent stays asleep with its Wake, rather than a tab with no process and no Wake, and the survivor is remembered
func TestSleepKeepsTheAgentAsleepWhenTheTreeOutlivesTheKill(t *testing.T) {
	w := newSleepWorld(t, claudeMeta())
	w.survivesStop[11], w.unkillable[11] = true, true
	row := rowOf(t, idleClaude(writeTranscript(t, "abc")))

	rtn, err := sleepAgent(context.Background(), row, false)
	if err != nil {
		t.Fatalf("err = %v, want the agent asleep though pid 11 still runs", err)
	}
	if !slices.Equal(w.killed, []int32{11}) {
		t.Errorf("killed = %v, want the survivor killed", w.killed)
	}
	if rtn.FreedBytes != 10000 {
		t.Errorf("freed = %d, want 10000: only pid 10 ended", rtn.FreedBytes)
	}
	if freed, _ := w.metaValue(waveobj.MetaKey_AgentSleepFreed).(int64); freed != 10000 {
		t.Errorf("agent:sleepfreed = %v, want 10000", w.metaValue(waveobj.MetaKey_AgentSleepFreed))
	}
	if w.metaValue(waveobj.MetaKey_AgentSleeping) == nil {
		t.Error("agent:sleeping was cleared")
	}
	if got, _ := w.metaValue(waveobj.MetaKey_CmdArgs).([]string); !slices.Equal(got, []string{"--resume", "abc", "--model", "opus"}) {
		t.Errorf("cmd:args = %v, want the resume args kept for the wake", w.metaValue(waveobj.MetaKey_CmdArgs))
	}
	if got := liveLeftovers(agentsBlockA); !slices.Equal(got, []int32{11}) {
		t.Errorf("leftovers = %v, want pid 11 remembered", got)
	}
}

// the wake ends what the sleep left running before it starts a process on the same conversation
func TestWakeEndsWhatTheSleepLeftBeforeItRestarts(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	installSleeping(w)
	w.status = func(int) baseds.AgentStatusData { return readyStatus() }
	noteLeftovers(agentsBlockA, []int32{11})

	if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA}); err != nil {
		t.Fatal(err)
	}
	if got := w.eventLog(); !slices.Equal(got, []string{"meta", "kill", "resync", "meta"}) {
		t.Errorf("events = %v, want the leftover killed before the restart", got)
	}
	if got := liveLeftovers(agentsBlockA); len(got) != 0 {
		t.Errorf("leftovers = %v, want none once they ended", got)
	}
}

// a leftover that will not end keeps the agent asleep with the reason: a restart would run two processes on one
// transcript
func TestWakeRefusesWhileWhatTheSleepLeftStillRuns(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	installSleeping(w)
	w.unkillable[11] = true
	noteLeftovers(agentsBlockA, []int32{11})

	err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA})
	if err == nil || !strings.Contains(err.Error(), "11") {
		t.Fatalf("err = %v, want the wake refused naming pid 11", err)
	}
	if w.resyncs != 0 {
		t.Errorf("restarts = %d, want none while the old process runs", w.resyncs)
	}
	if w.metaValue(waveobj.MetaKey_AgentSleeping) == nil {
		t.Error("agent:sleeping was cleared though nothing started")
	}
	if reason, _ := w.metaValue(waveobj.MetaKey_AgentWakeFailed).(string); !strings.Contains(reason, "still ending") {
		t.Errorf("agent:wakefailed = %q, want the reason for the card", reason)
	}
}

// a pid number another process took after the slept one ended is not the agent's: the wake leaves it alone
func TestWakeLeavesAPidAnotherProcessTookAlone(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	installSleeping(w)
	w.status = func(int) baseds.AgentStatusData { return readyStatus() }
	noteLeftovers(agentsBlockA, []int32{11})
	w.mu.Lock()
	w.started[11] = 999 // pid 11 now runs a process that started later
	w.mu.Unlock()

	if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA}); err != nil {
		t.Fatal(err)
	}
	if len(w.killed) != 0 {
		t.Errorf("killed = %v, want nothing: pid 11 is another process now", w.killed)
	}
	if w.resyncs != 1 {
		t.Errorf("restarts = %d, want 1", w.resyncs)
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

// an awake agent whose process exited on its own (/exit): Chat's message has no terminal to go into, so the wake
// restarts it on its session and delivers the message once it reports in
func TestWakeRestartsAnAgentWhoseProcessExited(t *testing.T) {
	w := newSleepWorld(t, claudeMeta())
	w.install(&agentRosterFacts{Tabs: []agentTabFacts{idleClaude(writeTranscript(t, "abc"))}})
	var restarted atomic.Bool
	w.onResync = func() { restarted.Store(true) }
	w.exited = func() (bool, int) { return !restarted.Load(), -1 }
	w.status = func(int) baseds.AgentStatusData { return readyStatus() }

	err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "hi again"})
	if err != nil {
		t.Fatal(err)
	}
	if w.resyncs != 1 {
		t.Errorf("restarts = %d, want 1", w.resyncs)
	}
	if got := w.deliveries(); len(got) != 1 || got[0].text != "hi again" {
		t.Fatalf("delivered %+v, want the message once the agent is back", got)
	}
}

// a sleeping tab whose conversation another tab runs: waking it would run a second process on one transcript
func TestWakeRefusesAConversationAnotherTabRuns(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	other := agentFacts(agentsTabB, "lead", agentsBlockB, "claude", baseds.AgentState_Idle)
	other.Status.TranscriptPath = filepath.Join("elsewhere", "abc.jsonl")
	w.install(&agentRosterFacts{Tabs: []agentTabFacts{sleepingClaude(time.Now()), other}})
	w.status = func(int) baseds.AgentStatusData { return readyStatus() }

	err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA})
	if err == nil || !strings.Contains(err.Error(), "already open") || !strings.Contains(err.Error(), agentsTabB) {
		t.Fatalf("err = %v, want it refused, naming the tab that runs the conversation", err)
	}
	_, err = (&WshServer{}).AgentsSendCommand(context.Background(), wshrpc.CommandAgentsSendData{Tab: agentsTabA, Text: "hi", FromORef: blockORef(agentsBlockB)})
	if err == nil || !strings.Contains(err.Error(), "already open") {
		t.Fatalf("send err = %v, want it refused", err)
	}
	if w.resyncs != 0 {
		t.Fatal("the sleeping tab was started beside the one running its conversation")
	}
	// Start fresh opens a new conversation, which no other tab runs
	if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Fresh: true}); err != nil {
		t.Fatal(err)
	}
	if w.resyncs != 1 {
		t.Errorf("restarts = %d, want Start fresh to wake it", w.resyncs)
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

// a resume that takes longer than a settle write may: the marks still go, or the row reads asleep over a running agent
// and every later Wake or message from the cockpit is refused as "not asleep"
func TestWakeSlowerThanTheSettleTimeoutStillClearsTheMarks(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	installSleeping(w)
	swap(t, &wakeSettleTimeout, 20*time.Millisecond)
	start := time.Now()
	w.status = func(int) baseds.AgentStatusData {
		if time.Since(start) < 80*time.Millisecond {
			return staleStatus()
		}
		return readyStatus()
	}

	if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "carry on"}); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{waveobj.MetaKey_AgentSleeping, waveobj.MetaKey_AgentSleepFreed} {
		if v := w.metaValue(key); v != nil {
			t.Errorf("%s = %v, want it deleted: the agent came back", key, v)
		}
	}
	if len(w.deliveries()) != 1 {
		t.Errorf("delivered %+v, want the message once", w.deliveries())
	}
}

// the same for a resume that exits late: the card shows why
func TestWakeThatExitsAfterTheSettleTimeoutKeepsTheReason(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	installSleeping(w)
	swap(t, &wakeSettleTimeout, 20*time.Millisecond)
	start := time.Now()
	w.exited = func() (bool, int) { return time.Since(start) > 80*time.Millisecond, 1 }
	w.status = func(int) baseds.AgentStatusData { return staleStatus() }

	if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA}); err == nil {
		t.Fatal("a wake whose agent exited reported success")
	}
	if reason, _ := w.metaValue(waveobj.MetaKey_AgentWakeFailed).(string); !strings.Contains(reason, "exited (code 1)") {
		t.Errorf("agent:wakefailed = %q, want the reason the card shows", reason)
	}
}

// an agent whose process runs while its block still says asleep (marks a wake could not clear): Wake, or a message the
// cockpit sends it as a sleeping agent, clears them and delivers the message, without restarting the process
func TestWakeOfARunningAgentMarkedAsleepClearsTheMarks(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	w.install(&agentRosterFacts{Tabs: []agentTabFacts{idleClaude(writeTranscript(t, "abc"))}})

	if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "carry on"}); err != nil {
		t.Fatal(err)
	}
	if w.resyncs != 0 {
		t.Error("a running agent was restarted")
	}
	for _, key := range []string{waveobj.MetaKey_AgentSleeping, waveobj.MetaKey_AgentSleepFreed} {
		if v := w.metaValue(key); v != nil {
			t.Errorf("%s = %v, want it deleted", key, v)
		}
	}
	if got := w.deliveries(); len(got) != 1 || got[0].text != "carry on" {
		t.Errorf("delivered %+v, want the message once", got)
	}
}

// while a wake is in flight its process already runs and its marks are still set: a message then waits for that wake
// rather than reaching an agent that has not reported in
func TestAMessageDuringAWakeWaitsForIt(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	w.install(&agentRosterFacts{Tabs: []agentTabFacts{idleClaude(writeTranscript(t, "abc"))}})
	call := &wakeCall{done: make(chan struct{})}
	wakeMu.Lock()
	wakeCalls[agentsBlockA] = call
	wakeMu.Unlock()
	t.Cleanup(func() {
		wakeMu.Lock()
		delete(wakeCalls, agentsBlockA)
		wakeMu.Unlock()
	})

	errs := make(chan error, 1)
	go func() {
		errs <- (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "carry on"})
	}()
	time.Sleep(30 * time.Millisecond)
	if len(w.deliveries()) != 0 {
		t.Fatal("the message reached an agent whose wake had not finished")
	}
	close(call.done)
	if err := <-errs; err != nil {
		t.Fatal(err)
	}
	if len(w.deliveries()) != 1 || w.resyncs != 0 {
		t.Errorf("delivered %+v, restarts %d, want the message once the wake ended and no restart", w.deliveries(), w.resyncs)
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

// a send to a sleeping agent locks it from answering by message only once the wake has delivered, so a wake that failed
// leaves no lock, and its result does not call the message mid-turn
func TestAgentsSleepingSendLocksOnlyOnceWoken(t *testing.T) {
	send := func(w *sleepWorld) (*wshrpc.CommandAgentsSendRtnData, error) {
		sender := agentFacts(agentsTabB, "lead", agentsBlockB, "claude", baseds.AgentState_Working)
		w.install(&agentRosterFacts{Tabs: []agentTabFacts{sleepingClaude(time.Now()), sender}})
		return (&WshServer{}).AgentsSendCommand(context.Background(), wshrpc.CommandAgentsSendData{Tab: agentsTabA, Text: "hi", FromORef: blockORef(agentsBlockB)})
	}
	t.Run("woken", func(t *testing.T) {
		w := newSleepWorld(t, sleepingMeta(time.Now()))
		w.status = func(int) baseds.AgentStatusData { return readyStatus() }
		rtn, err := send(w)
		if err != nil {
			t.Fatal(err)
		}
		if rtn.MidTurn {
			t.Errorf("result = %+v, want a message that woke its agent not to be mid-turn", rtn)
		}
		if !agentmsg.SendBackLocked(agentsBlockA, agentsBlockB) {
			t.Error("the woken agent may message its sender back this turn")
		}
	})
	t.Run("did not wake", func(t *testing.T) {
		w := newSleepWorld(t, sleepingMeta(time.Now()))
		w.exited = func() (bool, int) { return true, 1 }
		if _, err := send(w); err == nil {
			t.Fatal("a send to an agent that did not wake reported success")
		}
		if agentmsg.SendBackLocked(agentsBlockA, agentsBlockB) {
			t.Error("a message that was never delivered locked the agent from messaging its sender")
		}
	})
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

// Sleeping an agent that waits on the person (a question open, a permission prompt up): it sleeps with its ask kept, and
// its wake carries what the person answered meanwhile.

// askingClaude is an awake claude agent whose AskUserQuestion is open: its row reads asking whatever its status says (the
// arc mod's card skips agent-hook's asking report, and Claude's idle_prompt reports idle a minute into the dialog).
func askingClaude(transcriptPath string) agentTabFacts {
	tf := idleClaude(transcriptPath)
	tf.OpenAsk = true
	return tf
}

// waitingClaude is an awake claude agent at a permission prompt: its status reads waiting.
func waitingClaude(transcriptPath string) agentTabFacts {
	tf := agentFacts(agentsTabA, "design", agentsBlockA, "claude", baseds.AgentState_Waiting)
	tf.Status.TranscriptPath = transcriptPath
	return tf
}

// keptAskWorld swaps in an empty ask registry holding one pending ask (askId) on agentsBlockA, and returns the block's
// oref.
func keptAskWorld(t *testing.T, askId string) string {
	t.Helper()
	swap(t, &agentask.GlobalRegistry, agentask.MakeRegistry())
	oref := blockORef(agentsBlockA)
	agentask.GlobalRegistry.Set(oref, agentask.PendingAsk{AskId: askId, BlockId: agentsBlockA, Questions: askData(oref, false).Questions, Ts: 1})
	return oref
}

func TestSleepRefusalLetsAnAgentWaitingOnThePersonThrough(t *testing.T) {
	cases := map[string]agentTabFacts{
		"a question open":         askingClaude(""),
		"an asking status":        agentFacts(agentsTabA, "design", agentsBlockA, "claude", baseds.AgentState_Asking),
		"waiting on a permission": waitingClaude(""),
	}
	for name, tf := range cases {
		row := rowOf(t, tf)
		if err := sleepRefusal(row); err != nil {
			t.Errorf("%s: sleepRefusal = %v, want the agent let through", name, err)
		}
		if !awaitsPerson(row) {
			t.Errorf("%s: awaitsPerson = false, want true", name)
		}
	}
	for name, tf := range map[string]agentTabFacts{
		"idle":    idleClaude(""),
		"working": agentFacts(agentsTabA, "design", agentsBlockA, "claude", baseds.AgentState_Working),
	} {
		if awaitsPerson(rowOf(t, tf)) {
			t.Errorf("%s: awaitsPerson = true, want false", name)
		}
	}
}

func TestSleepRefusalStillRefusesWhatItDid(t *testing.T) {
	owned := []*waveobj.Run{{OID: "run-1", Phases: []waveobj.RunPhase{{WorkerOrefs: []string{"tab:" + agentsTabA}}}}}
	runRow := func(tf agentTabFacts) *agentRow {
		rows := buildAgentRoster(&agentRosterFacts{Tabs: []agentTabFacts{tf}, Runs: owned})
		if len(rows) != 1 {
			t.Fatalf("roster = %+v, want one row", rows)
		}
		return &rows[0]
	}
	cases := []struct {
		name string
		row  *agentRow
		want string
	}{
		{"a working agent", rowOf(t, agentFacts(agentsTabA, "design", agentsBlockA, "claude", baseds.AgentState_Working)), "not idle"},
		{"an agent that is asleep", rowOf(t, sleepingClaude(time.Now())), "already asleep"},
		{"a run's worker", runRow(idleClaude("")), "run-1"},
		{"a run's worker that is asking", runRow(askingClaude("")), "run-1"},
		{"a harness that cannot resume", &agentRow{AgentInfo: wshrpc.AgentInfo{Name: "design", Harness: "codex", State: wshrpc.AgentsState_Idle}}, "cannot resume"},
	}
	for _, c := range cases {
		if err := sleepRefusal(c.row); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: sleepRefusal = %v, want a refusal that says %q", c.name, err, c.want)
		}
	}
}

// the person's Sleep, and Clean Slate's, put an agent that waits on the person to sleep; compaction first is skipped for
// it: /compact typed into an open dialog would answer or dismiss it, and the loop that finishes a compaction's sleep skips
// asking rows, so that sleep would never come
func TestSleepAskingAgentGoesStraightToSleepWithoutCompacting(t *testing.T) {
	setup := func(t *testing.T, tf agentTabFacts) (*sleepWorld, *int) {
		t.Helper()
		w := newSleepWorld(t, claudeMeta())
		swap(t, &compacts, map[string]pendingCompact{})
		sent := new(int)
		swap(t, &sendCompact, func(string) bool { *sent++; return true })
		swap(t, &currentSleepSettings, func() agentsleep.Settings {
			return agentsleep.Settings{Enabled: true, After: 30 * time.Minute, Compact: true, CompactAt: 100_000}
		})
		tf.HasStream = true
		w.install(&agentRosterFacts{Tabs: []agentTabFacts{tf}})
		return w, sent
	}
	transcript := func(t *testing.T) string {
		return writeTranscript(t, "abc", usageLine(time.Now().Add(-2*time.Minute), 150_000))
	}
	t.Run("an idle agent in the same setup compacts first", func(t *testing.T) {
		w, sent := setup(t, idleClaude(transcript(t)))
		rtn, err := (&WshServer{}).AgentsSleepCommand(context.Background(), wshrpc.CommandAgentsSleepData{Tab: agentsTabA})
		if err != nil || rtn == nil || !rtn.Compacting || *sent != 1 {
			t.Fatalf("rtn = %+v, err = %v, compactions sent = %d, want Compacting after one: the setup must pay for a compaction", rtn, err, *sent)
		}
		if got := w.eventLog(); len(got) != 0 {
			t.Errorf("events = %v, want nothing slept yet", got)
		}
	})
	for name, tf := range map[string]func(string) agentTabFacts{"a question open": askingClaude, "waiting on a permission": waitingClaude} {
		t.Run(name, func(t *testing.T) {
			w, sent := setup(t, tf(transcript(t)))
			rtn, err := (&WshServer{}).AgentsSleepCommand(context.Background(), wshrpc.CommandAgentsSleepData{Tab: agentsTabA})
			if err != nil {
				t.Fatal(err)
			}
			if rtn.Compacting || rtn.FreedBytes != 21000 || *sent != 0 {
				t.Fatalf("rtn = %+v, compactions sent = %d, want it slept at once with no compaction", rtn, *sent)
			}
			if got := w.eventLog(); !slices.Equal(got, []string{"meta", "destroy"}) {
				t.Errorf("events = %v, want the meta write, then the destroy", got)
			}
		})
	}
}

// the ask is marked suspended before the process tree goes: with the arc mod a Claude question is a `wsh ask --wait` inside
// the tree, and its end would otherwise clear the ask before the person could answer it. The asking mark rides the same
// meta write as agent:sleeping.
func TestSleepAgentOfAnAskingAgentSuspendsItsAskBeforeTheDestroy(t *testing.T) {
	w := newSleepWorld(t, claudeMeta())
	oref := keptAskWorld(t, "ask-sleep-kept")
	var suspendedAtDestroy bool
	realDestroy := destroyBlock
	swap(t, &destroyBlock, func(id string) {
		suspendedAtDestroy = agentask.GlobalRegistry.SuspendedAsk(oref, "ask-sleep-kept")
		realDestroy(id)
	})
	var writes []waveobj.MetaMapType
	realUpdate := updateBlockMeta
	swap(t, &updateBlockMeta, func(ctx context.Context, id string, m waveobj.MetaMapType) error {
		writes = append(writes, m)
		return realUpdate(ctx, id, m)
	})

	rtn, err := sleepAgent(context.Background(), rowOf(t, askingClaude(writeTranscript(t, "abc"))), false)
	if err != nil {
		t.Fatal(err)
	}
	if rtn.FreedBytes != 21000 {
		t.Errorf("result = %+v, want 21000 bytes freed", rtn)
	}
	if got := w.eventLog(); !slices.Equal(got, []string{"meta", "destroy"}) {
		t.Fatalf("events = %v, want the meta write, then the destroy", got)
	}
	if !suspendedAtDestroy {
		t.Error("the controller was destroyed before the ask was suspended: its --wait caller's end would clear it")
	}
	if len(writes) != 1 {
		t.Fatalf("meta writes = %v, want one", writes)
	}
	if _, ok := writes[0][waveobj.MetaKey_AgentSleeping]; !ok || writes[0][waveobj.MetaKey_AgentSleepAsking] != true {
		t.Errorf("meta write = %v, want agent:sleeping and agent:sleepasking: true in the same write", writes[0])
	}
	if p, ok := agentask.GlobalRegistry.Get(oref); !ok || p.AskId != "ask-sleep-kept" || !p.Suspended {
		t.Errorf("pending ask = %+v (%v), want the question kept, suspended", p, ok)
	}
}

// a permission prompt is no ask in the registry: the sleep still marks the agent, and a registry with nothing to suspend
// is no failure
func TestSleepAgentOfAPermissionWaitingAgentMarksItAsAsking(t *testing.T) {
	w := newSleepWorld(t, claudeMeta())
	swap(t, &agentask.GlobalRegistry, agentask.MakeRegistry())
	if _, err := sleepAgent(context.Background(), rowOf(t, waitingClaude(writeTranscript(t, "abc"))), false); err != nil {
		t.Fatal(err)
	}
	if w.metaValue(waveobj.MetaKey_AgentSleepAsking) != true || w.metaValue(waveobj.MetaKey_AgentSleeping) == nil {
		t.Errorf("agent:sleepasking = %v, agent:sleeping = %v, want both set", w.metaValue(waveobj.MetaKey_AgentSleepAsking), w.metaValue(waveobj.MetaKey_AgentSleeping))
	}
	if got := w.eventLog(); !slices.Equal(got, []string{"meta", "destroy"}) {
		t.Errorf("events = %v, want the meta write, then the destroy", got)
	}
}

// a sleep that fails before the kill clears the mark: the process lives on, so its --wait caller must clear the ask as
// before
func TestSleepAgentWhoseMetaWriteFailsLeavesTheAskUnsuspended(t *testing.T) {
	w := newSleepWorld(t, claudeMeta())
	oref := keptAskWorld(t, "ask-sleep-failed")
	swap(t, &updateBlockMeta, func(context.Context, string, waveobj.MetaMapType) error { return errors.New("database is locked") })

	_, err := sleepAgent(context.Background(), rowOf(t, askingClaude(writeTranscript(t, "abc"))), false)
	if err == nil || !strings.Contains(err.Error(), "database is locked") {
		t.Fatalf("err = %v, want the write's error", err)
	}
	if got := w.eventLog(); len(got) != 0 {
		t.Errorf("events = %v, want nothing destroyed", got)
	}
	if agentask.GlobalRegistry.SuspendedAsk(oref, "ask-sleep-failed") {
		t.Error("the ask stayed suspended after the sleep failed")
	}
	if _, ok := agentask.GlobalRegistry.Get(oref); !ok {
		t.Error("the ask was lost with the failed sleep")
	}
}

// an agent slept idle has no ask to keep: nothing is suspended, and a stale asking mark from an earlier sleep never rides
// into this one
func TestSleepAgentOfAnIdleAgentSuspendsNoAskAndClearsAStaleAskingMark(t *testing.T) {
	meta := claudeMeta()
	meta[waveobj.MetaKey_AgentSleepAsking] = true
	w := newSleepWorld(t, meta)
	oref := keptAskWorld(t, "ask-idle-sleep")

	if _, err := sleepAgent(context.Background(), rowOf(t, idleClaude(writeTranscript(t, "abc"))), false); err != nil {
		t.Fatal(err)
	}
	if agentask.GlobalRegistry.SuspendedAsk(oref, "ask-idle-sleep") {
		t.Error("an idle agent's sleep suspended an ask")
	}
	if v := w.metaValue(waveobj.MetaKey_AgentSleepAsking); v != nil {
		t.Errorf("agent:sleepasking = %v, want it deleted: the agent slept idle", v)
	}
	if w.metaValue(waveobj.MetaKey_AgentSleeping) == nil {
		t.Error("agent:sleeping was not written")
	}
}

const (
	wantSleepNudgeHead = "You were put to sleep while waiting on the person; carry on from where you stopped."
	wantSleepNudgeTail = "If you were waiting on an answer or a permission that is not above, ask again."
	wantHeldAnswerLine = "While you were asleep, the person answered your question: A or B? → B"
)

// markedSleepingMeta is a sleeping agent's meta as a sleep that found it waiting on the person writes it.
func markedSleepingMeta() waveobj.MetaMapType {
	meta := sleepingMeta(time.Now())
	meta[waveobj.MetaKey_AgentSleepAsking] = true
	return meta
}

// holdAnAnswer gives blockORef's agent an answer held for its wake: the person picked B for its question while it slept.
// The registry it uses is the one in place.
func holdAnAnswer(t *testing.T, oref string) {
	t.Helper()
	old := agentask.HoldAnswer
	agentask.HoldAnswer = func(string) bool { return true }
	t.Cleanup(func() { agentask.HoldAnswer = old })
	agentask.GlobalRegistry.Set(oref, agentask.PendingAsk{AskId: "ask-held", BlockId: agentsBlockA, Questions: askData(oref, false).Questions, Ts: 1})
	if delivered, err := agentask.DeliverAnswer(oref, "", []baseds.AgentAnswerItem{{SelectedIndexes: []int{1}}}); err != nil || !delivered {
		t.Fatalf("DeliverAnswer = (%v, %v), want the answer held", delivered, err)
	}
}

// the wake's one delivery: the nudge with the held answers, a blank line, then the person's message. Two deliveries back
// to back race the TUI's queued input.
func TestWakeOfAnAskingSleeperDeliversTheNudgeAndTheMessageAsOne(t *testing.T) {
	w := newSleepWorld(t, markedSleepingMeta())
	installSleeping(w)
	w.status = func(int) baseds.AgentStatusData { return readyStatus() }
	swap(t, &agentask.GlobalRegistry, agentask.MakeRegistry())
	oref := blockORef(agentsBlockA)
	holdAnAnswer(t, oref)

	if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "carry on"}); err != nil {
		t.Fatal(err)
	}
	want := wantSleepNudgeHead + "\n" + wantHeldAnswerLine + "\n" + wantSleepNudgeTail + "\n\ncarry on"
	if got := w.deliveries(); len(got) != 1 || got[0].blockId != agentsBlockA || got[0].text != want {
		t.Fatalf("delivered %+v, want one message to the agent's block: %q", got, want)
	}
	if got := w.eventLog(); got[len(got)-2] != "meta" || got[len(got)-1] != "deliver" {
		t.Errorf("events = %v, want the sleep marks cleared before the delivery", got)
	}
	for _, key := range []string{waveobj.MetaKey_AgentSleeping, waveobj.MetaKey_AgentSleepFreed, waveobj.MetaKey_AgentSleepAsking} {
		if v := w.metaValue(key); v != nil {
			t.Errorf("%s = %v, want it deleted with the other sleep marks", key, v)
		}
	}
	if left := agentask.TakeHeldAnswers(oref); len(left) != 0 {
		t.Errorf("held answers %+v stayed after the wake carried them", left)
	}
}

// a Wake with no message (the Wake button, Clean Slate's undo) still tells the agent it slept: the nudge goes alone
func TestWakeOfAnAskingSleeperWithNoMessageDeliversTheNudgeAlone(t *testing.T) {
	w := newSleepWorld(t, markedSleepingMeta())
	installSleeping(w)
	w.status = func(int) baseds.AgentStatusData { return readyStatus() }
	swap(t, &agentask.GlobalRegistry, agentask.MakeRegistry())

	if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA}); err != nil {
		t.Fatal(err)
	}
	want := wantSleepNudgeHead + "\n" + wantSleepNudgeTail
	if got := w.deliveries(); len(got) != 1 || got[0].text != want {
		t.Fatalf("delivered %+v, want the nudge alone: %q", got, want)
	}
}

// Start fresh opens a new conversation: there is nothing to carry on from, so no nudge, and what the person answered
// meanwhile is dropped with the conversation it answered
func TestWakeFreshOfAnAskingSleeperDeliversNoNudgeAndDropsTheHeldAnswers(t *testing.T) {
	w := newSleepWorld(t, markedSleepingMeta())
	installSleeping(w)
	w.status = func(int) baseds.AgentStatusData { return readyStatus() }
	swap(t, &agentask.GlobalRegistry, agentask.MakeRegistry())
	oref := blockORef(agentsBlockA)
	holdAnAnswer(t, oref)

	if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Fresh: true, Message: "start over"}); err != nil {
		t.Fatal(err)
	}
	if got := w.deliveries(); len(got) != 1 || got[0].text != "start over" {
		t.Fatalf("delivered %+v, want the message alone", got)
	}
	if left := agentask.TakeHeldAnswers(oref); len(left) != 0 {
		t.Errorf("held answers %+v stayed after Start fresh", left)
	}
	if v := w.metaValue(waveobj.MetaKey_AgentSleepAsking); v != nil {
		t.Errorf("agent:sleepasking = %v, want it deleted", v)
	}
	// and with no message, nothing at all is sent
	w = newSleepWorld(t, markedSleepingMeta())
	installSleeping(w)
	w.status = func(int) baseds.AgentStatusData { return readyStatus() }
	if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Fresh: true}); err != nil {
		t.Fatal(err)
	}
	if got := w.deliveries(); len(got) != 0 {
		t.Errorf("delivered %+v, want nothing for a Start fresh with no message", got)
	}
}

// an agent slept idle wakes as it always did: the message alone, with no nudge. Answers held for it (none are, but a
// registry may hold some from another sleep) are not taken by a wake that sends no nudge.
func TestWakeWithoutTheAskingMarkDeliversOnlyTheMessage(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	installSleeping(w)
	w.status = func(int) baseds.AgentStatusData { return readyStatus() }
	swap(t, &agentask.GlobalRegistry, agentask.MakeRegistry())
	oref := blockORef(agentsBlockA)
	holdAnAnswer(t, oref)

	if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "carry on"}); err != nil {
		t.Fatal(err)
	}
	if got := w.deliveries(); len(got) != 1 || got[0].text != "carry on" {
		t.Fatalf("delivered %+v, want the message alone", got)
	}
	if left := agentask.TakeHeldAnswers(oref); len(left) != 1 {
		t.Errorf("held answers = %+v, want the one still held: no nudge carried it", left)
	}
}

// a wake that never sees the agent report in delivers no nudge, so the answers it would have carried stay held for the
// next wake rather than vanishing
func TestWakeOfAnAskingSleeperThatDoesNotReportInKeepsItsHeldAnswers(t *testing.T) {
	w := newSleepWorld(t, markedSleepingMeta())
	installSleeping(w)
	swap(t, &wakeReadyTimeout, 40*time.Millisecond)
	swap(t, &wakePoll, 5*time.Millisecond)
	w.status = func(int) baseds.AgentStatusData { return staleStatus() }
	swap(t, &agentask.GlobalRegistry, agentask.MakeRegistry())
	oref := blockORef(agentsBlockA)
	holdAnAnswer(t, oref)

	if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "carry on"}); err == nil {
		t.Fatal("a wake whose agent never reported in reported success")
	}
	if got := w.deliveries(); len(got) != 0 {
		t.Errorf("delivered %+v, want nothing to an agent that did not report in", got)
	}
	if left := agentask.TakeHeldAnswers(oref); len(left) != 1 {
		t.Errorf("held answers = %+v, want the one still held", left)
	}
}

// the kept ask does not outlive the wake: the resumed agent asks again, and an answer to the old one would type into a
// picker that is not there
func TestWakeRetiresKeptAsk(t *testing.T) {
	t.Run("a suspended ask nobody answered", func(t *testing.T) {
		w := newSleepWorld(t, markedSleepingMeta())
		installSleeping(w)
		w.status = func(int) baseds.AgentStatusData { return readyStatus() }
		askId := "ask-wake-retired-" + t.Name()
		oref := keptAskWorld(t, askId)
		waiter := agentask.GlobalRegistry.RegisterWaiter(askId)
		if !agentask.GlobalRegistry.Suspend(oref) {
			t.Fatal("Suspend found no pending ask")
		}
		pendingAtRestart := true
		w.onResync = func() { _, pendingAtRestart = agentask.GlobalRegistry.Get(oref) }

		if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA}); err != nil {
			t.Fatal(err)
		}
		if pendingAtRestart {
			t.Error("the kept ask was still pending when the process restarted")
		}
		if _, ok := agentask.GlobalRegistry.Get(oref); ok {
			t.Error("the kept ask outlived the wake")
		}
		events := wps.Broker.ReadEventHistory(wps.Event_AgentAsk, oref, 1)
		if len(events) != 1 {
			t.Fatalf("ask events = %d, want the Cleared one", len(events))
		}
		if got, ok := events[0].Data.(baseds.AgentAskData); !ok || !got.Cleared || got.AskId != askId || got.ORef != oref {
			t.Errorf("last ask event = %#v, want Cleared for %s", events[0].Data, askId)
		}
		select {
		case res := <-waiter:
			if !res.Cancelled {
				t.Errorf("waiter resolved %+v, want cancelled", res)
			}
		default:
			t.Error("the ask's waiter was never resolved")
		}
	})
	t.Run("an ask that was never suspended stays", func(t *testing.T) {
		w := newSleepWorld(t, markedSleepingMeta())
		installSleeping(w)
		w.status = func(int) baseds.AgentStatusData { return readyStatus() }
		oref := keptAskWorld(t, "ask-wake-not-suspended-"+t.Name())

		if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA}); err != nil {
			t.Fatal(err)
		}
		if _, ok := agentask.GlobalRegistry.Get(oref); !ok {
			t.Error("an ask no sleep had suspended was retired by a wake")
		}
	})
	t.Run("start fresh retires it too", func(t *testing.T) {
		w := newSleepWorld(t, markedSleepingMeta())
		installSleeping(w)
		w.status = func(int) baseds.AgentStatusData { return readyStatus() }
		oref := keptAskWorld(t, "ask-wake-fresh-"+t.Name())
		agentask.GlobalRegistry.Suspend(oref)

		if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Fresh: true}); err != nil {
			t.Fatal(err)
		}
		if _, ok := agentask.GlobalRegistry.Get(oref); ok {
			t.Error("Start fresh left the old conversation's question pending")
		}
	})
}

// a marked block whose process runs (a forced restart that was no wake left the marks) is cleared by the wake without a
// restart; the process came back with no nudge, so the wake delivers it with the message, and takes the answers held while
// the block really slept
func TestWakeMarkedAwakeOfAnAskingSleeperDeliversTheNudgeWithTheMessage(t *testing.T) {
	w := newSleepWorld(t, markedSleepingMeta())
	w.install(&agentRosterFacts{Tabs: []agentTabFacts{idleClaude(writeTranscript(t, "abc"))}})
	swap(t, &agentask.GlobalRegistry, agentask.MakeRegistry())
	oref := blockORef(agentsBlockA)
	holdAnAnswer(t, oref)

	if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "carry on"}); err != nil {
		t.Fatal(err)
	}
	if w.resyncs != 0 {
		t.Error("a running agent was restarted")
	}
	for _, key := range []string{waveobj.MetaKey_AgentSleeping, waveobj.MetaKey_AgentSleepFreed, waveobj.MetaKey_AgentSleepAsking} {
		if v := w.metaValue(key); v != nil {
			t.Errorf("%s = %v, want it deleted", key, v)
		}
	}
	want := wantSleepNudgeHead + "\n" + wantHeldAnswerLine + "\n" + wantSleepNudgeTail + "\n\ncarry on"
	if got := w.deliveries(); len(got) != 1 || got[0].text != want {
		t.Fatalf("delivered %+v, want the nudge and the message as one: %q", got, want)
	}
	if left := agentask.TakeHeldAnswers(oref); len(left) != 0 {
		t.Errorf("held answers %+v stayed after the wake took them", left)
	}
}

// while a marked wake is in flight, a second wake that joins it delivers only its own message: the first one's delivery
// carries the nudge, and a second nudge would tell the agent twice
func TestWakeMarkedAwakeJoiningAnAskingWakeAddsNoSecondNudge(t *testing.T) {
	w := newSleepWorld(t, markedSleepingMeta())
	w.install(&agentRosterFacts{Tabs: []agentTabFacts{idleClaude(writeTranscript(t, "abc"))}})
	swap(t, &agentask.GlobalRegistry, agentask.MakeRegistry())
	oref := blockORef(agentsBlockA)
	holdAnAnswer(t, oref)
	call := &wakeCall{done: make(chan struct{})}
	wakeMu.Lock()
	wakeCalls[agentsBlockA] = call
	wakeMu.Unlock()
	t.Cleanup(func() {
		wakeMu.Lock()
		delete(wakeCalls, agentsBlockA)
		wakeMu.Unlock()
	})

	errs := make(chan error, 1)
	go func() {
		errs <- (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "carry on"})
	}()
	time.Sleep(30 * time.Millisecond)
	if len(w.deliveries()) != 0 {
		t.Fatal("the message reached an agent whose wake had not finished")
	}
	close(call.done)
	if err := <-errs; err != nil {
		t.Fatal(err)
	}
	if got := w.deliveries(); len(got) != 1 || got[0].text != "carry on" {
		t.Errorf("delivered %+v, want the joiner's message alone", got)
	}
	if left := agentask.TakeHeldAnswers(oref); len(left) != 1 {
		t.Errorf("held answers = %+v, want the one still held for the wake in flight to carry", left)
	}
	if w.metaValue(waveobj.MetaKey_AgentSleepAsking) == nil {
		t.Error("the joiner cleared the asking mark of a wake that was still in flight")
	}
}

// clearedAskEvent reports whether the last ask event of oref is the Cleared one of askId.
func clearedAskEvent(oref, askId string) bool {
	events := wps.Broker.ReadEventHistory(wps.Event_AgentAsk, oref, 1)
	if len(events) != 1 {
		return false
	}
	got, ok := events[0].Data.(baseds.AgentAskData)
	return ok && got.Cleared && got.AskId == askId
}

// the marks a wake clears over a running process leave the kept ask behind unless the wake retires it too: with the marks
// gone and the process running, nothing holds an answer to it any more, so the answer would be typed into a picker the
// restarted process never drew
func TestWakeMarkedAwakeRetiresTheKeptAsk(t *testing.T) {
	setup := func(t *testing.T) (*sleepWorld, string, string) {
		t.Helper()
		w := newSleepWorld(t, markedSleepingMeta())
		w.install(&agentRosterFacts{Tabs: []agentTabFacts{idleClaude(writeTranscript(t, "abc"))}})
		askId := "ask-marked-awake-" + t.Name()
		return w, askId, keptAskWorld(t, askId)
	}
	t.Run("a suspended ask nobody answered", func(t *testing.T) {
		w, askId, oref := setup(t)
		waiter := agentask.GlobalRegistry.RegisterWaiter(askId)
		if !agentask.GlobalRegistry.Suspend(oref) {
			t.Fatal("Suspend found no pending ask")
		}
		pendingAtDelivery := true
		realDeliver := deliverAgentMessage
		swap(t, &deliverAgentMessage, func(blockId, text string) {
			_, pendingAtDelivery = agentask.GlobalRegistry.Get(oref)
			realDeliver(blockId, text)
		})

		if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "carry on"}); err != nil {
			t.Fatal(err)
		}
		if w.resyncs != 0 {
			t.Error("a running agent was restarted")
		}
		if v := w.metaValue(waveobj.MetaKey_AgentSleepAsking); v != nil {
			t.Errorf("agent:sleepasking = %v, want it deleted", v)
		}
		if _, ok := agentask.GlobalRegistry.Get(oref); ok {
			t.Error("the kept ask outlived the wake that cleared the marks")
		}
		if pendingAtDelivery {
			t.Error("the kept ask was still pending when the nudge was delivered")
		}
		if !clearedAskEvent(oref, askId) {
			t.Errorf("last ask event = %#v, want Cleared for %s", wps.Broker.ReadEventHistory(wps.Event_AgentAsk, oref, 1), askId)
		}
		select {
		case res := <-waiter:
			if !res.Cancelled {
				t.Errorf("waiter resolved %+v, want cancelled", res)
			}
		default:
			t.Error("the ask's waiter was never resolved")
		}
		want := wantSleepNudgeHead + "\n" + wantSleepNudgeTail + "\n\ncarry on"
		if got := w.deliveries(); len(got) != 1 || got[0].blockId != agentsBlockA || got[0].text != want {
			t.Errorf("delivered %+v, want the nudge with the message as one: %q", got, want)
		}
	})
	t.Run("an ask that was never suspended stays", func(t *testing.T) {
		w, askId, oref := setup(t)

		if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "carry on"}); err != nil {
			t.Fatal(err)
		}
		if p, ok := agentask.GlobalRegistry.Get(oref); !ok || p.AskId != askId {
			t.Errorf("pending ask = %+v (%v), want the one no sleep suspended left in place", p, ok)
		}
		if clearedAskEvent(oref, askId) {
			t.Error("an ask no sleep had suspended was published as Cleared")
		}
		if got := w.deliveries(); len(got) != 1 {
			t.Errorf("delivered %+v, want the one message", got)
		}
	})
	t.Run("joining a wake in flight retires nothing", func(t *testing.T) {
		w, askId, oref := setup(t)
		agentask.GlobalRegistry.Suspend(oref)
		call := &wakeCall{done: make(chan struct{})}
		wakeMu.Lock()
		wakeCalls[agentsBlockA] = call
		wakeMu.Unlock()
		t.Cleanup(func() {
			wakeMu.Lock()
			delete(wakeCalls, agentsBlockA)
			wakeMu.Unlock()
		})

		errs := make(chan error, 1)
		go func() {
			errs <- (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA, Message: "carry on"})
		}()
		time.Sleep(30 * time.Millisecond)
		close(call.done)
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
		if !agentask.GlobalRegistry.SuspendedAsk(oref, askId) {
			t.Error("the joiner retired the kept ask of a wake that was still in flight")
		}
		if clearedAskEvent(oref, askId) {
			t.Error("the joiner published the kept ask as Cleared")
		}
		if got := w.deliveries(); len(got) != 1 || got[0].text != "carry on" {
			t.Errorf("delivered %+v, want the joiner's message alone", got)
		}
	})
}
