// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Live reconfigure of a launched run's engine settings. Two rules keep this from becoming a second
// scheduler. Shape, machine and the active lead route are immutable after launch — changing them means a
// successor run, not an edit. And the pending/live split is explicit: before the DAG is submitted the Run
// carries the settings DagSubmit will consume, after submission the TaskGroup carries them because the
// TaskGroup is what the scheduler reads. Nothing writes both, so there is never a second live truth.
//
// A consequence worth stating rather than hiding: nothing here cancels a worker. Lowering parallelism
// below current occupancy is valid and means the scheduler waits before starting more children.

package jarvis

import (
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// PendingEngineSettings is the prospective engine configuration the session sheet writes. Parallelism nil
// means the caller is not touching the width, which is how omission and inheritance are expressed — an
// explicit value is always a width and must be inside the engine's range.
//
// WorkerRoute is deliberately not symmetric with those two: a nil route is itself a value (inherit the
// lead), so it is always applied. A caller that omits it is asking for inheritance, not asking for the
// stored route to be left alone — the sheet always sends the route it is showing, so the two readings
// only diverge for a hand-rolled client. ReviewerPicks, ReviewerRoute and LightReviewerRoute follow the same
// rule for the same reason: false is the WorkerRoute rule standing, a nil reviewer route is the lead's, and a
// nil light reviewer route is claude/sonnet.
//
// Autonomous is a pointer like Parallelism, not always-applied like the routes: nil leaves the stored value
// alone, so a save that is not about Approvals (the width action) and one that is only about it (the palette
// toggle) cannot overwrite each other.
type PendingEngineSettings struct {
	Parallelism        *int
	WorkerRoute        *waveobj.RoutePin
	ReviewerPicks      bool
	ReviewerRoute      *waveobj.RoutePin
	LightReviewerRoute *waveobj.RoutePin
	Autonomous         *bool
}

// EffectiveAutonomous is the Approvals setting in force for a run: the owning group's once one exists,
// the run's pending value before. A child run carries its parent's dag oref, so ownership is checked.
func EffectiveAutonomous(r *waveobj.Run, g *waveobj.TaskGroup) bool {
	if g != nil && r != nil && g.RunID == r.ID {
		return g.Autonomous
	}
	return r != nil && r.Autonomous
}

// EngineSettingsBlocker returns the reason a run's engine settings can no longer change, or "" when they
// can. Terminal is terminal, and only an engine orchestrator has a scheduler to reconfigure at all.
func EngineSettingsBlocker(r *waveobj.Run) string {
	if r == nil {
		return "the run is gone"
	}
	if r.Status == RunStatus_Done || r.Status == RunStatus_Cancelled {
		return fmt.Sprintf("the run is %s", r.Status)
	}
	if r.Mode != RunMode_Orchestrator {
		return fmt.Sprintf("only an orchestrator run has a scheduler to reconfigure (this run is %s)", r.Mode)
	}
	if !IsEngineRun(r) {
		return "an adaptive lead runs its own subagents, so there is no scheduler to reconfigure"
	}
	return ""
}

// ApplyPendingEngineSettings writes the prospective settings onto the run. DagSubmit already reads these
// exact fields, so an edit here is the same pending carrier the Run rail writes before launch.
func ApplyPendingEngineSettings(r waveobj.Run, s PendingEngineSettings) waveobj.Run {
	if s.Parallelism != nil {
		r.Parallelism = *s.Parallelism
	}
	r.WorkerRoute = s.WorkerRoute
	r.ReviewerPicks = s.ReviewerPicks
	r.ReviewerRoute = s.ReviewerRoute
	r.LightReviewerRoute = s.LightReviewerRoute
	if s.Autonomous != nil {
		r.Autonomous = *s.Autonomous
	}
	return r
}

// ApplyLiveEngineSettings writes them onto the group, which is the scheduler's source of truth once a DAG
// exists. The run is deliberately untouched: keeping its launch snapshot is what stops the sheet having to
// choose between two disagreeing values.
func ApplyLiveEngineSettings(g waveobj.TaskGroup, s PendingEngineSettings) waveobj.TaskGroup {
	if s.Parallelism != nil {
		g.Parallelism = *s.Parallelism
	}
	g.WorkerRoute = s.WorkerRoute
	g.ReviewerPicks = s.ReviewerPicks
	g.ReviewerRoute = s.ReviewerRoute
	g.LightReviewerRoute = s.LightReviewerRoute
	if s.Autonomous != nil {
		g.Autonomous = *s.Autonomous
	}
	return g
}
