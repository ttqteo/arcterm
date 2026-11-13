// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/shirou/gopsutil/v4/mem"
	"github.com/wavetermdev/waveterm/pkg/agentsleep"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const mib = 1 << 20

// loopWorld scripts what one sleep-loop check reads and does: the roster, the clock, free RAM, each tree's CPU
// total, the frontend's viewing push, and which agents the loop put to sleep.
type loopWorld struct {
	t       *testing.T
	facts   *agentRosterFacts
	start   time.Time
	loop    *sleepLoop
	enabled bool
	after   time.Duration

	freeBytes  uint64
	cpuMs      func(blockId string, minute int) float64 // a tree's cumulative CPU time at a minute of the run
	freed      map[string]uint64
	sleepErr   map[string]error
	background map[string][]string // what sleepAgent says still runs, per block

	minute  int
	started bool     // a check has run
	slept   []string // block ids, in order
	notices []wshrpc.NotifyCommandData
}

func newLoopWorld(t *testing.T, tabs ...agentTabFacts) *loopWorld {
	t.Helper()
	w := &loopWorld{
		t:          t,
		facts:      &agentRosterFacts{Tabs: tabs},
		start:      time.Date(2026, 10, 9, 9, 0, 0, 0, time.UTC),
		enabled:    true,
		after:      30 * time.Minute,
		freeBytes:  8 << 30,
		cpuMs:      func(string, int) float64 { return 1000 }, // flat: the trees do no work
		freed:      map[string]uint64{},
		sleepErr:   map[string]error{},
		background: map[string][]string{},
	}
	scriptAgents(t, w.facts)
	swap(t, &viewing, viewingPush{})
	swap(t, &virtualMemory, func(context.Context) (*mem.VirtualMemoryStat, error) {
		return &mem.VirtualMemoryStat{Total: 16 << 30, Available: w.freeBytes}, nil
	})
	swap(t, &treeCPUms, func(blockId string) (float64, bool) { return w.cpuMs(blockId, w.minute), true })
	w.loop = &sleepLoop{
		idle:     agentsleep.NewIdleTracker(),
		cpu:      agentsleep.NewCPURing(),
		now:      func() time.Time { return w.start.Add(time.Duration(w.minute) * time.Minute) },
		settings: func() agentsleep.Settings { return agentsleep.Settings{Enabled: w.enabled, After: w.after} },
		notify:   func(n wshrpc.NotifyCommandData) { w.notices = append(w.notices, n) },
		sleep: func(_ context.Context, row *agentRow, force bool) (*wshrpc.CommandAgentsSleepRtnData, error) {
			if force {
				t.Errorf("the loop slept %s forced; only a person's confirmed Sleep forces", row.Name)
			}
			if err := w.sleepErr[row.blockId]; err != nil {
				return nil, err
			}
			if bg := w.background[row.blockId]; len(bg) > 0 {
				return &wshrpc.CommandAgentsSleepRtnData{Background: bg}, nil
			}
			w.slept = append(w.slept, row.blockId)
			return &wshrpc.CommandAgentsSleepRtnData{FreedBytes: w.freed[row.blockId]}, nil
		},
	}
	return w
}

// tickAt runs one check at the given minute of the run.
func (w *loopWorld) tickAt(minute int) {
	w.t.Helper()
	w.minute = minute
	w.started = true
	w.loop.tick(context.Background())
}

// tickTo runs a check every minute through minute, beginning with minute 0 on the first call.
func (w *loopWorld) tickTo(minute int) {
	w.t.Helper()
	if !w.started {
		w.tickAt(0)
	}
	for w.minute < minute {
		w.tickAt(w.minute + 1)
	}
}

func claudeTab(t *testing.T, tabId, name, blockId, state string) agentTabFacts {
	t.Helper()
	tf := agentFacts(tabId, name, blockId, "claude", state)
	tf.Status.TranscriptPath = writeTranscript(t, "session-"+name)
	return tf
}

