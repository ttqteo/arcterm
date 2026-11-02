// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentsleep"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// afterRunTimerFake is one countdown the fake clock holds.
type afterRunTimerFake struct {
	d       time.Duration
	f       func()
	stopped bool
}

// runSleepWorld scripts one brainstorm agent armed to sleep after its run: the roster, the clock, the timers, its
// brainstorm.json, and what was slept and announced.
type runSleepWorld struct {
	t          *testing.T
	facts      *agentRosterFacts
	path       string
	now        time.Time
	enabled    bool
	timers     []*afterRunTimerFake
	background []string
	slept      []string
	notices    []wshrpc.NotifyCommandData
}

func newRunSleepWorld(t *testing.T) *runSleepWorld {
	t.Helper()
	w := &runSleepWorld{
		t:       t,
		facts:   &agentRosterFacts{Tabs: []agentTabFacts{agentFacts(agentsTabA, "design", agentsBlockA, "claude", baseds.AgentState_Idle)}},
		path:    filepath.Join(t.TempDir(), "brainstorm.json"),
		now:     time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC),
		enabled: true,
	}
	scriptAgents(t, w.facts)
	w.writeRun("")
	swap(t, &runSleeps, map[string]*runSleep{})
	swap(t, &runSleepNotify, func(n wshrpc.NotifyCommandData) { w.notices = append(w.notices, n) })
	swap(t, &currentSleepSettings, func() agentsleep.Settings { return agentsleep.Settings{Enabled: w.enabled} })
	swap(t, &afterRunNow, func() time.Time { return w.now })
	swap(t, &afterRunTimer, func(d time.Duration, f func()) func() bool {
		ft := &afterRunTimerFake{d: d, f: f}
		w.timers = append(w.timers, ft)
		return func() bool { ft.stopped = true; return true }
	})
	swap(t, &sleepAfterRunAgent, func(_ context.Context, row *agentRow, force bool) (*wshrpc.CommandAgentsSleepRtnData, error) {
		if force {
			t.Errorf("slept %s forced; this sleep never forces", row.Name)
		}
		if len(w.background) > 0 {
			return &wshrpc.CommandAgentsSleepRtnData{Background: w.background}, nil
		}
		w.slept = append(w.slept, row.blockId)
		return &wshrpc.CommandAgentsSleepRtnData{FreedBytes: 300 * mib}, nil
	})
	return w
}

// writeRun writes the brainstorm.json with run set to runId, null when it is "".
func (w *runSleepWorld) writeRun(runId string) {
	w.t.Helper()
	run := "null"
	if runId != "" {
		run = `"` + runId + `"`
	}
	if err := os.WriteFile(w.path, []byte(`{"v":1,"title":"t","run":`+run+`}`), 0o644); err != nil {
		w.t.Fatal(err)
	}
}

func (w *runSleepWorld) arm(runId string) {
	w.t.Helper()
	err := (&WshServer{}).AgentsSleepAfterRunCommand(context.Background(), wshrpc.CommandAgentsSleepAfterRunData{Tab: agentsTabA, RunId: runId, Path: w.path})
	if err != nil {
		w.t.Fatal(err)
	}
}

// report is one agent:status the agent sends.
func (w *runSleepWorld) report(state, hook string) {
	w.t.Helper()
	w.facts.Tabs[0].Status.State, w.facts.Tabs[0].Status.Hook = state, hook
	oref := blockORef(agentsBlockA)
	noteRunSleepStatus(context.Background(), &wps.WaveEvent{
		Event: wps.Event_AgentStatus,
		Data:  baseds.AgentStatusData{ORef: oref, State: state, Hook: hook, Agent: "claude"},
	})
}

// running is the countdowns not stopped.
func (w *runSleepWorld) running() []*afterRunTimerFake {
	var live []*afterRunTimerFake
	for _, ft := range w.timers {
		if !ft.stopped {
			live = append(live, ft)
		}
	}
	return live
}

// fireAll runs every countdown, stopped ones included: a stopped timer's callback that raced its stop still must not
// sleep anything.
func (w *runSleepWorld) fireAll() {
	for _, ft := range w.timers {
		ft.f()
	}
}

func (w *runSleepWorld) armed() bool {
	_, ok := runSleeps[agentsBlockA]
	return ok
}

func TestSleepAfterRunWaitsForTheTurnThatRecordsTheRun(t *testing.T) {
	w := newRunSleepWorld(t)
	w.facts.Tabs[0].Status.State = baseds.AgentState_Working // the approved turn is still going
	w.arm("run-42")
	if len(w.timers) != 0 {
		t.Fatalf("a countdown started at the arm, before the run was recorded")
	}

	w.report(baseds.AgentState_Idle, baseds.AgentHook_Stop) // the approved turn ends without the run
	if len(w.timers) != 0 {
		t.Fatalf("a turn that did not record the run started the countdown")
	}

	w.report(baseds.AgentState_Working, "")
	w.writeRun("run-42")
	w.report(baseds.AgentState_Idle, baseds.AgentHook_Stop)
	live := w.running()
	if len(live) != 1 || live[0].d != sleepAfterRunWait {
		t.Fatalf("countdowns = %+v, want one of %v once the run is recorded", w.timers, sleepAfterRunWait)
	}
	w.report(baseds.AgentState_Idle, baseds.AgentHook_Stop) // a second idle does not start another
	if len(w.timers) != 1 {
		t.Fatalf("countdowns = %d, want the one", len(w.timers))
	}

	w.fireAll()
	if !slices.Equal(w.slept, []string{agentsBlockA}) {
		t.Fatalf("slept = %v, want the agent", w.slept)
	}
	if len(w.notices) != 1 || w.notices[0].Title != "Put design to sleep" || w.notices[0].Message != "freed 300 MB" {
		t.Errorf("notices = %+v, want one naming the agent and the RAM freed", w.notices)
	}
	if w.armed() {
		t.Errorf("the entry stays after the sleep")
	}
}

