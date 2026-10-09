// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsleep

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 9, 14, 0, 0, 0, time.UTC)

const plentyOfRAM = 8 << 30

var on = Settings{Enabled: true, After: 30 * time.Minute}

// eligible is a candidate every condition holds for, idle since `idle` before t0.
func eligible(tab string, idle time.Duration) Candidate {
	return Candidate{
		TabId:        tab,
		BlockId:      "b-" + tab,
		Harness:      "claude",
		Idle:         true,
		IdleSince:    t0.Add(-idle),
		SessionKnown: true,
		CPUIdle:      true,
	}
}

func TestPickSleepsOnlyAfterTheIdleTime(t *testing.T) {
	if got := Pick([]Candidate{eligible("a", 29*time.Minute)}, t0, on, plentyOfRAM); len(got) != 0 {
		t.Fatalf("idle 29m picked %v, want none", got)
	}
	if got := Pick([]Candidate{eligible("a", 30*time.Minute)}, t0, on, plentyOfRAM); !reflect.DeepEqual(got, []string{"a"}) {
		t.Fatalf("idle 30m picked %v, want [a]", got)
	}
}

func TestPickUsesTheSettingsIdleTime(t *testing.T) {
	s := Settings{Enabled: true, After: 10 * time.Minute}
	if got := Pick([]Candidate{eligible("a", 10*time.Minute)}, t0, s, plentyOfRAM); !reflect.DeepEqual(got, []string{"a"}) {
		t.Fatalf("After 10m, idle 10m picked %v, want [a]", got)
	}
	if got := Pick([]Candidate{eligible("a", 9*time.Minute)}, t0, s, plentyOfRAM); len(got) != 0 {
		t.Fatalf("After 10m, idle 9m picked %v, want none", got)
	}
}

func TestPickTimeTriggerTakesEveryEligibleAgentOldestFirst(t *testing.T) {
	cands := []Candidate{
		eligible("c", 45*time.Minute),
		eligible("a", 31*time.Minute),
		eligible("b", 45*time.Minute),
		eligible("d", 5*time.Minute),
	}
	got := Pick(cands, t0, on, plentyOfRAM)
	if want := []string{"b", "c", "a"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("picked %v, want %v", got, want)
	}
}

func TestPickNeverSleepsAgentsThatDoNotQualify(t *testing.T) {
	cases := []struct {
		name string
		edit func(*Candidate)
	}{
		{"not idle", func(c *Candidate) { c.Idle = false }},
		{"no idle time yet", func(c *Candidate) { c.IdleSince = time.Time{} }},
		{"run-owned", func(c *Candidate) { c.RunOwned = true }},
		{"no session to resume", func(c *Candidate) { c.SessionKnown = false }},
		{"being looked at", func(c *Candidate) { c.Viewing = true }},
		{"background task running", func(c *Candidate) { c.BackgroundRunning = true }},
		{"subagents running", func(c *Candidate) { c.SubagentsRunning = true }},
		{"busy CPU", func(c *Candidate) { c.CPUIdle = false }},
		{"codex cannot resume", func(c *Candidate) { c.Harness = "codex" }},
		{"opencode is not in the roster", func(c *Candidate) { c.Harness = "opencode" }},
		{"unknown harness", func(c *Candidate) { c.Harness = "" }},
	}
	for _, tc := range cases {
		for _, free := range []uint64{plentyOfRAM, 100 << 20} { // the RAM trigger must not slip it through
			c := eligible("a", 3*time.Hour)
			tc.edit(&c)
			if got := Pick([]Candidate{c}, t0, on, free); len(got) != 0 {
				t.Errorf("%s (free %d): picked %v, want none", tc.name, free, got)
			}
		}
	}
}

func TestPickOnlyTheHarnessesThatResume(t *testing.T) {
	for _, h := range []string{"claude", "pi", "agy"} {
		c := eligible("a", time.Hour)
		c.Harness = h
		if got := Pick([]Candidate{c}, t0, on, plentyOfRAM); !reflect.DeepEqual(got, []string{"a"}) {
			t.Errorf("%s: picked %v, want [a]", h, got)
		}
	}
}

func TestPickIgnoresIneligibleNeighbours(t *testing.T) {
	busy := eligible("busy", 3*time.Hour)
	busy.CPUIdle = false
	got := Pick([]Candidate{busy, eligible("ok", 40*time.Minute)}, t0, on, plentyOfRAM)
	if !reflect.DeepEqual(got, []string{"ok"}) {
		t.Fatalf("picked %v, want [ok]", got)
	}
}

func TestPickRAMTriggerSleepsTheLongestIdleOne(t *testing.T) {
	cands := []Candidate{
		eligible("a", 10*time.Minute),
		eligible("b", 20*time.Minute),
		eligible("c", 5*time.Minute),
	}
	got := Pick(cands, t0, on, LowRAM-1)
	if want := []string{"b"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("low RAM picked %v, want %v (one agent, the longest idle)", got, want)
	}
}