func TestSleepTickSleepsAnAgentIdleFor30Minutes(t *testing.T) {
	w := newLoopWorld(t, claudeTab(t, agentsTabA, "design", agentsBlockA, baseds.AgentState_Idle))
	w.freed[agentsBlockA] = 300 * mib

	w.tickAt(0) // first seen idle
	for minute := 1; minute < 30; minute++ {
		w.tickAt(minute)
		if len(w.slept) != 0 {
			t.Fatalf("slept at minute %d, want no sleep before 30 minutes idle", minute)
		}
	}
	w.tickAt(30)
	if !slices.Equal(w.slept, []string{agentsBlockA}) {
		t.Fatalf("slept = %v at minute 30, want the agent put to sleep once", w.slept)
	}

	// the roster now holds it asleep: later checks leave it alone, and its idle clock is gone for its next wake
	w.facts.Tabs[0] = sleepingClaude(w.loop.now())
	w.tickTo(34)
	if len(w.slept) != 1 {
		t.Errorf("slept = %v, want a sleeping agent left alone", w.slept)
	}
	if got := w.loop.idle.Observe(agentsBlockA, true, w.loop.now()); !got.Equal(w.loop.now()) {
		t.Errorf("idle since %v after waking, want a fresh stretch from %v", got, w.loop.now())
	}
}

func TestSleepTickLeavesAViewedAgentAlone(t *testing.T) {
	w := newLoopWorld(t, claudeTab(t, agentsTabA, "design", agentsBlockA, baseds.AgentState_Idle))
	push := func() { viewing = viewingPush{tabs: []string{agentsTabA}, at: w.loop.now()} }

	for minute := 0; minute <= 40; minute++ {
		w.minute = minute
		push() // the frontend repeats its push while the window is up
		w.loop.tick(context.Background())
	}
	if len(w.slept) != 0 {
		t.Fatalf("slept = %v, want an agent on screen left awake", w.slept)
	}

	// the window closes: the push goes stale after 3 minutes and the long-idle agent sleeps
	w.tickAt(42)
	if len(w.slept) != 0 {
		t.Fatalf("slept = %v at minute 42, want the push to still count within 3 minutes", w.slept)
	}
	w.tickAt(44)
	if !slices.Equal(w.slept, []string{agentsBlockA}) {
		t.Errorf("slept = %v, want the agent to sleep once the push expired", w.slept)
	}
}

func TestSleepTickRAMTriggerSleepsOneEarly(t *testing.T) {
	// B has been idle since minute 0, A since minute 3
	a := claudeTab(t, agentsTabA, "design", agentsBlockA, baseds.AgentState_Working)
	b := claudeTab(t, agentsTabB, "api", agentsBlockB, baseds.AgentState_Idle)
	w := newLoopWorld(t, a, b)

	w.tickTo(2)
	w.facts.Tabs[0].Status.State = baseds.AgentState_Idle
	w.tickTo(8)
	if len(w.slept) != 0 {
		t.Fatalf("slept = %v with plenty of RAM free, want nothing before 30 minutes", w.slept)
	}
	w.freeBytes = 800 * mib // under 1 GiB
	w.tickAt(9)             // A has been idle 6 minutes, B 9
	if !slices.Equal(w.slept, []string{agentsBlockB}) {
		t.Fatalf("slept = %v, want only the longest-idle agent", w.slept)
	}
}

func TestSleepTickOffWhenTheSettingIsOff(t *testing.T) {
	w := newLoopWorld(t, claudeTab(t, agentsTabA, "design", agentsBlockA, baseds.AgentState_Idle))
	w.enabled = false
	w.freeBytes = 100 * mib // even the RAM trigger is the setting's to switch off

	w.tickTo(45)
	if len(w.slept) != 0 || len(w.notices) != 0 {
		t.Fatalf("slept %v and noticed %v with the setting off, want nothing", w.slept, w.notices)
	}

	// switched back on, the idle clock starts then, not from before it was off
	w.enabled = true
	w.freeBytes = 8 << 30
	w.tickAt(46)
	w.tickTo(75)
	if len(w.slept) != 0 {
		t.Fatalf("slept = %v 29 minutes after the setting came back on, want the clock to have restarted", w.slept)
	}
	w.tickAt(76)
	if !slices.Equal(w.slept, []string{agentsBlockA}) {
		t.Errorf("slept = %v, want a sleep 30 minutes after the setting came back on", w.slept)
	}
}

