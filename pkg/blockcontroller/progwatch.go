// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"log"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/progstatus"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

// progWatch answers a program's Program Status probe (OSC 7501) and falls back on its reports when the agent hooks
// fall silent (progstatus.Fallback). One per running process, fed from the PTY read loop: answering there, before
// the output reaches the frontend, puts the reply ahead of xterm's answer to the device-attributes query the program
// sends after its probe, and a replay of the stored output never answers again.
type progWatch struct {
	blockId  string
	reply    func()
	latest   func() baseds.AgentStatusData
	publish  func(state, agent string, ts int64)
	now      func() time.Time
	schedule func(d time.Duration, f func()) *time.Timer

	scan    progstatus.Scanner // touched by the read loop alone
	mu      sync.Mutex
	last    *progstatus.Report
	lastMs  int64
	timer   *time.Timer
	stopped bool
}

func newProgWatch(blockId string, reply func()) *progWatch {
	return &progWatch{
		blockId: blockId,
		reply:   reply,
		latest:  func() baseds.AgentStatusData { return latestBlockAgentStatus(blockId) },
		publish: func(state, agent string, ts int64) {
			wps.Broker.Publish(AgentStatusEvent(blockId, state, agent, ts))
		},
		now:      time.Now,
		schedule: time.AfterFunc,
	}
}

// output reads one chunk of the process's output.
func (w *progWatch) output(chunk []byte) {
	for _, ev := range w.scan.Feed(chunk) {
		switch {
		case ev.Probe:
			w.reply()
		case ev.Report != nil && ev.Report.ID == "":
			w.report(*ev.Report)
		}
	}
}

// report keeps the newest root report and checks it once the hooks have had QuietMs to report the change
// themselves.
func (w *progWatch) report(r progstatus.Report) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.stopped {
		return
	}
	w.last, w.lastMs = &r, w.now().UnixMilli()
	if w.timer != nil {
		w.timer.Stop()
	}
	w.timer = w.schedule(progstatus.QuietMs*time.Millisecond, w.check)
}

func (w *progWatch) check() {
	w.mu.Lock()
	if w.stopped || w.last == nil {
		w.mu.Unlock()
		return
	}
	r, at := *w.last, w.lastMs
	w.mu.Unlock()
	latest := w.latest()
	now := w.now().UnixMilli()
	if state := progstatus.Fallback(r, at, latest, now); state != "" {
		log.Printf("agent status: block %s's hooks said nothing for %ds around its change to %s; taking its OSC 7501 report (%s)\n",
			w.blockId, progstatus.QuietMs/1000, r.State, state)
		w.publish(state, latest.Agent, now)
	}
}

// stop ends the watch with its process: a report checked after the exit would undo the exit's own idle.
func (w *progWatch) stop() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.stopped = true
	if w.timer != nil {
		w.timer.Stop()
	}
}

// latestBlockAgentStatus is the newest status reported on the block itself, zero when there is none.
func latestBlockAgentStatus(blockId string) baseds.AgentStatusData {
	var latest baseds.AgentStatusData
	oref := waveobj.MakeORef(waveobj.OType_Block, blockId).String()
	for _, ev := range wps.Broker.ReadEventHistory(wps.Event_AgentStatus, oref, 1) {
		var d baseds.AgentStatusData
		if utilfn.ReUnmarshal(&d, ev.Data) == nil && d.State != "" {
			latest = d
		}
	}
	return latest
}