func TestPickRAMTriggerBreaksATieByTabId(t *testing.T) {
	cands := []Candidate{eligible("z", 20*time.Minute), eligible("m", 20*time.Minute)}
	if got := Pick(cands, t0, on, 0); !reflect.DeepEqual(got, []string{"m"}) {
		t.Fatalf("picked %v, want [m]", got)
	}
}

func TestPickRAMTriggerNeverSleepsAnAgentThatJustFinished(t *testing.T) {
	cands := []Candidate{eligible("a", RAMTriggerMinIdle-time.Second)}
	if got := Pick(cands, t0, on, 0); len(got) != 0 {
		t.Fatalf("idle %v picked %v, want none", RAMTriggerMinIdle-time.Second, got)
	}
	cands = []Candidate{eligible("a", RAMTriggerMinIdle)}
	if got := Pick(cands, t0, on, 0); !reflect.DeepEqual(got, []string{"a"}) {
		t.Fatalf("idle %v picked %v, want [a]", RAMTriggerMinIdle, got)
	}
}

func TestPickRAMAtTheLimitIsNotLow(t *testing.T) {
	if got := Pick([]Candidate{eligible("a", 20*time.Minute)}, t0, on, LowRAM); len(got) != 0 {
		t.Fatalf("free == LowRAM picked %v, want none", got)
	}
}

func TestPickRAMTriggerOnlyWhenTimeTriggerPickedNone(t *testing.T) {
	cands := []Candidate{eligible("old", 40*time.Minute), eligible("mid", 20*time.Minute)}
	got := Pick(cands, t0, on, LowRAM-1)
	if want := []string{"old"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("picked %v, want %v: the time trigger already freed RAM, so mid stays", got, want)
	}
}

func TestPickDisabledPicksNone(t *testing.T) {
	off := Settings{Enabled: false, After: 30 * time.Minute}
	cands := []Candidate{eligible("a", 3*time.Hour)}
	for _, free := range []uint64{plentyOfRAM, 0} {
		if got := Pick(cands, t0, off, free); len(got) != 0 {
			t.Errorf("disabled (free %d) picked %v, want none", free, got)
		}
	}
}

func TestPickNothingToPick(t *testing.T) {
	if got := Pick(nil, t0, on, 0); len(got) != 0 {
		t.Fatalf("picked %v from no candidates", got)
	}
}

func TestIdleTrackerKeepsFirstIdleTime(t *testing.T) {
	tr := NewIdleTracker()
	t1 := t0.Add(time.Minute)
	t2 := t0.Add(2 * time.Minute)
	t3 := t0.Add(3 * time.Minute)

	if got := tr.Observe("b1", true, t0); !got.Equal(t0) {
		t.Fatalf("first idle observation = %v, want %v", got, t0)
	}
	if got := tr.Observe("b1", true, t1); !got.Equal(t0) {
		t.Fatalf("a second idle observation = %v, want the first, %v", got, t0)
	}
	if got := tr.Observe("b1", false, t2); !got.IsZero() {
		t.Fatalf("working observation = %v, want zero", got)
	}
	if got := tr.Observe("b1", true, t3); !got.Equal(t3) {
		t.Fatalf("idle again after working = %v, want the new stretch, %v", got, t3)
	}
}

func TestIdleTrackerKeepsBlocksApart(t *testing.T) {
	tr := NewIdleTracker()
	tr.Observe("b1", true, t0)
	if got := tr.Observe("b2", true, t0.Add(time.Minute)); !got.Equal(t0.Add(time.Minute)) {
		t.Fatalf("b2 = %v, want its own first time", got)
	}
	if got := tr.Observe("b1", true, t0.Add(2*time.Minute)); !got.Equal(t0) {
		t.Fatalf("b1 = %v, want %v", got, t0)
	}
}

func TestIdleTrackerForgetDropsGoneBlocks(t *testing.T) {
	tr := NewIdleTracker()
	tr.Observe("keep", true, t0)
	tr.Observe("gone", true, t0)
	tr.Forget(map[string]bool{"keep": true})
	if got := tr.Observe("keep", true, t0.Add(time.Hour)); !got.Equal(t0) {
		t.Fatalf("kept block lost its time: %v", got)
	}
	if got := tr.Observe("gone", true, t0.Add(time.Hour)); !got.Equal(t0.Add(time.Hour)) {
		t.Fatalf("forgotten block kept its old time: %v", got)
	}
}

// feed adds one sample a minute from t0 for `minutes`+1 samples; ms(i) is the cumulative CPU at minute i.
func feed(r *CPURing, id string, minutes int, ms func(i int) float64) time.Time {
	var now time.Time
	for i := 0; i <= minutes; i++ {
		now = t0.Add(time.Duration(i) * time.Minute)
		r.Add(id, now, ms(i))
	}
	return now
}

func TestCPURingIdleOnlyOverAFullWindow(t *testing.T) {
	r := NewCPURing()
	if r.Idle("b1", t0) {
		t.Fatal("a block never sampled read as idle")
	}
	now := feed(r, "b1", 4, func(int) float64 { return 100 }) // 4 minutes of flat CPU
	if r.Idle("b1", now) {
		t.Fatal("4 minutes of samples read as idle; the window is 5")
	}
	now = t0.Add(5 * time.Minute)
	r.Add("b1", now, 100)
	if !r.Idle("b1", now) {
		t.Fatal("5 minutes of flat CPU did not read as idle")
	}
}