func TestSleepTickNotifiesOncePerTick(t *testing.T) {
	a := claudeTab(t, agentsTabA, "design", agentsBlockA, baseds.AgentState_Idle)
	b := claudeTab(t, agentsTabB, "api", agentsBlockB, baseds.AgentState_Idle)
	w := newLoopWorld(t, a, b)
	w.freed[agentsBlockA] = 200 * mib
	w.freed[agentsBlockB] = 320 * mib

	w.tickTo(29)
	if len(w.notices) != 0 {
		t.Fatalf("notices = %v before anything slept, want none", w.notices)
	}
	w.tickAt(30)
	if len(w.slept) != 2 {
		t.Fatalf("slept = %v, want both", w.slept)
	}
	want := wshrpc.NotifyCommandData{Title: "Put 2 agents to sleep", Message: "freed 520 MB", Level: "info"}
	if len(w.notices) != 1 || w.notices[0] != want {
		t.Fatalf("notices = %+v, want the one %+v", w.notices, want)
	}
}

func TestSleepTickCountsOnlyTheAgentsThatSlept(t *testing.T) {
	a := claudeTab(t, agentsTabA, "design", agentsBlockA, baseds.AgentState_Idle)
	b := claudeTab(t, agentsTabB, "api", agentsBlockB, baseds.AgentState_Idle)
	c := claudeTab(t, agentsTabC, "docs", agentsBlockC, baseds.AgentState_Idle)
	w := newLoopWorld(t, a, b, c)
	w.freed[agentsBlockC] = 330 * mib
	w.sleepErr[agentsBlockA] = errors.New("did not stop")
	w.background[agentsBlockB] = []string{"dev server"} // started after the loop looked

	w.tickTo(30)
	if !slices.Equal(w.slept, []string{agentsBlockC}) {
		t.Fatalf("slept = %v, want only the agent that did", w.slept)
	}
	want := wshrpc.NotifyCommandData{Title: "Put 1 agent to sleep", Message: "freed 330 MB", Level: "info"}
	if len(w.notices) != 1 || w.notices[0] != want {
		t.Errorf("notices = %+v, want the one %+v", w.notices, want)
	}
}

func TestSleepTickNoticeFreedInGB(t *testing.T) {
	w := newLoopWorld(t, claudeTab(t, agentsTabA, "design", agentsBlockA, baseds.AgentState_Idle))
	w.freed[agentsBlockA] = 1536 * mib
	w.tickTo(30)
	if len(w.notices) != 1 || w.notices[0].Message != "freed 1.5 GB" {
		t.Errorf("notices = %+v, want the freed RAM in GB", w.notices)
	}
}

func TestSleepTickSpares(t *testing.T) {
	cases := []struct {
		name  string
		setup func(t *testing.T, w *loopWorld)
	}{
		{"an agent working", func(t *testing.T, w *loopWorld) {
			w.facts.Tabs[0].Status.State = baseds.AgentState_Working
		}},
		{"an agent waiting on a permission", func(t *testing.T, w *loopWorld) {
			w.facts.Tabs[0].Status.State = baseds.AgentState_Waiting
		}},
		{"an agent with a question open", func(t *testing.T, w *loopWorld) {
			w.facts.Tabs[0].OpenAsk = true
			w.facts.Tabs[0].Status.State = baseds.AgentState_Asking
		}},
		{"a run's worker", func(t *testing.T, w *loopWorld) {
			run := &waveobj.Run{OID: "run-a", Phases: []waveobj.RunPhase{{WorkerOrefs: []string{"tab:" + agentsTabA}}}}
			w.facts.Runs = append(w.facts.Runs, run)
		}},
		{"an agent with no session yet", func(t *testing.T, w *loopWorld) {
			w.facts.Tabs[0].Status.TranscriptPath = ""
		}},
		{"an agent whose tree is doing work", func(t *testing.T, w *loopWorld) {
			// 60% of one core, climbing
			w.cpuMs = func(_ string, minute int) float64 { return float64(minute) * 36_000 }
		}},
		{"an agent with a background task running", func(t *testing.T, w *loopWorld) {
			w.facts.Tabs[0].Status.TranscriptPath = writeTranscript(t, "bg", backgroundTaskLine)
		}},
		{"a harness that cannot resume", func(t *testing.T, w *loopWorld) {
			w.facts.Tabs[0].Status.Agent = "codex"
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := newLoopWorld(t, claudeTab(t, agentsTabA, "design", agentsBlockA, baseds.AgentState_Idle))
			tc.setup(t, w)
			w.freeBytes = 100 * mib // the RAM trigger spares them too
			w.tickTo(60)
			if len(w.slept) != 0 {
				t.Errorf("slept = %v, want %s left awake", w.slept, tc.name)
			}
		})
	}
}

