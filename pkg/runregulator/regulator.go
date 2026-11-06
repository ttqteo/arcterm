// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package runregulator

import (
	"time"

	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// The regulator's thresholds, in one place (spec decision 12). The 30-minute no-flap hold is not here: runpause.Pause
// sets it on a run it pauses again soon after a resume (Pause.NoAutoResumeUntil), and Decide only reads it.
const (
	// TightFor is how long the pressure must stay tight (warn or critical) before the regulator pauses a run.
	TightFor = 60 * time.Second
	// NormalFor is how long the pressure must stay normal before the regulator resumes a run, and again after each
	// resume, so one resume's RAM shows in the reading before the next.
	NormalFor = 5 * time.Minute
	// PauseWindow is the least time between two pauses: one fresh reading to judge the last one by.
	PauseWindow = 60 * time.Second
	// ResumeMargin is the free RAM a resume wants beyond what the run held when it paused.
	ResumeMargin = uint64(4) << 30
	// MinHeldBytes is the least a run must hold to be worth pausing: a smaller one is not what makes the machine
	// tight, and pausing it for nothing costs a restart of its sessions.
	MinHeldBytes = uint64(1) << 30
	// StandDownAfter is how many back-to-back pauses may fail to lower the pressure before the regulator stops
	// pausing until the pressure is normal again: the machine is tight for reasons outside Arc's runs.
	StandDownAfter = 2
)

// Kind is what Decide asks the loop to do.
type Kind int

const (
	ActionNone Kind = iota
	ActionPause
	ActionResume
)

// Action is Decide's answer: at most one run to pause or resume.
type Action struct {
	Kind      Kind
	RunID     string
	ChannelID string
}

// Candidate is one top-level run that has not ended, as Decide ranks it.
type Candidate struct {
	RunID      string
	ChannelID  string
	CreatedTs  int64 // Unix ms
	TasksDone  int
	Finalizing bool // its dag is in the final stage
	MidMerge   bool // a task is verifying, or a merge-required dag has a done task not yet merged
	Paused     bool
	PausedTs   int64 // Unix ms; paused runs only
	// HeldBytes is the RAM the run's agents and commands hold now when it is not paused, and what it held when it
	// paused when it is. Only the runs the regulator may pause are measured.
	HeldBytes         uint64
	NoAutoResumeUntil int64 // Unix ms; the no-flap hold, paused runs only
}

// Input is everything Decide reads: no clock, no store.
type Input struct {
	Pressure   jobqueue.Pressure
	FreeBytes  uint64
	Now        time.Time
	Candidates []Candidate
}

// State is what Decide carries between ticks. The zero value is a regulator that has seen nothing.
type State struct {
	tightSince  time.Time // when the pressure last turned tight; zero while it is not
	normalSince time.Time // when it last turned normal, or a resume restarted the clock; zero while tight

	lastPause         time.Time
	lastPausePressure jobqueue.Pressure
	pauseUnjudged     bool // the last pause has not yet been compared with a later reading
	missed            int  // back-to-back pauses that did not lower the pressure
	standDown         bool
}

// Failed tells the state that the loop could not apply a, so it does not count as a pause that failed to help. The
// window (and, for a resume, the clock) it started stays: a failing action is retried at the usual pace, not every
// tick.
func (st *State) Failed(a Action) {
	if a.Kind == ActionPause {
		st.pauseUnjudged = false
	}
}

// tight is a warn or critical reading. Anything else is normal, an unknown reading too: on Windows
// jobqueue.PressureFromCommit never reads normal, only unknown, so reading normal literally would never resume.
func tight(p jobqueue.Pressure) bool {
	return p == jobqueue.PressureWarn || p == jobqueue.PressureCritical
}

// rank orders a reading by how bad it is, so "lower" is a smaller rank. Critical falling to warn is lower.
func rank(p jobqueue.Pressure) int {
	switch p {
	case jobqueue.PressureCritical:
		return 2
	case jobqueue.PressureWarn:
		return 1
	}
	return 0
}

// Decide picks at most one action from the pressure, the free RAM and the candidate runs, and moves st on. It reads
// no clock and no store; the loop applies the action.
func Decide(st *State, in Input) Action {
	if tight(in.Pressure) {
		st.normalSince = time.Time{}
		if st.tightSince.IsZero() {
			st.tightSince = in.Now
		}
		return decidePause(st, in)
	}
	st.tightSince = time.Time{}
	st.pauseUnjudged, st.missed, st.standDown = false, 0, false
	if st.normalSince.IsZero() {
		st.normalSince = in.Now
	}
	return decideResume(st, in)
}

func decidePause(st *State, in Input) Action {
	if in.Now.Sub(st.tightSince) < TightFor {
		return Action{}
	}
	if !st.lastPause.IsZero() && in.Now.Sub(st.lastPause) < PauseWindow {
		return Action{}
	}
	// the window passed: this reading judges the last pause
	if st.pauseUnjudged {
		st.pauseUnjudged = false
		if rank(in.Pressure) < rank(st.lastPausePressure) {
			st.missed = 0
		} else {
			st.missed++
		}
		if st.missed >= StandDownAfter {
			st.standDown = true
		}
	}
	if st.standDown {
		return Action{}
	}
	var pick *Candidate
	for i := range in.Candidates {
		c := &in.Candidates[i]
		if c.Paused || c.Finalizing || c.MidMerge || c.HeldBytes < MinHeldBytes {
			continue
		}
		if pick == nil || pausesBefore(c, pick) {
			pick = c
		}
	}
	if pick == nil {
		return Action{}
	}
	st.lastPause, st.lastPausePressure, st.pauseUnjudged = in.Now, in.Pressure, true
	return Action{Kind: ActionPause, RunID: pick.RunID, ChannelID: pick.ChannelID}
}

// pausesBefore orders the runs to pause: the fewest tasks done, then the most recently created. The id settles a tie
// so the pick does not depend on the order the store lists runs in.
func pausesBefore(a, b *Candidate) bool {
	if a.TasksDone != b.TasksDone {
		return a.TasksDone < b.TasksDone
	}
	if a.CreatedTs != b.CreatedTs {
		return a.CreatedTs > b.CreatedTs
	}
	return a.RunID < b.RunID
}

func decideResume(st *State, in Input) Action {
	if in.Now.Sub(st.normalSince) < NormalFor {
		return Action{}
	}
	// The run paused longest whose hold has passed. It waits for its RAM rather than being passed by a smaller run, so
	// a big run is not starved.
	var pick *Candidate
	for i := range in.Candidates {
		c := &in.Candidates[i]
		if !c.Paused || c.NoAutoResumeUntil > in.Now.UnixMilli() {
			continue
		}
		if pick == nil || c.PausedTs < pick.PausedTs || (c.PausedTs == pick.PausedTs && c.RunID < pick.RunID) {
			pick = c
		}
	}
	if pick == nil || in.FreeBytes <= pick.HeldBytes+ResumeMargin {
		return Action{}
	}
	st.normalSince = in.Now // the next resume waits for this one's RAM to show
	return Action{Kind: ActionResume, RunID: pick.RunID, ChannelID: pick.ChannelID}
}

// Finalizing is whether g is in the final stage, which judges the merged result and which a pause would cut short.
func Finalizing(g *waveobj.TaskGroup) bool {
	return g != nil && g.Status == orchestrate.DagStatus_Finalizing
}

// MidMerge is whether g is merging or verifying a merge: a task is verifying, or the dag requires merges and a done
// task has not merged yet. A merge itself runs under the dag lock, which a pause waits for anyway, so this keeps the
// regulator from picking a run whose pause would be held up.
func MidMerge(g *waveobj.TaskGroup) bool {
	if g == nil {
		return false
	}
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if t.State == orchestrate.TaskState_Verifying {
			return true
		}
		if g.MergeRequired && t.State == orchestrate.TaskState_Done && !t.Merged {
			return true
		}
	}
	return false
}

// TasksDone is how many of g's tasks are done (a skipped one is not), the progress the regulator ranks by.
func TasksDone(g *waveobj.TaskGroup) int {
	if g == nil {
		return 0
	}
	n := 0
	for i := range g.Tasks {
		if g.Tasks[i].State == orchestrate.TaskState_Done {
			n++
		}
	}
	return n
}
