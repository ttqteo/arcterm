// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package keepawake holds off the Mac's idle sleep while arcterm has work that moves on without the person: an agent
// mid-turn, an orchestrator run in flight, a heavy job running. On battery the Mac sleeps 11 minutes after the person
// leaves it, and a run left going then creeps one step per DarkWake (pkg/sleepwatch notices it afterwards).
//
// Claude Code already runs `caffeinate -i` during its own turns; that leaves the engine's Setup, Verify and Final,
// pi, codex and agy workers, and the gaps between a lead's wakes. The hold is the same idle-sleep assertion: the
// display still sleeps and the screen still locks, and closing the lid or choosing Sleep still sleeps the Mac.
//
// Decide is pure; the caller gathers the facts and Holder takes or drops the assertion.
package keepawake

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

const (
	// StaleWorking is how old a working status may be and still count: every tool call refreshes it, so one older
	// than this is a turn that ended without saying so (a crash, an interrupt), not work.
	StaleWorking = 30 * time.Minute
	// LowBatteryPct is the charge under which, on battery, the hold lets go: a run left going does not flatten the
	// laptop.
	LowBatteryPct = 20
)

// Battery is the power source as pmset reports it. Pct is -1 when there is no battery or it could not be read.
type Battery struct {
	OnBattery bool
	Pct       int
}

// Facts is what one check found.
type Facts struct {
	WorkingAgents int
	ActiveRuns    int
	RunningJobs   int
	Battery       Battery
}

func (f Facts) work() bool {
	return f.WorkingAgents > 0 || f.ActiveRuns > 0 || f.RunningJobs > 0
}

// Decide says whether to hold the Mac awake, and why, in the words the log prints.
func Decide(enabled bool, f Facts) (hold bool, why string) {
	switch {
	case !enabled:
		return false, "power:keepawake is off"
	case !f.work():
		return false, "nothing is working"
	case f.Battery.OnBattery && f.Battery.Pct >= 0 && f.Battery.Pct < LowBatteryPct:
		return false, fmt.Sprintf("on battery at %d%%", f.Battery.Pct)
	}
	var parts []string
	if f.ActiveRuns > 0 {
		parts = append(parts, count(f.ActiveRuns, "run", "runs"))
	}
	if f.WorkingAgents > 0 {
		parts = append(parts, count(f.WorkingAgents, "agent", "agents")+" working")
	}
	if f.RunningJobs > 0 {
		parts = append(parts, count(f.RunningJobs, "job", "jobs"))
	}
	return true, strings.Join(parts, ", ")
}

// Working says whether an agent status counts as work at now: a working state reported within StaleWorking. ts is
// the status's Unix ms.
func Working(state string, ts int64, now time.Time) bool {
	return state == baseds.AgentState_Working && now.Sub(time.UnixMilli(ts)) < StaleWorking
}

var battPct = regexp.MustCompile(`(\d+)%`)

// ParseBatt reads `pmset -g batt`: the source on its first line, the charge on the battery's line. A Mac with no
// battery reads as on AC with Pct -1.
func ParseBatt(out string) Battery {
	b := Battery{Pct: -1}
	first, rest, _ := strings.Cut(out, "\n")
	b.OnBattery = strings.Contains(first, "'Battery Power'")
	if m := battPct.FindStringSubmatch(rest); m != nil {
		if n, err := strconv.Atoi(m[1]); err == nil {
			b.Pct = n
		}
	}
	return b
}

func count(n int, one, many string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, one)
	}
	return fmt.Sprintf("%d %s", n, many)
}