func TestSleepTickSurvivesARosterError(t *testing.T) {
	w := newLoopWorld(t, claudeTab(t, agentsTabA, "design", agentsBlockA, baseds.AgentState_Idle))
	w.tickTo(10)
	loaded := loadAgentRosterFacts
	loadAgentRosterFacts = func(context.Context) (*agentRosterFacts, error) { return nil, errors.New("store busy") }
	w.tickAt(11)
	loadAgentRosterFacts = loaded
	// the failed check forgot nothing: the idle stretch that began at minute 0 still counts
	w.tickTo(30)
	if !slices.Equal(w.slept, []string{agentsBlockA}) {
		t.Errorf("slept = %v, want the agent slept 30 minutes after it went idle", w.slept)
	}
}

// usageLine is a main-thread request at ts that carried tokens of context and wrote an hour-long cache.
func usageLine(ts time.Time, tokens int) string {
	return fmt.Sprintf(`{"type":"assistant","isSidechain":false,"timestamp":%q,"message":{"usage":{"input_tokens":1,"cache_read_input_tokens":%d,"cache_creation_input_tokens":1000,"cache_creation":{"ephemeral_1h_input_tokens":1000}}}}`,
		ts.Format(time.RFC3339Nano), tokens-1001)
}

const compactBoundaryLine = `{"type":"system","subtype":"compact_boundary","content":"Conversation compacted","isSidechain":false}`

// compactWorld is a loop world whose one agent is a Claude session with a stream and 150k of context, its last turn at
// minute 0, with compaction on; it records the compactions the loop sends.
func compactWorld(t *testing.T) (*loopWorld, *[]string) {
	t.Helper()
	tf := agentFacts(agentsTabA, "design", agentsBlockA, "claude", baseds.AgentState_Idle)
	tf.HasStream = true
	w := newLoopWorld(t, tf)
	w.facts.Tabs[0].Status.TranscriptPath = writeTranscript(t, "session-design", usageLine(w.start, 150_000))
	w.loop.settings = func() agentsleep.Settings {
		return agentsleep.Settings{Enabled: w.enabled, After: w.after, Compact: true, CompactAt: 100_000}
	}
	swap(t, &compacts, map[string]pendingCompact{})
	sent := &[]string{}
	swap(t, &sendCompact, func(blockId string) bool { *sent = append(*sent, blockId); return true })
	return w, sent
}

func appendLine(t *testing.T, path, line string) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.WriteString(line + "\n"); err != nil {
		t.Fatal(err)
	}
}

func TestSleepTickCompactsThenSleeps(t *testing.T) {
	w, sent := compactWorld(t)
	w.tickTo(30)
	if !slices.Equal(*sent, []string{agentsBlockA}) || len(w.slept) != 0 {
		t.Fatalf("at 30 min sent %v, slept %v; want a compaction and no sleep yet", *sent, w.slept)
	}
	// the compaction runs: the session reads working, then idle once the summary lands
	w.facts.Tabs[0].Status.State = baseds.AgentState_Working
	w.tickAt(31)
	if len(*sent) != 1 || len(w.slept) != 0 {
		t.Fatalf("while compacting sent %v, slept %v; want no second compaction and no sleep", *sent, w.slept)
	}
	appendLine(t, w.facts.Tabs[0].Status.TranscriptPath, compactBoundaryLine)
	w.facts.Tabs[0].Status.State = baseds.AgentState_Idle
	w.tickAt(32)
	if !slices.Equal(w.slept, []string{agentsBlockA}) {
		t.Fatalf("after the summary landed slept %v, want the agent asleep without another 30 minutes", w.slept)
	}
	if compactsWaiting() {
		t.Errorf("compactions still waiting after the sleep: %v", compacts)
	}
}

