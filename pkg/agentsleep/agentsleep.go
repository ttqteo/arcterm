// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentsleep decides which idle agents may be put to sleep: their process ended to free RAM, their
// tab and conversation kept, resumed on demand. Pure; wshserver gathers the facts and does the sleeping.
//
// Nothing here reads a clock or looks at a process: the caller passes the time, free RAM and the facts about
// each agent in, so every rule is a plain function of its inputs.
package agentsleep

import (
	"cmp"
	"slices"
	"time"
)

const (
	// below this much free RAM, the longest-idle agent sleeps early
	LowRAM uint64 = 1 << 30
	// the RAM trigger still never sleeps an agent that just finished
	RAMTriggerMinIdle = time.Minute
	// how long a process tree's CPU must stay quiet before the agent counts as truly idle
	CPUWindow = 5 * time.Minute
	// the share of one core under which a tree counts as idle
	IdleCPUShare = 0.05
)

// Harnesses are the agents that can sleep: those the roster lists that resume a conversation. codex cannot
// resume; opencode resumes but is not in the roster, so there is none to sleep.
var Harnesses = map[string]bool{"claude": true, "pi": true, "agy": true}

// Candidate is what the loop knows about one live agent.
type Candidate struct {
	TabId, BlockId, Harness string
	Idle                    bool      // raw status idle (not waiting for a permission, not asking)
	IdleSince               time.Time // from IdleTracker; zero when not idle
	RunOwned                bool      // the lead or a worker of a run: the engine owns it
	SessionKnown            bool      // --resume has a session to reopen
	Viewing                 bool      // the focused agent, or a pane showing in the Agent grid
	BackgroundRunning       bool      // a Claude background shell task is alive under it
	SubagentsRunning        bool      // a subagent is alive under it
	CPUIdle                 bool      // CPURing.Idle over CPUWindow
}

// Settings are the person's two settings: Sleep idle agents, and After idle for.
type Settings struct {
	Enabled bool
	After   time.Duration
}

// canSleep is the whole eligibility rule: every condition holds.
func canSleep(c Candidate) bool {
	return Harnesses[c.Harness] && c.Idle && !c.IdleSince.IsZero() && !c.RunOwned && c.SessionKnown &&
		!c.Viewing && !c.BackgroundRunning && !c.SubagentsRunning && c.CPUIdle
}

// Pick returns the tab ids to sleep this check: every eligible agent idle for Settings.After, or, when none
// is and free RAM is under LowRAM, the one eligible agent idle longest (at least RAMTriggerMinIdle). The RAM
// trigger sleeps one agent a check so a drop never sleeps more agents than it needs. Ids come back longest
// idle first, ties by tab id. Pass math.MaxUint64 as freeBytes when free RAM could not be read.
func Pick(cands []Candidate, now time.Time, s Settings, freeBytes uint64) []string {
	if !s.Enabled {
		return nil
	}
	var ok []Candidate
	for _, c := range cands {
		if canSleep(c) {
			ok = append(ok, c)
		}
	}
	slices.SortFunc(ok, func(a, b Candidate) int {
		if d := a.IdleSince.Compare(b.IdleSince); d != 0 {
			return d
		}
		return cmp.Compare(a.TabId, b.TabId)
	})
	var due []string
	for _, c := range ok {
		if now.Sub(c.IdleSince) >= s.After {
			due = append(due, c.TabId)
		}
	}
	if len(due) > 0 {
		return due
	}
	if freeBytes >= LowRAM || len(ok) == 0 {
		return nil
	}
	if longest := ok[0]; now.Sub(longest.IdleSince) >= RAMTriggerMinIdle {
		return []string{longest.TabId}
	}
	return nil
}

// Blocker says why the person's own Sleep must ask first ("" when nothing stands in the way): background
// tasks or subagents still running, which ending the agent's process would end too. It ignores idle time,
// state, CPU and Viewing; the person chose this agent.
func Blocker(c Candidate) string {
	switch {
	case c.BackgroundRunning && c.SubagentsRunning:
		return "background tasks and subagents are still running"
	case c.BackgroundRunning:
		return "background tasks are still running"
	case c.SubagentsRunning:
		return "subagents are still running"
	}
	return ""
}

// IdleTracker remembers when each block's current idle stretch began. status.Ts is not that time: Claude's
// idle_prompt re-reports idle about a minute after Stop, and a destroyed controller's exit publishes a bare
// idle. Not safe for concurrent use; the sleep loop owns it.
type IdleTracker struct{ since map[string]time.Time }

func NewIdleTracker() *IdleTracker {
	return &IdleTracker{since: map[string]time.Time{}}
}

// Observe records this check's state for a block and returns the first idle time of the current idle
// stretch; zero when the block is not idle. A block that works resets its stretch.
func (t *IdleTracker) Observe(blockId string, idle bool, now time.Time) time.Time {
	if !idle {
		delete(t.since, blockId)
		return time.Time{}
	}
	since, ok := t.since[blockId]
	if !ok {
		since = now
		t.since[blockId] = since
	}
	return since
}

// Forget drops blocks no longer in the roster.
func (t *IdleTracker) Forget(keep map[string]bool) {
	for id := range t.since {
		if !keep[id] {
			delete(t.since, id)
		}
	}
}

type cpuSample struct {
	at time.Time
	ms float64 // cumulative CPU time of the agent's process tree
}

// CPURing keeps each block's recent cumulative-CPU samples, enough to tell whether its process tree did any
// work over the last CPUWindow. Not safe for concurrent use; the sleep loop owns it.
type CPURing struct{ samples map[string][]cpuSample }

func NewCPURing() *CPURing {
	return &CPURing{samples: map[string][]cpuSample{}}
}

// Add records the tree's cumulative CPU milliseconds at a time. It keeps the samples inside the window plus
// the newest one at or before the window's start, which Idle measures from.
func (r *CPURing) Add(blockId string, now time.Time, cumulativeMs float64) {
	ss := append(r.samples[blockId], cpuSample{at: now, ms: cumulativeMs})
	cut := now.Add(-CPUWindow)
	drop := 0
	for drop+1 < len(ss) && !ss[drop+1].at.After(cut) {
		drop++
	}
	n := copy(ss, ss[drop:])
	r.samples[blockId] = ss[:n]
}

// Idle reports whether the tree's CPU stayed near zero over a full CPUWindow ending at now: true only with
// samples that span the window and a delta share under IdleCPUShare of one core. A cumulative total that
// ever falls inside the window is busy: a child process ran and exited, taking its CPU time out of the sum.
func (r *CPURing) Idle(blockId string, now time.Time) bool {
	ss := r.samples[blockId]
	cut := now.Add(-CPUWindow)
	base := -1
	for i := len(ss) - 1; i >= 0; i-- {
		if !ss[i].at.After(cut) {
			base = i
			break
		}
	}
	if base < 0 {
		return false
	}
	for i := base + 1; i < len(ss); i++ {
		if ss[i].ms < ss[i-1].ms {
			return false
		}
	}
	end := ss[len(ss)-1]
	span := end.at.Sub(ss[base].at)
	if span < CPUWindow {
		return false
	}
	return (end.ms-ss[base].ms)/float64(span.Milliseconds()) < IdleCPUShare
}

// Forget drops blocks no longer in the roster.
func (r *CPURing) Forget(keep map[string]bool) {
	for id := range r.samples {
		if !keep[id] {
			delete(r.samples, id)
		}
	}
}
