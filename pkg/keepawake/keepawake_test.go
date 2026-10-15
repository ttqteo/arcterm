// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package keepawake

import (
	"testing"
	"time"
)

var ac = Battery{Pct: -1}

func TestDecideHoldsForEachKindOfWork(t *testing.T) {
	cases := []struct {
		f   Facts
		why string
	}{
		{Facts{ActiveRuns: 1, Battery: ac}, "1 run"},
		{Facts{WorkingAgents: 2, Battery: ac}, "2 agents working"},
		{Facts{RunningJobs: 1, Battery: ac}, "1 job"},
		{Facts{ActiveRuns: 2, WorkingAgents: 1, RunningJobs: 3, Battery: ac}, "2 runs, 1 agent working, 3 jobs"},
	}
	for _, c := range cases {
		hold, why := Decide(true, c.f)
		if !hold || why != c.why {
			t.Errorf("Decide(%+v) = %v %q, want true %q", c.f, hold, why, c.why)
		}
	}
}

func TestDecideLetsGoWithNoWorkOrSettingOff(t *testing.T) {
	if hold, why := Decide(true, Facts{Battery: ac}); hold || why != "nothing is working" {
		t.Errorf("idle: %v %q", hold, why)
	}
	if hold, why := Decide(false, Facts{ActiveRuns: 1, Battery: ac}); hold || why != "power:keepawake is off" {
		t.Errorf("off: %v %q", hold, why)
	}
}

func TestDecideLetsGoOnLowBattery(t *testing.T) {
	work := Facts{ActiveRuns: 1}
	work.Battery = Battery{OnBattery: true, Pct: 19}
	if hold, why := Decide(true, work); hold || why != "on battery at 19%" {
		t.Errorf("19%% on battery: %v %q", hold, why)
	}
	work.Battery = Battery{OnBattery: true, Pct: 20}
	if hold, _ := Decide(true, work); !hold {
		t.Error("20% on battery let go")
	}
	// charging at 5 %: plugged in, the hold costs no charge
	work.Battery = Battery{OnBattery: false, Pct: 5}
	if hold, _ := Decide(true, work); !hold {
		t.Error("5% on AC let go")
	}
	// a charge that could not be read never lets go
	work.Battery = Battery{OnBattery: true, Pct: -1}
	if hold, _ := Decide(true, work); !hold {
		t.Error("unknown charge on battery let go")
	}
}

func TestWorkingIgnoresAStaleOrOtherState(t *testing.T) {
	now := time.Date(2026, 10, 15, 20, 0, 0, 0, time.UTC)
	fresh := now.Add(-StaleWorking + time.Second).UnixMilli()
	stale := now.Add(-StaleWorking).UnixMilli()
	if !Working("working", fresh, now) {
		t.Error("a fresh working status did not count")
	}
	if Working("working", stale, now) {
		t.Error("a stale working status counted")
	}
	for _, s := range []string{"idle", "asking", "waiting", ""} {
		if Working(s, fresh, now) {
			t.Errorf("state %q counted as working", s)
		}
	}
}

func TestParseBatt(t *testing.T) {
	cases := []struct {
		name, out string
		want      Battery
	}{
		{"on battery", "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=27525219)\t21%; discharging; 2:41 remaining present: true\n", Battery{OnBattery: true, Pct: 21}},
		{"on AC", "Now drawing from 'AC Power'\n -InternalBattery-0 (id=27525219)\t100%; charged; 0:00 remaining present: true\n", Battery{OnBattery: false, Pct: 100}},
		{"no battery", "Now drawing from 'AC Power'\n", Battery{Pct: -1}},
		{"empty", "", Battery{Pct: -1}},
	}
	for _, c := range cases {
		if got := ParseBatt(c.out); got != c.want {
			t.Errorf("%s: ParseBatt = %+v, want %+v", c.name, got, c.want)
		}
	}
}