func TestSleepTickLeavesAViewedAgentsCacheToClaudeCode(t *testing.T) {
	w, sent := compactWorld(t)
	swap(t, &viewing, viewingPush{tabs: []string{agentsTabA}, at: w.start.Add(2 * time.Hour)}) // on screen all along
	w.tickTo(70)
	if len(*sent) != 0 || len(w.slept) != 0 {
		t.Fatalf("an awake agent past its cache: sent %v, slept %v; want nothing (Claude Code compacts it itself)", *sent, w.slept)
	}
}

func TestSleepTickSendsNothingWithSleepOff(t *testing.T) {
	w, sent := compactWorld(t)
	w.enabled = false
	w.tickTo(70)
	if len(*sent) != 0 || len(w.slept) != 0 {
		t.Fatalf("sleep off: sent %v, slept %v; want nothing", *sent, w.slept)
	}
}

func TestSleepTickSleepsASmallContextWithoutCompacting(t *testing.T) {
	w, sent := compactWorld(t)
	w.facts.Tabs[0].Status.TranscriptPath = writeTranscript(t, "session-small", usageLine(w.start, 60_000))
	w.tickTo(30)
	if len(*sent) != 0 || !slices.Equal(w.slept, []string{agentsBlockA}) {
		t.Fatalf("60k of context: sent %v, slept %v; want it asleep with no compaction", *sent, w.slept)
	}
}

func TestPersonSleepCompactsFirst(t *testing.T) {
	now := time.Now()
	swap(t, &compacts, map[string]pendingCompact{})
	sent := 0
	swap(t, &sendCompact, func(string) bool { sent++; return true })
	swap(t, &currentSleepSettings, func() agentsleep.Settings {
		return agentsleep.Settings{Enabled: true, After: 30 * time.Minute, Compact: true, CompactAt: 100_000}
	})
	tf := idleClaude(writeTranscript(t, "abc", usageLine(now.Add(-2*time.Minute), 150_000)))
	tf.HasStream = true
	row := rowOf(t, tf)

	rtn := sleepAfterCompaction(context.Background(), row, false, now)
	if rtn == nil || !rtn.Compacting || sent != 1 {
		t.Fatalf("got %+v after %d sends, want Compacting after one", rtn, sent)
	}
	if pc, ok := compactPending(agentsBlockA, now); !ok || pc.then != agentsleep.SleepAfterPerson {
		t.Fatalf("pending %+v (%v), want a sleep for the person once it lands", pc, ok)
	}
	// a second click waits on the same compaction
	if rtn := sleepAfterCompaction(context.Background(), row, true, now); rtn == nil || !rtn.Compacting || sent != 1 {
		t.Fatalf("second click got %+v after %d sends, want Compacting and no new send", rtn, sent)
	}
	if pc, _ := compactPending(agentsBlockA, now); !pc.force {
		t.Error("the confirmed second click did not carry its force")
	}
}

func TestPersonSleepAsksAboutBackgroundWorkBeforeCompacting(t *testing.T) {
	now := time.Now()
	swap(t, &compacts, map[string]pendingCompact{})
	sent := 0
	swap(t, &sendCompact, func(string) bool { sent++; return true })
	swap(t, &currentSleepSettings, func() agentsleep.Settings {
		return agentsleep.Settings{Enabled: true, After: 30 * time.Minute, Compact: true, CompactAt: 100_000}
	})
	tf := idleClaude(writeTranscript(t, "abc", backgroundTaskLine, usageLine(now.Add(-2*time.Minute), 150_000)))
	tf.HasStream = true
	rtn := sleepAfterCompaction(context.Background(), rowOf(t, tf), false, now)
	if rtn == nil || len(rtn.Background) == 0 || rtn.Compacting || sent != 0 {
		t.Fatalf("got %+v after %d sends, want the background work asked about and nothing sent", rtn, sent)
	}
}