func TestCPURingShareThreshold(t *testing.T) {
	// cumulative ms grows by share * 60000 each minute
	at := func(share float64) func(int) float64 {
		return func(i int) float64 { return 1000 + share*60000*float64(i) }
	}
	r := NewCPURing()
	now := feed(r, "low", 5, at(0.04))
	if !r.Idle("low", now) {
		t.Error("a 4% share read as busy")
	}
	r = NewCPURing()
	now = feed(r, "high", 5, at(0.06))
	if r.Idle("high", now) {
		t.Error("a 6% share read as idle")
	}
	r = NewCPURing()
	// 3000 ms a minute is 15000 ms over the 300000 ms window: exactly 5%
	now = feed(r, "edge", 5, func(i int) float64 { return 1000 + 3000*float64(i) })
	if r.Idle("edge", now) {
		t.Error("a share of exactly IdleCPUShare read as idle; it must be under")
	}
}

func TestCPURingBurstOutsideTheWindowIsForgotten(t *testing.T) {
	r := NewCPURing()
	// busy for the first 3 minutes (a build), then flat for 10
	now := feed(r, "b1", 13, func(i int) float64 {
		if i <= 3 {
			return float64(i) * 60000 // a whole core
		}
		return 3 * 60000
	})
	if !r.Idle("b1", now) {
		t.Fatal("CPU that went quiet more than 5 minutes ago still reads as busy")
	}
}

func TestCPURingBurstInsideTheWindowIsBusy(t *testing.T) {
	r := NewCPURing()
	now := feed(r, "b1", 10, func(i int) float64 {
		if i >= 9 {
			return 100 + float64(i-8)*60000
		}
		return 100
	})
	if r.Idle("b1", now) {
		t.Fatal("a burst in the last 2 minutes read as idle")
	}
}

func TestCPURingFallingTotalIsBusy(t *testing.T) {
	// a child process that ran and exited takes its CPU out of the tree's total
	r := NewCPURing()
	now := feed(r, "b1", 5, func(i int) float64 {
		switch i {
		case 0, 1:
			return 5000
		default:
			return 100
		}
	})
	if r.Idle("b1", now) {
		t.Fatal("a falling cumulative total read as idle")
	}
	// the dip is gone once it is older than the window
	for i := 6; i <= 12; i++ {
		now = t0.Add(time.Duration(i) * time.Minute)
		r.Add("b1", now, 100)
	}
	if !r.Idle("b1", now) {
		t.Fatal("a dip older than the window still reads as busy")
	}
}

func TestCPURingStaleSamplesAreNotIdle(t *testing.T) {
	r := NewCPURing()
	feed(r, "b1", 6, func(int) float64 { return 100 })
	if r.Idle("b1", t0.Add(2*time.Hour)) {
		t.Fatal("samples from two hours ago read as an idle window now")
	}
}

func TestCPURingKeepsOnlyTheWindow(t *testing.T) {
	r := NewCPURing()
	feed(r, "b1", 240, func(int) float64 { return 100 })
	if n := len(r.samples["b1"]); n > int(CPUWindow/time.Minute)+2 {
		t.Fatalf("ring holds %d samples after 4 hours, want about the window's worth", n)
	}
}

func TestCPURingForgetDropsGoneBlocks(t *testing.T) {
	r := NewCPURing()
	now := feed(r, "keep", 5, func(int) float64 { return 100 })
	feed(r, "gone", 5, func(int) float64 { return 100 })
	r.Forget(map[string]bool{"keep": true})
	if !r.Idle("keep", now) {
		t.Error("kept block lost its samples")
	}
	if r.Idle("gone", now) {
		t.Error("forgotten block kept its samples")
	}
}

func TestManualBlocksOnlyOnBackgroundWork(t *testing.T) {
	// the person chose this agent: idle time, viewing, state and CPU do not matter
	c := Candidate{TabId: "a", Harness: "claude", Viewing: true, Idle: false, CPUIdle: false}
	if got := Blocker(c); got != "" {
		t.Fatalf("Blocker with no background work = %q, want empty", got)
	}

	c.BackgroundRunning = true
	bg := Blocker(c)
	if bg == "" {
		t.Fatal("Blocker ignored a background task")
	}

	c.BackgroundRunning, c.SubagentsRunning = false, true
	sub := Blocker(c)
	if sub == "" {
		t.Fatal("Blocker ignored a subagent")
	}
	if bg == sub {
		t.Fatalf("Blocker gives the same reason for a task and a subagent: %q", bg)
	}

	c.BackgroundRunning = true
	both := Blocker(c)
	if both == "" || !strings.Contains(both, "background") || !strings.Contains(both, "subagent") {
		t.Fatalf("Blocker with both = %q, want it to name both", both)
	}
}