func TestSleepAfterRunStartsAtOnceWhenTheRunIsAlreadyRecorded(t *testing.T) {
	w := newRunSleepWorld(t)
	w.writeRun("run-42")
	w.arm("run-42")
	if len(w.running()) != 1 {
		t.Fatalf("countdowns = %d, want one started at the arm", len(w.running()))
	}
	w.fireAll()
	if len(w.slept) != 1 {
		t.Errorf("slept = %v, want the agent", w.slept)
	}
}

func TestSleepAfterRunIgnoresAnotherRunsId(t *testing.T) {
	w := newRunSleepWorld(t)
	w.writeRun("run-old")
	w.arm("run-42")
	w.report(baseds.AgentState_Idle, baseds.AgentHook_Stop)
	if len(w.timers) != 0 {
		t.Errorf("a file naming another run started the countdown")
	}
}

func TestSleepAfterRunWorkingCancelsTheCountdown(t *testing.T) {
	w := newRunSleepWorld(t)
	w.arm("run-42")
	w.writeRun("run-42")
	w.report(baseds.AgentState_Idle, baseds.AgentHook_Stop)
	w.report(baseds.AgentState_Working, "") // the person typed to it
	if len(w.running()) != 0 || w.armed() {
		t.Fatalf("running = %d, armed = %v, want the countdown stopped and the entry dropped", len(w.running()), w.armed())
	}
	w.report(baseds.AgentState_Idle, baseds.AgentHook_Stop)
	w.fireAll()
	if len(w.slept) != 0 || len(w.notices) != 0 {
		t.Errorf("slept = %v, notices = %v, want the agent left to the 30-minute rule", w.slept, w.notices)
	}
}

func TestSleepAfterRunDropsAnEntryNotRecordedIn10Minutes(t *testing.T) {
	w := newRunSleepWorld(t)
	w.arm("run-42")
	w.now = w.now.Add(sleepAfterRunGiveUp + time.Second)
	w.writeRun("run-42")
	w.report(baseds.AgentState_Idle, baseds.AgentHook_Stop)
	if len(w.timers) != 0 || w.armed() {
		t.Errorf("timers = %d, armed = %v, want the late entry dropped", len(w.timers), w.armed())
	}
}

func TestSleepAfterRunIgnoresASessionStartIdle(t *testing.T) {
	w := newRunSleepWorld(t)
	w.arm("run-42")
	w.writeRun("run-42")
	w.report(baseds.AgentState_Idle, baseds.AgentHook_SessionStart)
	if len(w.timers) != 0 {
		t.Errorf("a SessionStart idle started the countdown")
	}
}

func TestSleepAfterRunFollowsTheSetting(t *testing.T) {
	t.Run("off at the arm", func(t *testing.T) {
		w := newRunSleepWorld(t)
		w.enabled = false
		w.writeRun("run-42")
		w.arm("run-42")
		if w.armed() || len(w.timers) != 0 {
			t.Errorf("armed with Sleep idle agents off")
		}
	})
	t.Run("off at the fire", func(t *testing.T) {
		w := newRunSleepWorld(t)
		w.writeRun("run-42")
		w.arm("run-42")
		w.enabled = false
		w.fireAll()
		if len(w.slept) != 0 {
			t.Errorf("slept = %v with Sleep idle agents off", w.slept)
		}
	})
}

func TestSleepAfterRunSkipsWhatAPersonsSleepWould(t *testing.T) {
	t.Run("background work", func(t *testing.T) {
		w := newRunSleepWorld(t)
		w.background = []string{"npm run dev"}
		w.writeRun("run-42")
		w.arm("run-42")
		w.fireAll()
		if len(w.slept) != 0 || len(w.notices) != 0 || w.armed() {
			t.Errorf("slept = %v, notices = %v, armed = %v, want nothing slept and the entry dropped", w.slept, w.notices, w.armed())
		}
	})
	t.Run("waiting on a permission", func(t *testing.T) {
		w := newRunSleepWorld(t)
		w.writeRun("run-42")
		w.arm("run-42")
		w.facts.Tabs[0].Status.State = baseds.AgentState_Waiting
		w.fireAll()
		if len(w.slept) != 0 || len(w.notices) != 0 {
			t.Errorf("slept = %v, want an agent waiting on a permission left awake", w.slept)
		}
	})
}

func TestSleepAfterRunRefusesAPathThatIsNoBrainstorm(t *testing.T) {
	newRunSleepWorld(t)
	err := (&WshServer{}).AgentsSleepAfterRunCommand(context.Background(), wshrpc.CommandAgentsSleepAfterRunData{Tab: agentsTabA, RunId: "run-42", Path: "/etc/passwd"})
	if err == nil {
		t.Errorf("armed on a file that is not a brainstorm.json")
	}
}