func TestPersonSleepGoesStraightToSleepWithoutAPayingCompaction(t *testing.T) {
	now := time.Now()
	swap(t, &compacts, map[string]pendingCompact{})
	swap(t, &sendCompact, func(string) bool { t.Error("sent a compaction"); return true })
	swap(t, &currentSleepSettings, func() agentsleep.Settings {
		return agentsleep.Settings{Enabled: true, After: 30 * time.Minute, Compact: true, CompactAt: 100_000}
	})
	for name, line := range map[string]string{
		"small": usageLine(now.Add(-2*time.Minute), 60_000),
		"cold":  usageLine(now.Add(-61*time.Minute), 150_000),
	} {
		tf := idleClaude(writeTranscript(t, "abc", line))
		tf.HasStream = true
		if rtn := sleepAfterCompaction(context.Background(), rowOf(t, tf), false, now); rtn != nil {
			t.Errorf("%s: got %+v, want the Sleep to go ahead", name, rtn)
		}
	}
	tf := idleClaude(writeTranscript(t, "abc", usageLine(now.Add(-2*time.Minute), 150_000)))
	if rtn := sleepAfterCompaction(context.Background(), rowOf(t, tf), false, now); rtn != nil {
		t.Errorf("no stream: got %+v, want the Sleep to go ahead", rtn)
	}
}

func TestRunOwnedForSleep(t *testing.T) {
	cases := []struct {
		name      string
		taskState string
		isLead    bool
		owned     bool
	}{
		{"an agent that works no dag task", "", false, true},
		{"a worker whose task is done", orchestrate.TaskState_Done, false, false},
		{"a worker whose task is verifying", orchestrate.TaskState_Verifying, false, false},
		{"a worker whose task failed verify", orchestrate.TaskState_VerifyFailed, false, false},
		{"a worker whose task is pending", orchestrate.TaskState_Pending, false, true},
		{"a worker whose task is ready", orchestrate.TaskState_Ready, false, true},
		{"a worker whose task is running", orchestrate.TaskState_Running, false, true},
		{"a worker whose task is stalled", orchestrate.TaskState_Stalled, false, true},
		{"a worker whose task is reviewing", orchestrate.TaskState_Reviewing, false, true},
		{"a worker whose task failed review", orchestrate.TaskState_ReviewFailed, false, true},
		{"a worker whose task is blocked on a merge", orchestrate.TaskState_BlockedMerge, false, true},
		{"a worker whose task failed", orchestrate.TaskState_Failed, false, true},
		{"a lead", "", true, true},
		{"a lead, whatever state a task reads", orchestrate.TaskState_Done, true, true},
		{"a lead over a verifying task", orchestrate.TaskState_Verifying, true, true},
	}
	for _, c := range cases {
		if got := runOwnedForSleep(c.taskState, c.isLead); got != c.owned {
			t.Errorf("%s: runOwnedForSleep(%q, %v) = %v, want %v", c.name, c.taskState, c.isLead, got, c.owned)
		}
	}
}

func leadRun(leadTab string) *waveobj.Run {
	return &waveobj.Run{OID: "run-lead", ID: "run-lead", DagORef: "dag-1", CreatedTs: 1,
		Phases: []waveobj.RunPhase{{WorkerOrefs: []string{"tab:" + leadTab}}}}
}

// taskRun is the child run a dag task's worker works in.
func taskRun(taskId, workerTab string) *waveobj.Run {
	return &waveobj.Run{OID: "run-" + taskId, ID: "run-" + taskId, DagORef: "dag-1", TaskId: taskId, CreatedTs: 2,
		Phases: []waveobj.RunPhase{{WorkerOrefs: []string{"tab:" + workerTab}}}}
}

