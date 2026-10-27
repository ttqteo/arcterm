// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/shirou/gopsutil/v4/mem"
	"github.com/wavetermdev/waveterm/pkg/agentsleep"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
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

func TestSleepSettingsFromConfig(t *testing.T) {
	yes, no := true, false
	ten, one, zero, k250 := int64(10), int64(1), int64(0), int64(250)
	cases := []struct {
		name string
		in   wconfig.SettingsType
		want agentsleep.Settings
	}{
		{"unset is on at 30 minutes", wconfig.SettingsType{}, agentsleep.Settings{Enabled: true, After: 30 * time.Minute, Compact: true, CompactAt: 100_000}},
		{"off", wconfig.SettingsType{AgentsSleepIdle: &no}, agentsleep.Settings{Enabled: false, After: 30 * time.Minute, Compact: true, CompactAt: 100_000}},
		{"on at ten minutes", wconfig.SettingsType{AgentsSleepIdle: &yes, AgentsSleepAfterMin: &ten}, agentsleep.Settings{Enabled: true, After: 10 * time.Minute, Compact: true, CompactAt: 100_000}},
		{"one minute is raised to the floor of five", wconfig.SettingsType{AgentsSleepAfterMin: &one}, agentsleep.Settings{Enabled: true, After: 5 * time.Minute, Compact: true, CompactAt: 100_000}},
		{"zero is raised to the floor too", wconfig.SettingsType{AgentsSleepAfterMin: &zero}, agentsleep.Settings{Enabled: true, After: 5 * time.Minute, Compact: true, CompactAt: 100_000}},
		{"compaction off", wconfig.SettingsType{AgentsCompactIdle: &no}, agentsleep.Settings{Enabled: true, After: 30 * time.Minute, CompactAt: 100_000}},
		{"compaction at 250k", wconfig.SettingsType{AgentsCompactAtK: &k250}, agentsleep.Settings{Enabled: true, After: 30 * time.Minute, Compact: true, CompactAt: 250_000}},
		{"ten thousand is raised to the floor of 25k", wconfig.SettingsType{AgentsCompactAtK: &ten}, agentsleep.Settings{Enabled: true, After: 30 * time.Minute, Compact: true, CompactAt: 25_000}},
	}
	for _, tc := range cases {
		if got := sleepSettings(tc.in); got != tc.want {
			t.Errorf("%s: sleepSettings = %+v, want %+v", tc.name, got, tc.want)
		}
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

func TestSleepTickCompactsAViewedAgentAsItsCacheRunsOut(t *testing.T) {
	w, sent := compactWorld(t)
	swap(t, &viewing, viewingPush{tabs: []string{agentsTabA}, at: w.start.Add(2 * time.Hour)}) // on screen all along
	w.tickTo(54)
	if len(*sent) != 0 {
		t.Fatalf("sent %v with 6 min of cache left, want nothing yet", *sent)
	}
	w.tickTo(56)
	if !slices.Equal(*sent, []string{agentsBlockA}) || len(w.slept) != 0 {
		t.Fatalf("with 5 min of cache left sent %v, slept %v; want one compaction and no sleep", *sent, w.slept)
	}
	appendLine(t, w.facts.Tabs[0].Status.TranscriptPath, compactBoundaryLine)
	w.tickTo(70)
	if len(*sent) != 1 || len(w.slept) != 0 {
		t.Fatalf("after it landed sent %v, slept %v; want nothing more", *sent, w.slept)
	}
	if compactsWaiting() {
		t.Errorf("a landed compaction still waits: %v", compacts)
	}
}

func TestSleepTickCompactsWithSleepOff(t *testing.T) {
	w, sent := compactWorld(t)
	w.enabled = false
	w.tickTo(56)
	if !slices.Equal(*sent, []string{agentsBlockA}) || len(w.slept) != 0 {
		t.Fatalf("sleep off: sent %v, slept %v; want one compaction at 5 min of cache left and no sleep", *sent, w.slept)
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
