// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/progstatus"
)

type progWorld struct {
	w         *progWatch
	replies   int
	published []string
	scheduled func()
	clock     time.Time
	latest    baseds.AgentStatusData
}

func newProgWorld() *progWorld {
	pw := &progWorld{clock: time.UnixMilli(10_000_000)}
	pw.w = &progWatch{
		blockId: "block-a",
		reply:   func() { pw.replies++ },
		latest:  func() baseds.AgentStatusData { return pw.latest },
		publish: func(state, agent string, ts int64) { pw.published = append(pw.published, state+"/"+agent) },
		now:     func() time.Time { return pw.clock },
		schedule: func(d time.Duration, f func()) *time.Timer {
			pw.scheduled = f
			t := time.NewTimer(time.Hour)
			t.Stop()
			return t
		},
	}
	return pw
}

// fire runs the scheduled check once the quiet time has passed
func (pw *progWorld) fire() {
	pw.clock = pw.clock.Add(progstatus.QuietMs * time.Millisecond)
	if pw.scheduled != nil {
		pw.scheduled()
	}
}

func TestProgWatchAnswersTheProbe(t *testing.T) {
	pw := newProgWorld()
	pw.w.output([]byte("starting\x1b]7501;?\x1b\\\x1b[c"))
	if pw.replies != 1 {
		t.Fatalf("replies = %d, want one answer to the probe", pw.replies)
	}
	pw.w.output([]byte("\x1b]7501;state=working\x1b\\"))
	if pw.replies != 1 {
		t.Fatalf("a report was answered: replies = %d", pw.replies)
	}
}

func TestProgWatchFallsBackWhenTheHooksAreSilent(t *testing.T) {
	pw := newProgWorld()
	pw.latest = baseds.AgentStatusData{State: baseds.AgentState_Working, Agent: "claude", Ts: pw.clock.UnixMilli() - 60_000}
	pw.w.output([]byte("\x1b]7501;state=done:app=claude-code\x1b\\"))
	pw.fire()
	if len(pw.published) != 1 || pw.published[0] != "idle/claude" {
		t.Fatalf("published %v, want the agent idle", pw.published)
	}
}

func TestProgWatchLeavesAHookReportedChangeAlone(t *testing.T) {
	pw := newProgWorld()
	pw.latest = baseds.AgentStatusData{State: baseds.AgentState_Working, Agent: "claude", Ts: pw.clock.UnixMilli() - 60_000}
	pw.w.output([]byte("\x1b]7501;state=done\x1b\\"))
	// the Stop hook reported the turn's end itself, as working: its background work still runs
	pw.latest = baseds.AgentStatusData{State: baseds.AgentState_Working, Agent: "claude", Ts: pw.clock.UnixMilli() + 300}
	pw.fire()
	if len(pw.published) != 0 {
		t.Fatalf("published %v over a hook's report", pw.published)
	}
}

func TestProgWatchStopsWithItsProcess(t *testing.T) {
	pw := newProgWorld()
	pw.latest = baseds.AgentStatusData{State: baseds.AgentState_Working, Agent: "claude", Ts: pw.clock.UnixMilli() - 60_000}
	pw.w.output([]byte("\x1b]7501;state=done\x1b\\"))
	pw.w.stop()
	pw.fire()
	if len(pw.published) != 0 {
		t.Fatalf("published %v after the process exited", pw.published)
	}
}