// scriptDag scripts the dag the sleep loop reads for the run's tasks and returns how many times it read it.
func scriptDag(t *testing.T, tasks ...waveobj.TaskNode) *int {
	t.Helper()
	reads := new(int)
	swap(t, &loadSleepDag, func(_ context.Context, dagId string) (*waveobj.TaskGroup, error) {
		*reads++
		if dagId != "dag-1" {
			return nil, errors.New("no such dag " + dagId)
		}
		return &waveobj.TaskGroup{OID: "dag-1", ID: "dag-1", RunID: "run-lead", Tasks: tasks}, nil
	})
	return reads
}

// workerOfTask makes the world's tab A the worker of task t-1 in the state given, under a lead in tab B.
func workerOfTask(t *testing.T, w *loopWorld, state string) {
	t.Helper()
	w.facts.Runs = []*waveobj.Run{leadRun(agentsTabB), taskRun("t-1", agentsTabA)}
	scriptDag(t, waveobj.TaskNode{ID: "t-1", State: state, RunID: "run-t-1"})
}

func TestSleepTickSleepsAWorkerWhoseTaskPassedReview(t *testing.T) {
	for _, state := range []string{orchestrate.TaskState_Done, orchestrate.TaskState_Verifying, orchestrate.TaskState_VerifyFailed} {
		t.Run(state, func(t *testing.T) {
			worker := claudeTab(t, agentsTabA, "worker", agentsBlockA, baseds.AgentState_Idle)
			lead := claudeTab(t, agentsTabB, "lead", agentsBlockB, baseds.AgentState_Idle)
			w := newLoopWorld(t, worker, lead)
			workerOfTask(t, w, state)

			w.tickTo(29)
			if len(w.slept) != 0 {
				t.Fatalf("slept = %v before 30 minutes idle, want the usual wait kept", w.slept)
			}
			w.tickAt(30)
			if !slices.Equal(w.slept, []string{agentsBlockA}) {
				t.Fatalf("slept = %v, want the finished task's worker asleep and its lead awake", w.slept)
			}
		})
	}
}

func TestSleepTickSparesTheWorkerOfAnUnfinishedTask(t *testing.T) {
	for _, state := range []string{
		orchestrate.TaskState_Pending, orchestrate.TaskState_Ready, orchestrate.TaskState_Running, orchestrate.TaskState_Stalled,
		orchestrate.TaskState_Reviewing, orchestrate.TaskState_ReviewFailed, orchestrate.TaskState_BlockedMerge, orchestrate.TaskState_Failed,
	} {
		t.Run(state, func(t *testing.T) {
			w := newLoopWorld(t, claudeTab(t, agentsTabA, "worker", agentsBlockA, baseds.AgentState_Idle))
			workerOfTask(t, w, state)
			w.freeBytes = 100 * mib // the RAM trigger spares it too
			w.tickTo(60)
			if len(w.slept) != 0 {
				t.Errorf("slept = %v, want the worker of a %s task left awake", w.slept, state)
			}
		})
	}
}

func TestSleepTickSparesTheOtherAgentsOfARun(t *testing.T) {
	cases := []struct {
		name  string
		setup func(w *loopWorld)
	}{
		{"the lead, with every task done", func(w *loopWorld) {
			w.facts.Runs = []*waveobj.Run{leadRun(agentsTabA)}
			scriptDag(w.t, waveobj.TaskNode{ID: "t-1", State: orchestrate.TaskState_Done, RunID: "run-t-1"})
		}},
		{"a task's reviewer", func(w *loopWorld) {
			workerOfTask(w.t, w, orchestrate.TaskState_Done)
			w.facts.Runs[1].Review = true
		}},
		{"a stage session", func(w *loopWorld) {
			workerOfTask(w.t, w, orchestrate.TaskState_Done)
			w.facts.Runs[1].TaskId, w.facts.Runs[1].StageRole = "", "verifier"
		}},
		{"a worker whose dag cannot be read", func(w *loopWorld) {
			workerOfTask(w.t, w, orchestrate.TaskState_Done)
			swap(w.t, &loadSleepDag, func(context.Context, string) (*waveobj.TaskGroup, error) { return nil, errors.New("store busy") })
		}},
		{"a worker whose task the dag no longer lists", func(w *loopWorld) {
			workerOfTask(w.t, w, orchestrate.TaskState_Done)
			w.facts.Runs[1].TaskId = "t-9"
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := newLoopWorld(t, claudeTab(t, agentsTabA, "agent", agentsBlockA, baseds.AgentState_Idle))
			c.setup(w)
			w.freeBytes = 100 * mib
			w.tickTo(60)
			if len(w.slept) != 0 {
				t.Errorf("slept = %v, want %s left awake", w.slept, c.name)
			}
		})
	}
}

func TestSleepTickReadsTheDagOncePerCheck(t *testing.T) {
	a := claudeTab(t, agentsTabA, "one", agentsBlockA, baseds.AgentState_Idle)
	b := claudeTab(t, agentsTabB, "lead", agentsBlockB, baseds.AgentState_Idle)
	c := claudeTab(t, agentsTabC, "two", agentsBlockC, baseds.AgentState_Idle)
	w := newLoopWorld(t, a, b, c)
	w.facts.Runs = []*waveobj.Run{leadRun(agentsTabB), taskRun("t-1", agentsTabA), taskRun("t-2", agentsTabC)}
	reads := scriptDag(t,
		waveobj.TaskNode{ID: "t-1", State: orchestrate.TaskState_Done, RunID: "run-t-1"},
		waveobj.TaskNode{ID: "t-2", State: orchestrate.TaskState_Running, RunID: "run-t-2"})

	w.tickAt(0)
	if *reads != 1 {
		t.Fatalf("dag read %d times in one check of two workers and a lead, want once", *reads)
	}
	w.tickAt(1)
	if *reads != 2 {
		t.Errorf("dag read %d times in two checks, want once each", *reads)
	}
}

// a finished worker that sleeps is the same sleep a person's idle agent gets: its block holds `--resume <session>`, so
// a Wake reopens that conversation instead of starting a fresh one
func TestSleepTickLeavesAFinishedWorkerResumable(t *testing.T) {
	sw := newSleepWorld(t, claudeMeta())
	worker := claudeTab(t, agentsTabA, "worker", agentsBlockA, baseds.AgentState_Idle)
	w := newLoopWorld(t, worker)
	workerOfTask(t, w, orchestrate.TaskState_Done)
	w.loop.sleep = sleepAgent // the real sleep, over the world sw scripts

	w.tickTo(30)
	session := strings.TrimSuffix(filepath.Base(worker.Status.TranscriptPath), ".jsonl")
	wantArgs := []string{"--resume", session, "--model", "opus"}
	if got, _ := sw.metaValue(waveobj.MetaKey_CmdArgs).([]string); !slices.Equal(got, wantArgs) {
		t.Fatalf("cmd:args = %v after the loop's sleep, want %v", sw.metaValue(waveobj.MetaKey_CmdArgs), wantArgs)
	}
	slept, _ := sw.metaValue(waveobj.MetaKey_AgentSleeping).(int64)
	if slept == 0 || !slices.Equal(sw.eventLog(), []string{"meta", "destroy"}) {
		t.Fatalf("agent:sleeping = %v, events = %v, want the worker's block marked asleep and its process ended", sw.metaValue(waveobj.MetaKey_AgentSleeping), sw.eventLog())
	}

	// the roster now reads the tab asleep, still a run's worker; a person's Wake restarts it on the same session
	asleep := worker
	asleep.ShellRunning, asleep.Cmd, asleep.Sleeping, asleep.SleepFreed = false, "claude", slept, 21000
	w.facts.Tabs[0] = asleep
	sw.status = func(int) baseds.AgentStatusData { return readyStatus() }
	if err := (&WshServer{}).AgentsWakeCommand(context.Background(), wshrpc.CommandAgentsWakeData{Tab: agentsTabA}); err != nil {
		t.Fatal(err)
	}
	if sw.resyncs != 1 {
		t.Fatalf("restarts = %d, want the wake to restart the worker once", sw.resyncs)
	}
	if got, _ := sw.argsAtResync.([]string); !slices.Equal(got, wantArgs) {
		t.Errorf("cmd:args at the restart = %v, want %v: the same conversation, not a fresh one", sw.argsAtResync, wantArgs)
	}
}
